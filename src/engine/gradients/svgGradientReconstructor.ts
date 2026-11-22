import type { RawRgbaImage } from '../types';
import { traceMaskWithPotraceToSvgElements } from '../vectorizers/potraceEngine';

export interface RgbaGradientStop {
  t: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface RegionSvgFillFit {
  kind: 'solid' | 'linear' | 'radial';
  fillValue: string;
  fillOpacity?: number;
  defsXml: string;
  mae: number;
  p95Error: number;
  evalColorAt: (x: number, y: number) => [number, number, number, number];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
      .join('')
  );
}

function evalStopsRgba(stops: RgbaGradientStop[], tNorm: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, tNorm));
  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i];
    const s1 = stops[i + 1];
    if (t >= s0.t && t <= s1.t) {
      const span = Math.max(1e-6, s1.t - s0.t);
      const u = (t - s0.t) / span;
      return [
        s0.r + (s1.r - s0.r) * u,
        s0.g + (s1.g - s0.g) * u,
        s0.b + (s1.b - s0.b) * u,
        s0.a + (s1.a - s0.a) * u,
      ];
    }
  }
  const last = stops[stops.length - 1];
  return [last.r, last.g, last.b, last.a];
}

function pruneRedundantStops(stops: RgbaGradientStop[]): RgbaGradientStop[] {
  if (stops.length <= 3) return stops;
  const kept: RgbaGradientStop[] = [stops[0]];
  for (let i = 1; i < stops.length - 1; i++) {
    const prev = kept[kept.length - 1];
    const curr = stops[i];
    const next = stops[i + 1];
    const span = Math.max(1e-6, next.t - prev.t);
    const u = (curr.t - prev.t) / span;
    const ir = prev.r + (next.r - prev.r) * u;
    const ig = prev.g + (next.g - prev.g) * u;
    const ib = prev.b + (next.b - prev.b) * u;
    const ia = prev.a + (next.a - prev.a) * u;
    const dev = Math.max(
      Math.abs(curr.r - ir),
      Math.abs(curr.g - ig),
      Math.abs(curr.b - ib),
      Math.abs(curr.a - ia)
    );
    if (dev >= 1.4) {
      kept.push(curr);
    }
  }
  kept.push(stops[stops.length - 1]);
  return kept;
}

function buildStopsAndMeasureError(
  projValues: Float32Array,
  samplePixels: Int32Array,
  sampleCount: number,
  data: Uint8Array,
  numBins = 15
): {
  minProj: number;
  maxProj: number;
  stops: RgbaGradientStop[];
  mae: number;
  p95Error: number;
} {
  let minProj = Infinity;
  let maxProj = -Infinity;
  for (let i = 0; i < sampleCount; i++) {
    const v = projValues[i];
    if (v < minProj) minProj = v;
    if (v > maxProj) maxProj = v;
  }

  const range = Math.max(1e-5, maxProj - minProj);
  const rSum = new Float64Array(numBins);
  const gSum = new Float64Array(numBins);
  const bSum = new Float64Array(numBins);
  const aSum = new Float64Array(numBins);
  const binCounts = new Int32Array(numBins);

  for (let i = 0; i < sampleCount; i++) {
    const t = Math.max(0, Math.min(1, (projValues[i] - minProj) / range));
    const bin = Math.min(numBins - 1, Math.floor(t * (numBins - 1) + 0.5));
    const idx = samplePixels[i] * 4;
    rSum[bin] += data[idx];
    gSum[bin] += data[idx + 1];
    bSum[bin] += data[idx + 2];
    aSum[bin] += data[idx + 3];
    binCounts[bin]++;
  }

  const rawStops: RgbaGradientStop[] = [];
  for (let b = 0; b < numBins; b++) {
    if (binCounts[b] > 0) {
      rawStops.push({
        t: b / (numBins - 1),
        r: rSum[b] / binCounts[b],
        g: gSum[b] / binCounts[b],
        b: bSum[b] / binCounts[b],
        a: aSum[b] / binCounts[b],
      });
    }
  }

  if (rawStops.length < 2) {
    return { minProj, maxProj, stops: rawStops, mae: 999, p95Error: 999 };
  }

  rawStops[0].t = 0;
  rawStops[rawStops.length - 1].t = 1;
  const stops = pruneRedundantStops(rawStops);

  let errSum = 0;
  const errHist = new Int32Array(256);
  for (let i = 0; i < sampleCount; i++) {
    const t = (projValues[i] - minProj) / range;
    const [pr, pg, pb, pa] = evalStopsRgba(stops, t);
    const idx = samplePixels[i] * 4;
    const pxErr =
      (Math.abs(data[idx] - pr) +
        Math.abs(data[idx + 1] - pg) +
        Math.abs(data[idx + 2] - pb) +
        Math.abs(data[idx + 3] - pa)) /
      4;
    errSum += pxErr;
    errHist[Math.min(255, Math.round(pxErr))]++;
  }

  const mae = errSum / sampleCount;
  const p95Target = Math.floor(sampleCount * 0.95);
  let acc = 0;
  let p95Error = 255;
  for (let e = 0; e < 256; e++) {
    acc += errHist[e];
    if (acc >= p95Target) {
      p95Error = e;
      break;
    }
  }

  return { minProj, maxProj, stops, mae, p95Error };
}

function formatStopsXml(stops: RgbaGradientStop[]): string {
  return stops
    .map((s) => {
      const pct = Number((s.t * 100).toFixed(1));
      const hex = rgbToHex(s.r, s.g, s.b);
      const op = s.a / 255;
      const opAttr = op < 0.985 ? ` stop-opacity="${Number(op.toFixed(3))}"` : '';
      return `<stop offset="${pct}%" stop-color="${hex}"${opAttr}/>`;
    })
    .join('');
}

/**
 * Ajusta o preenchimento vetorial ótimo para uma região:
 * 1) Cor sólida (+ fill-opacity),
 * 2) <linearGradient> multi-stop (15 stops c/ poda inteligente, varredura 0°..178° c/ refinamento de 2°),
 * 3) <radialGradient> circular E elíptico anisotrópico (`gradientTransform="translate(cx cy) scale(1 ry/rx)..."`)
 *    para sombras suaves, reflexos e medalhões!
 */
export function fitRegionSvgFill(
  pixels: Int32Array,
  count: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  image: RawRgbaImage,
  coordScaleFactor: number,
  gradId: string,
  rgbGradientMap?: Uint8Array
): RegionSvgFillFit {
  const { width, data } = image;

  // Prioriza pixels interiores puros (longe de 1px de anti-aliasing de borda) ao estimar os stops de cor!
  const interiorList: number[] = [];
  if (rgbGradientMap && count >= 30) {
    for (let i = 0; i < count; i++) {
      const px = pixels[i];
      if (rgbGradientMap[px] < 32) {
        interiorList.push(px);
      }
    }
  }
  const sourcePool =
    interiorList.length >= Math.min(20, count * 0.4)
      ? new Int32Array(interiorList)
      : pixels.subarray(0, count);
  const poolLen = sourcePool.length;

  const maxSamples = 3600;
  const stride = poolLen > maxSamples ? Math.max(1, Math.floor(poolLen / maxSamples)) : 1;
  const sampleCount = Math.ceil(poolLen / stride);
  const samplePixels = stride === 1 ? sourcePool : new Int32Array(sampleCount);

  let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0, minA = 255, maxA = 0;
  let sumX = 0, sumY = 0;

  let sIdx = 0;
  for (let i = 0; i < poolLen; i += stride) {
    const px = sourcePool[i];
    if (stride > 1) samplePixels[sIdx] = px;
    sIdx++;

    const x = px % width;
    const y = (px - x) / width;
    const idx = px * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];

    rSum += r;
    gSum += g;
    bSum += b;
    aSum += a;
    sumX += x;
    sumY += y;

    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (g < minG) minG = g;
    if (g > maxG) maxG = g;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
  }

  const actualSamples = sIdx;
  const meanR = rSum / actualSamples;
  const meanG = gSum / actualSamples;
  const meanB = bSum / actualSamples;
  const meanA = aSum / actualSamples;
  const meanX = sumX / actualSamples;
  const meanY = sumY / actualSamples;

  let solidErrSum = 0;
  const solidHist = new Int32Array(256);
  for (let i = 0; i < actualSamples; i++) {
    const idx = samplePixels[i] * 4;
    const e =
      (Math.abs(data[idx] - meanR) +
        Math.abs(data[idx + 1] - meanG) +
        Math.abs(data[idx + 2] - meanB) +
        Math.abs(data[idx + 3] - meanA)) /
      4;
    solidErrSum += e;
    solidHist[Math.min(255, Math.round(e))]++;
  }
  const solidMae = solidErrSum / actualSamples;
  let solidAcc = 0;
  let solidP95 = 255;
  for (let e = 0; e < 256; e++) {
    solidAcc += solidHist[e];
    if (solidAcc >= Math.floor(actualSamples * 0.95)) {
      solidP95 = e;
      break;
    }
  }

  const colorSpan = Math.max(maxR - minR, maxG - minG, maxB - minB, maxA - minA);
  const solidHex = rgbToHex(meanR, meanG, meanB);
  const solidOpacity = meanA < 251 ? meanA / 255 : undefined;

  if (actualSamples < 12 || colorSpan <= 12 || (solidMae <= 2.0 && solidP95 <= 5)) {
    return {
      kind: 'solid',
      fillValue: solidHex,
      fillOpacity: solidOpacity,
      defsXml: '',
      mae: solidMae,
      p95Error: solidP95,
      evalColorAt: () => [meanR, meanG, meanB, meanA],
    };
  }

  const xs = new Float32Array(actualSamples);
  const ys = new Float32Array(actualSamples);
  for (let i = 0; i < actualSamples; i++) {
    const px = samplePixels[i];
    const x = px % width;
    xs[i] = x;
    ys[i] = (px - x) / width;
  }

  const projBuf = new Float32Array(actualSamples);

  // 1. Varredura angular de 0° a 170° (passo 10°) + refinamento fino (±2°, ±4°) para <linearGradient>
  let bestAngleRad = 0;
  let bestLinear = {
    minProj: 0,
    maxProj: 1,
    stops: [] as RgbaGradientStop[],
    mae: 999,
    p95Error: 999,
  };

  for (let deg = 0; deg < 180; deg += 10) {
    const rad = (deg * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    for (let i = 0; i < actualSamples; i++) {
      projBuf[i] = xs[i] * dx + ys[i] * dy;
    }
    const fit = buildStopsAndMeasureError(projBuf, samplePixels, actualSamples, data, 15);
    if (fit.mae < bestLinear.mae) {
      bestLinear = fit;
      bestAngleRad = rad;
    }
  }

  for (const deltaDeg of [-6, -4, -2, 2, 4, 6]) {
    const rad = bestAngleRad + (deltaDeg * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    for (let i = 0; i < actualSamples; i++) {
      projBuf[i] = xs[i] * dx + ys[i] * dy;
    }
    const fit = buildStopsAndMeasureError(projBuf, samplePixels, actualSamples, data, 15);
    if (fit.mae < bestLinear.mae) {
      bestLinear = fit;
      bestAngleRad = rad;
    }
  }

  // 2. Teste de <radialGradient>: tanto circular isotrópico QUANTO elíptico anisotrópico (essencial para sombras!)
  const cxGeom = (minX + maxX) * 0.5;
  const cyGeom = (minY + maxY) * 0.5;
  const rxBox = Math.max(2, (maxX - minX + 1) * 0.5);
  const ryBox = Math.max(2, (maxY - minY + 1) * 0.5);
  const aspectScaleY = ryBox / rxBox;

  const radialCandidates: Array<{ cx: number; cy: number; scaleY: number }> = [
    { cx: cxGeom, cy: cyGeom, scaleY: 1 },
    { cx: meanX, cy: meanY, scaleY: 1 },
    { cx: cxGeom, cy: cyGeom, scaleY: aspectScaleY },
    { cx: meanX, cy: meanY, scaleY: aspectScaleY },
  ];

  let bestRadialCfg = radialCandidates[0];
  let bestRadial = {
    minProj: 0,
    maxProj: 1,
    stops: [] as RgbaGradientStop[],
    mae: 999,
    p95Error: 999,
  };

  for (const cfg of radialCandidates) {
    const invSy = 1 / Math.max(0.05, cfg.scaleY);
    for (let i = 0; i < actualSamples; i++) {
      projBuf[i] = Math.hypot(xs[i] - cfg.cx, (ys[i] - cfg.cy) * invSy);
    }
    const fit = buildStopsAndMeasureError(projBuf, samplePixels, actualSamples, data, 13);
    if (fit.mae < bestRadial.mae) {
      bestRadial = fit;
      bestRadialCfg = cfg;
    }
  }

  const useRadial = bestRadial.mae + 0.35 < bestLinear.mae;
  const bestGrad = useRadial ? bestRadial : bestLinear;

  if (bestGrad.stops.length < 2 || bestGrad.mae + 0.6 >= solidMae) {
    return {
      kind: 'solid',
      fillValue: solidHex,
      fillOpacity: solidOpacity,
      defsXml: '',
      mae: solidMae,
      p95Error: solidP95,
      evalColorAt: () => [meanR, meanG, meanB, meanA],
    };
  }

  const stopTags = formatStopsXml(bestGrad.stops);

  if (useRadial) {
    const { cx, cy, scaleY } = bestRadialCfg;
    const rScaled = Number((Math.max(1, bestRadial.maxProj) * coordScaleFactor).toFixed(2));
    const cxScaled = Number((cx * coordScaleFactor).toFixed(2));
    const cyScaled = Number((cy * coordScaleFactor).toFixed(2));
    const syClean = Number(scaleY.toFixed(4));
    const transformAttr =
      Math.abs(scaleY - 1) > 0.04
        ? ` gradientTransform="translate(${cxScaled} ${cyScaled}) scale(1 ${syClean}) translate(${-cxScaled} ${-cyScaled})"`
        : '';

    const defsXml = `<radialGradient id="${gradId}" gradientUnits="userSpaceOnUse" cx="${cxScaled}" cy="${cyScaled}" r="${rScaled}"${transformAttr}>${stopTags}</radialGradient>`;
    const range = Math.max(1e-5, bestRadial.maxProj - bestRadial.minProj);
    const invSy = 1 / Math.max(0.05, scaleY);

    return {
      kind: 'radial',
      fillValue: `url(#${gradId})`,
      defsXml,
      mae: bestRadial.mae,
      p95Error: bestRadial.p95Error,
      evalColorAt: (x: number, y: number) => {
        const d = Math.hypot(x - cx, (y - cy) * invSy);
        return evalStopsRgba(bestRadial.stops, (d - bestRadial.minProj) / range);
      },
    };
  }

  const dirX = Math.cos(bestAngleRad);
  const dirY = Math.sin(bestAngleRad);
  const pMid = (bestLinear.minProj + bestLinear.maxProj) * 0.5;
  const meanProj = meanX * dirX + meanY * dirY;
  const originX = meanX + (pMid - meanProj) * dirX;
  const originY = meanY + (pMid - meanProj) * dirY;
  const halfSpan = Math.max(0.5, (bestLinear.maxProj - bestLinear.minProj) * 0.5);

  const x1 = Number(((originX - halfSpan * dirX) * coordScaleFactor).toFixed(2));
  const y1 = Number(((originY - halfSpan * dirY) * coordScaleFactor).toFixed(2));
  const x2 = Number(((originX + halfSpan * dirX) * coordScaleFactor).toFixed(2));
  const y2 = Number(((originY + halfSpan * dirY) * coordScaleFactor).toFixed(2));

  const defsXml = `<linearGradient id="${gradId}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stopTags}</linearGradient>`;
  const linRange = Math.max(1e-5, bestLinear.maxProj - bestLinear.minProj);

  return {
    kind: 'linear',
    fillValue: `url(#${gradId})`,
    defsXml,
    mae: bestLinear.mae,
    p95Error: bestLinear.p95Error,
    evalColorAt: (x: number, y: number) => {
      const p = x * dirX + y * dirY;
      return evalStopsRgba(bestLinear.stops, (p - bestLinear.minProj) / linRange);
    },
  };
}

export async function reconstructNativeSvgGradients(
  sourceImage: RawRgbaImage,
  coordScaleFactor: number
): Promise<{ defsXml: string; layersXml: string; count: number }> {
  const { width, height, data } = sourceImage;
  const totalPixels = width * height;
  if (totalPixels < 256 || totalPixels > 2_600_000) {
    return { defsXml: '', layersXml: '', count: 0 };
  }

  const visited = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  const defsList: string[] = [];
  const pathsList: string[] = [];

  const minRegionArea = Math.max(85, Math.round(totalPixels * 0.0012));
  const maxStepDiff = 20;
  let gradCounter = 0;

  for (let startPx = 0; startPx < totalPixels; startPx++) {
    if (visited[startPx]) continue;
    const sIdx = startPx * 4;
    if (data[sIdx + 3] < 40) {
      visited[startPx] = 1;
      continue;
    }

    let head = 0;
    let tail = 0;
    queue[tail++] = startPx;
    visited[startPx] = 1;

    let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
    let minX = width, maxX = 0, minY = height, maxY = 0;

    while (head < tail) {
      const px = queue[head++];
      const x = px % width;
      const y = (px - x) / width;
      const idx = px * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (g < minG) minG = g;
      if (g > maxG) maxG = g;
      if (b < minB) minB = b;
      if (b > maxB) maxB = b;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const neighbors = [
        x > 0 ? px - 1 : -1,
        x + 1 < width ? px + 1 : -1,
        y > 0 ? px - width : -1,
        y + 1 < height ? px + width : -1,
      ];

      for (let n = 0; n < 4; n++) {
        const nPx = neighbors[n];
        if (nPx < 0 || visited[nPx]) continue;
        const nIdx = nPx * 4;
        if (data[nIdx + 3] < 40) continue;

        const step =
          Math.abs(data[nIdx] - r) +
          Math.abs(data[nIdx + 1] - g) +
          Math.abs(data[nIdx + 2] - b);
        if (step <= maxStepDiff) {
          visited[nPx] = 1;
          queue[tail++] = nPx;
        }
      }
    }

    const count = tail;
    if (count < minRegionArea) continue;
    if (minX === 0 && minY === 0 && maxX === width - 1 && maxY === height - 1 && count > totalPixels * 0.55) {
      continue;
    }

    const colorSpan = Math.max(maxR - minR, maxG - minG, maxB - minB);
    if (colorSpan < 24) continue;

    const compPixels = queue.slice(0, count);
    const candidateId = `grad-nativo-${gradCounter + 1}`;
    const fit = fitRegionSvgFill(
      compPixels,
      count,
      minX,
      minY,
      maxX,
      maxY,
      sourceImage,
      coordScaleFactor,
      candidateId
    );

    if (fit.kind === 'solid' || fit.mae > 6.5 || fit.p95Error > 17) {
      continue;
    }

    const pad = 2;
    const cropX = Math.max(0, minX - pad);
    const cropY = Math.max(0, minY - pad);
    const cropW = Math.min(width - cropX, maxX - minX + 1 + pad * 2);
    const cropH = Math.min(height - cropY, maxY - minY + 1 + pad * 2);
    const localMask = new Uint8Array(cropW * cropH);

    for (let i = 0; i < count; i++) {
      const px = compPixels[i];
      const lx = (px % width) - cropX;
      const ly = Math.floor(px / width) - cropY;
      localMask[ly * cropW + lx] = 1;
    }

    gradCounter++;
    const tracedGroup = await traceMaskWithPotraceToSvgElements(
      localMask,
      cropW,
      cropH,
      fit.fillValue,
      cropX * coordScaleFactor,
      cropY * coordScaleFactor,
      coordScaleFactor,
      `gradiente-forma-${gradCounter}`,
      { alphamax: 1.12, opttolerance: 0.24, turdsize: 1 }
    );

    if (tracedGroup) {
      defsList.push(fit.defsXml);
      pathsList.push(tracedGroup);
    }

    if (defsList.length >= 36) break;
  }

  if (defsList.length === 0) {
    return { defsXml: '', layersXml: '', count: 0 };
  }

  return {
    defsXml: defsList.join(''),
    layersXml: `<g id="camada-gradientes-nativos">${pathsList.join('')}</g>`,
    count: defsList.length,
  };
}
