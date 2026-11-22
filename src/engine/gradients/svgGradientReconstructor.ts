import type { RawRgbaImage } from '../types';
import type { RegionVisualNature } from '../opencv/opencvSegmenter';
import {
  deltaEOklab,
  oklabScaledToSrgb8,
  rgbToHex,
  srgb8ToOklabScaled,
} from '../color/perceptualColor';
import { traceMaskWithPotraceToSvgElements } from '../vectorizers/potraceEngine';

export interface PerceptualGradientStop {
  t: number;
  L: number;
  okA: number;
  okB: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface OverlaySvgLayer {
  fillValue: string;
  fillOpacity?: number;
  defsXml: string;
}

export interface RegionSvgFillFit {
  kind: 'solid' | 'linear' | 'radial' | 'compound';
  fillValue: string;
  fillOpacity?: number;
  defsXml: string;
  overlayLayer?: OverlaySvgLayer;
  mae: number;
  p95Error: number;
  meanDeltaEOklab: number;
  evalColorAt: (x: number, y: number) => [number, number, number, number];
}

function evalStopsOklabAndRgba(
  stops: PerceptualGradientStop[],
  tNorm: number
): { L: number; okA: number; okB: number; r: number; g: number; b: number; a: number } {
  const t = Math.max(0, Math.min(1, tNorm));
  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i];
    const s1 = stops[i + 1];
    if (t >= s0.t && t <= s1.t) {
      const span = Math.max(1e-6, s1.t - s0.t);
      const u = (t - s0.t) / span;
      return {
        L: s0.L + (s1.L - s0.L) * u,
        okA: s0.okA + (s1.okA - s0.okA) * u,
        okB: s0.okB + (s1.okB - s0.okB) * u,
        r: s0.r + (s1.r - s0.r) * u,
        g: s0.g + (s1.g - s0.g) * u,
        b: s0.b + (s1.b - s0.b) * u,
        a: s0.a + (s1.a - s0.a) * u,
      };
    }
  }
  const last = stops[stops.length - 1];
  return {
    L: last.L,
    okA: last.okA,
    okB: last.okB,
    r: last.r,
    g: last.g,
    b: last.b,
    a: last.a,
  };
}

function pruneRedundantPerceptualStops(
  stops: PerceptualGradientStop[],
  minDeviationOk = 0.72
): PerceptualGradientStop[] {
  if (stops.length <= 3) return stops;
  const kept: PerceptualGradientStop[] = [stops[0]];
  for (let i = 1; i < stops.length - 1; i++) {
    const prev = kept[kept.length - 1];
    const curr = stops[i];
    const next = stops[i + 1];
    const span = Math.max(1e-6, next.t - prev.t);
    const u = (curr.t - prev.t) / span;
    const iL = prev.L + (next.L - prev.L) * u;
    const iA = prev.okA + (next.okA - prev.okA) * u;
    const iB = prev.okB + (next.okB - prev.okB) * u;
    const iAlpha = prev.a + (next.a - prev.a) * u;
    const devOk = Math.hypot(
      curr.L - iL,
      curr.okA - iA,
      curr.okB - iB,
      ((curr.a - iAlpha) / 255) * 60
    );
    if (devOk >= minDeviationOk) {
      kept.push(curr);
    }
  }
  kept.push(stops[stops.length - 1]);
  return kept;
}

function buildPerceptualStopsAndMeasureError(
  projValues: Float32Array,
  samplePixels: Int32Array,
  sampleCount: number,
  data: Uint8Array,
  sampleL: Float32Array,
  sampleOkA: Float32Array,
  sampleOkB: Float32Array,
  numBins = 17,
  pruneTolOk = 0.72
): {
  minProj: number;
  maxProj: number;
  stops: PerceptualGradientStop[];
  maeRgb: number;
  p95Rgb: number;
  meanDeltaE: number;
} {
  let minProj = Infinity;
  let maxProj = -Infinity;
  for (let i = 0; i < sampleCount; i++) {
    const v = projValues[i];
    if (v < minProj) minProj = v;
    if (v > maxProj) maxProj = v;
  }

  const range = Math.max(1e-5, maxProj - minProj);
  const lSum = new Float64Array(numBins);
  const okASum = new Float64Array(numBins);
  const okBSum = new Float64Array(numBins);
  const aSum = new Float64Array(numBins);
  const binCounts = new Int32Array(numBins);

  for (let i = 0; i < sampleCount; i++) {
    const t = Math.max(0, Math.min(1, (projValues[i] - minProj) / range));
    const bin = Math.min(numBins - 1, Math.floor(t * (numBins - 1) + 0.5));
    const idx = samplePixels[i] * 4;
    lSum[bin] += sampleL[i];
    okASum[bin] += sampleOkA[i];
    okBSum[bin] += sampleOkB[i];
    aSum[bin] += data[idx + 3];
    binCounts[bin]++;
  }

  const rawStops: PerceptualGradientStop[] = [];
  for (let b = 0; b < numBins; b++) {
    const cnt = binCounts[b];
    if (cnt > 0) {
      const mL = lSum[b] / cnt;
      const mA = okASum[b] / cnt;
      const mB = okBSum[b] / cnt;
      const [sr, sg, sb] = oklabScaledToSrgb8(mL, mA, mB);
      rawStops.push({
        t: b / (numBins - 1),
        L: mL,
        okA: mA,
        okB: mB,
        r: sr,
        g: sg,
        b: sb,
        a: aSum[b] / cnt,
      });
    }
  }

  if (rawStops.length < 2) {
    return { minProj, maxProj, stops: rawStops, maeRgb: 999, p95Rgb: 999, meanDeltaE: 999 };
  }

  rawStops[0].t = 0;
  rawStops[rawStops.length - 1].t = 1;
  const stops = pruneRedundantPerceptualStops(rawStops, pruneTolOk);

  let rgbErrSum = 0;
  let deSum = 0;
  const errHist = new Int32Array(256);

  for (let i = 0; i < sampleCount; i++) {
    const t = (projValues[i] - minProj) / range;
    const ev = evalStopsOklabAndRgba(stops, t);
    const idx = samplePixels[i] * 4;
    const pxErr =
      (Math.abs(data[idx] - ev.r) +
        Math.abs(data[idx + 1] - ev.g) +
        Math.abs(data[idx + 2] - ev.b) +
        Math.abs(data[idx + 3] - ev.a)) /
      4;
    rgbErrSum += pxErr;
    errHist[Math.min(255, Math.round(pxErr))]++;
    deSum += deltaEOklab(sampleL[i], sampleOkA[i], sampleOkB[i], ev.L, ev.okA, ev.okB);
  }

  const maeRgb = rgbErrSum / sampleCount;
  const meanDeltaE = deSum / sampleCount;
  const p95Target = Math.floor(sampleCount * 0.95);
  let acc = 0;
  let p95Rgb = 255;
  for (let e = 0; e < 256; e++) {
    acc += errHist[e];
    if (acc >= p95Target) {
      p95Rgb = e;
      break;
    }
  }

  return { minProj, maxProj, stops, maeRgb, p95Rgb, meanDeltaE };
}

function formatStopsXml(stops: PerceptualGradientStop[]): string {
  return stops
    .map((s) => {
      const pct = Number((s.t * 100).toFixed(1));
      const hex = rgbToHex(s.r, s.b !== undefined ? s.g : 0, s.b);
      const op = s.a / 255;
      const opAttr = op < 0.985 ? ` stop-opacity="${Number(op.toFixed(3))}"` : '';
      return `<stop offset="${pct}%" stop-color="${hex}"${opAttr}/>`;
    })
    .join('');
}

/**
 * Equação analítica exata da especificação W3C SVG 1.1 / SVG 2 para <radialGradient cx cy r fx fy>:
 * Dado centro C=(cx, cy), raio R e foco F=(fx, fy) com |F - C| < R (no espaço verticalmente escalado por invSy),
 * retorna o parâmetro t(x, y) >= 0 tal que t(F) = 0 e t(P) = 1 em todo o círculo externo |(P - C)|_invSy = R.
 */
function computeW3cSvgRadialT(
  x: number,
  y: number,
  cx: number,
  cy: number,
  r: number,
  fx: number,
  fy: number,
  invSy: number
): number {
  const dx = x - fx;
  const dy = (y - fy) * invSy;
  const dFx = fx - cx;
  const dFy = (fy - cy) * invSy;
  const negC = r * r - (dFx * dFx + dFy * dFy);
  if (negC <= 1e-6) {
    return Math.hypot(dx, dy) / Math.max(1e-5, r);
  }
  const aQuad = dx * dx + dy * dy;
  const bHalf = dFx * dx + dFy * dy;
  const disc = Math.max(0, bHalf * bHalf + aQuad * negC);
  return Math.max(0, (bHalf + Math.sqrt(disc)) / negC);
}

/**
 * Tenta construir uma camada secundária de iluminação/sombra sobreposta (Gradiente Composto)
 * ao longo do eixo ortogonal ou radial focal quando um único gradiente 1D ainda apresenta resíduo perceptual!
 */
function tryFitCompoundResidualOverlay(
  xs: Float32Array,
  ys: Float32Array,
  sampleCount: number,
  sampleL: Float32Array,
  sampleOkA: Float32Array,
  sampleOkB: Float32Array,
  baseEvalAt: (x: number, y: number) => [number, number, number, number],
  primaryAngleRad: number,
  meanX: number,
  meanY: number,
  coordScaleFactor: number,
  overlayGradId: string
): OverlaySvgLayer | null {
  if (sampleCount < 45) return null;

  // Calcula resíduo de luminosidade L real vs modelo base
  const orthoAngle = primaryAngleRad + Math.PI * 0.5;
  const odx = Math.cos(orthoAngle);
  const ody = Math.sin(orthoAngle);

  const numBins = 9;
  let minP = Infinity;
  let maxP = -Infinity;
  const orthoProj = new Float32Array(sampleCount);
  const resL = new Float32Array(sampleCount);
  const resR = new Float32Array(sampleCount);
  const resG = new Float32Array(sampleCount);
  const resB = new Float32Array(sampleCount);

  let absResSum = 0;
  for (let i = 0; i < sampleCount; i++) {
    const p = xs[i] * odx + ys[i] * ody;
    orthoProj[i] = p;
    if (p < minP) minP = p;
    if (p > maxP) maxP = p;

    const [br, bg, bb] = baseEvalAt(xs[i], ys[i]);
    const [bL] = srgb8ToOklabScaled(Math.round(br), Math.round(bg), Math.round(bb));
    const dL = sampleL[i] - bL;
    resL[i] = dL;
    absResSum += Math.abs(dL);
    const [tr, tg, tb] = oklabScaledToSrgb8(sampleL[i], sampleOkA[i], sampleOkB[i]);
    resR[i] = tr - br;
    resG[i] = tg - bg;
    resB[i] = tb - bb;
  }

  const meanAbsDL = absResSum / sampleCount;
  if (meanAbsDL < 2.4 || maxP - minP < 4) return null;

  const span = Math.max(1e-5, maxP - minP);
  const binDL = new Float64Array(numBins);
  const binDR = new Float64Array(numBins);
  const binDG = new Float64Array(numBins);
  const binDB = new Float64Array(numBins);
  const binCnt = new Int32Array(numBins);

  for (let i = 0; i < sampleCount; i++) {
    const t = Math.max(0, Math.min(1, (orthoProj[i] - minP) / span));
    const b = Math.min(numBins - 1, Math.floor(t * (numBins - 1) + 0.5));
    binDL[b] += resL[i];
    binDR[b] += resR[i];
    binDG[b] += resG[i];
    binDB[b] += resB[i];
    binCnt[b]++;
  }

  // Verifica se o perfil ortogonal explica uma fração significativa do resíduo (não ruído aleatório!)
  let afterAbsSum = 0;
  for (let i = 0; i < sampleCount; i++) {
    const t = Math.max(0, Math.min(1, (orthoProj[i] - minP) / span));
    const b = Math.min(numBins - 1, Math.floor(t * (numBins - 1) + 0.5));
    const explained = binCnt[b] > 0 ? binDL[b] / binCnt[b] : 0;
    afterAbsSum += Math.abs(resL[i] - explained);
  }
  const afterMeanAbsDL = afterAbsSum / sampleCount;
  if (afterMeanAbsDL > meanAbsDL * 0.72) {
    return null;
  }

  const stopParts: string[] = [];
  const overlayBinsAlpha = new Float64Array(numBins);
  const overlayBinsWhite = new Uint8Array(numBins);

  for (let b = 0; b < numBins; b++) {
    if (binCnt[b] === 0) continue;
    const meanDL = binDL[b] / binCnt[b];
    const isHighlight = meanDL >= 0;
    const opacity = Math.max(0, Math.min(0.48, Math.abs(meanDL) / 72));
    overlayBinsAlpha[b] = opacity;
    overlayBinsWhite[b] = isHighlight ? 1 : 0;
    const shadeHex = isHighlight ? '#ffffff' : '#000000';
    const pct = Number(((b / (numBins - 1)) * 100).toFixed(1));
    stopParts.push(
      `<stop offset="${pct}%" stop-color="${shadeHex}" stop-opacity="${Number(opacity.toFixed(3))}"/>`
    );
  }

  if (stopParts.length < 2) return null;

  // Verifica em simulação Porter-Duff real se a camada neutra reduz efetivamente o ΔE_ok da região!
  let beforeDeSum = 0;
  let afterDeSum = 0;
  for (let i = 0; i < sampleCount; i++) {
    const [br, bg, bb] = baseEvalAt(xs[i], ys[i]);
    const [bL, bA, bB] = srgb8ToOklabScaled(Math.round(br), Math.round(bg), Math.round(bb));
    beforeDeSum += deltaEOklab(sampleL[i], sampleOkA[i], sampleOkB[i], bL, bA, bB);

    const t = Math.max(0, Math.min(1, (orthoProj[i] - minP) / span));
    const b = Math.min(numBins - 1, Math.floor(t * (numBins - 1) + 0.5));
    const op = overlayBinsAlpha[b];
    const target = overlayBinsWhite[b] ? 255 : 0;
    const cr = Math.round(br * (1 - op) + target * op);
    const cg = Math.round(bg * (1 - op) + target * op);
    const cb = Math.round(bb * (1 - op) + target * op);
    const [cL, cA, cB] = srgb8ToOklabScaled(cr, cg, cb);
    afterDeSum += deltaEOklab(sampleL[i], sampleOkA[i], sampleOkB[i], cL, cA, cB);
  }

  if (afterDeSum / sampleCount >= beforeDeSum / sampleCount - 0.55) {
    return null;
  }

  const pMid = (minP + maxP) * 0.5;
  const meanProj = meanX * odx + meanY * ody;
  const ox = meanX + (pMid - meanProj) * odx;
  const oy = meanY + (pMid - meanProj) * ody;
  const half = Math.max(0.5, span * 0.5);

  const x1 = Number(((ox - half * odx) * coordScaleFactor).toFixed(2));
  const y1 = Number(((oy - half * ody) * coordScaleFactor).toFixed(2));
  const x2 = Number(((ox + half * odx) * coordScaleFactor).toFixed(2));
  const y2 = Number(((oy + half * ody) * coordScaleFactor).toFixed(2));

  return {
    fillValue: `url(#${overlayGradId})`,
    defsXml: `<linearGradient id="${overlayGradId}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stopParts.join('')}</linearGradient>`,
  };
}

/**
 * Reconstrutor Perceptual Avançado de Preenchimentos e Gradientes SVG:
 * - Opera em espaço perceptual OKLab para preservar tons, subtons, sombras, reflexos e saturação;
 * - Suporta cores sólidas exatas, `<linearGradient>` multi-stop, `<radialGradient>` elíptico E com
 *   foco especular deslocado `(fx, fy)` (esferas 3D, gotas, ícones iluminados, metais), além de
 *   gradientes compostos sobrepostos para variações 2D suaves!
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
  rgbGradientMap?: Uint8Array,
  regionNature: RegionVisualNature = 'gradient'
): RegionSvgFillFit {
  const { width, data } = image;

  // Prioriza pixels interiores livres de mistura de borda (1px) ao estimar stops cromáticos!
  const interiorList: number[] = [];
  if (rgbGradientMap && count >= 28) {
    for (let i = 0; i < count; i++) {
      const px = pixels[i];
      if (rgbGradientMap[px] < 34) {
        interiorList.push(px);
      }
    }
  }
  const sourcePool =
    interiorList.length >= Math.min(18, count * 0.38)
      ? new Int32Array(interiorList)
      : pixels.subarray(0, count);
  const poolLen = sourcePool.length;

  const maxSamples = 4000;
  const stride = poolLen > maxSamples ? Math.max(1, Math.floor(poolLen / maxSamples)) : 1;
  const sampleCount = Math.ceil(poolLen / stride);
  const samplePixels = stride === 1 ? sourcePool : new Int32Array(sampleCount);

  const xs = new Float32Array(sampleCount);
  const ys = new Float32Array(sampleCount);
  const sampleL = new Float32Array(sampleCount);
  const sampleOkA = new Float32Array(sampleCount);
  const sampleOkB = new Float32Array(sampleCount);

  let lSum = 0, okASum = 0, okBSum = 0, aSum = 0;
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0, minA = 255, maxA = 0;
  let sumX = 0, sumY = 0;

  // Rastreia também o pico de luz especular (fx, fy) para <radialGradient> 3D/iluminado!
  let brightWeightSum = 0;
  let brightSumX = 0;
  let brightSumY = 0;
  let maxSampleL = -1;

  let sIdx = 0;
  for (let i = 0; i < poolLen; i += stride) {
    const px = sourcePool[i];
    if (stride > 1) samplePixels[sIdx] = px;

    const x = px % width;
    const y = (px - x) / width;
    const idx = px * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const al = data[idx + 3];
    const [Lv, okAv, okBv] = srgb8ToOklabScaled(r, g, b);

    xs[sIdx] = x;
    ys[sIdx] = y;
    sampleL[sIdx] = Lv;
    sampleOkA[sIdx] = okAv;
    sampleOkB[sIdx] = okBv;
    sIdx++;

    lSum += Lv;
    okASum += okAv;
    okBSum += okBv;
    aSum += al;
    sumX += x;
    sumY += y;

    if (Lv > maxSampleL) maxSampleL = Lv;

    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (g < minG) minG = g;
    if (g > maxG) maxG = g;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
    if (al < minA) minA = al;
    if (al > maxA) maxA = al;
  }

  const actualSamples = sIdx;
  const meanL = lSum / actualSamples;
  const meanOkA = okASum / actualSamples;
  const meanOkB = okBSum / actualSamples;
  const meanA = aSum / actualSamples;
  const meanX = sumX / actualSamples;
  const meanY = sumY / actualSamples;

  const [meanR, meanG, meanB] = oklabScaledToSrgb8(meanL, meanOkA, meanOkB);

  for (let i = 0; i < actualSamples; i++) {
    if (sampleL[i] >= maxSampleL - 4.5) {
      const w = 1 + (sampleL[i] - (maxSampleL - 4.5));
      brightWeightSum += w;
      brightSumX += xs[i] * w;
      brightSumY += ys[i] * w;
    }
  }
  const peakLightX = brightWeightSum > 0 ? brightSumX / brightWeightSum : meanX;
  const peakLightY = brightWeightSum > 0 ? brightSumY / brightWeightSum : meanY;

  let solidErrSum = 0;
  let solidDeSum = 0;
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
    solidDeSum += deltaEOklab(sampleL[i], sampleOkA[i], sampleOkB[i], meanL, meanOkA, meanOkB);
  }
  const solidMae = solidErrSum / actualSamples;
  const solidMeanDe = solidDeSum / actualSamples;
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

  if (
    regionNature === 'uniform' ||
    actualSamples < 10 ||
    colorSpan <= 9 ||
    (solidMeanDe <= 0.95 && solidP95 <= 4)
  ) {
    return {
      kind: 'solid',
      fillValue: solidHex,
      fillOpacity: solidOpacity,
      defsXml: '',
      mae: solidMae,
      p95Error: solidP95,
      meanDeltaEOklab: solidMeanDe,
      evalColorAt: () => [meanR, meanG, meanB, meanA],
    };
  }

  const numBins = regionNature === 'reflection_metallic' ? 23 : 17;
  const pruneTol = regionNature === 'reflection_metallic' ? 0.55 : 0.72;
  const projBuf = new Float32Array(actualSamples);

  // 1. Varredura angular completa (0°..170° passo 10° + refinamento de ±2°) para <linearGradient>
  let bestAngleRad = 0;
  let bestLinear = {
    minProj: 0,
    maxProj: 1,
    stops: [] as PerceptualGradientStop[],
    maeRgb: 999,
    p95Rgb: 999,
    meanDeltaE: 999,
  };

  for (let deg = 0; deg < 180; deg += 10) {
    const rad = (deg * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    for (let i = 0; i < actualSamples; i++) {
      projBuf[i] = xs[i] * dx + ys[i] * dy;
    }
    const fit = buildPerceptualStopsAndMeasureError(
      projBuf,
      samplePixels,
      actualSamples,
      data,
      sampleL,
      sampleOkA,
      sampleOkB,
      numBins,
      pruneTol
    );
    if (fit.meanDeltaE < bestLinear.meanDeltaE) {
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
    const fit = buildPerceptualStopsAndMeasureError(
      projBuf,
      samplePixels,
      actualSamples,
      data,
      sampleL,
      sampleOkA,
      sampleOkB,
      numBins,
      pruneTol
    );
    if (fit.meanDeltaE < bestLinear.meanDeltaE) {
      bestLinear = fit;
      bestAngleRad = rad;
    }
  }

  // 2. Teste de <radialGradient>: circular, elíptico anisotrópico E com foco especular deslocado (fx, fy)!
  const cxGeom = (minX + maxX) * 0.5;
  const cyGeom = (minY + maxY) * 0.5;
  const rxBox = Math.max(2, (maxX - minX + 1) * 0.5);
  const ryBox = Math.max(2, (maxY - minY + 1) * 0.5);
  const aspectScaleY = ryBox / rxBox;

  interface RadialCandidateConfig {
    cx: number;
    cy: number;
    fx: number;
    fy: number;
    rOuter: number;
    scaleY: number;
  }

  let minSampleL = 101;
  for (let i = 0; i < actualSamples; i++) {
    if (sampleL[i] < minSampleL) minSampleL = sampleL[i];
  }
  let darkWeightSum = 0;
  let darkSumX = 0;
  let darkSumY = 0;
  for (let i = 0; i < actualSamples; i++) {
    if (sampleL[i] <= minSampleL + 4.5) {
      const w = 1 + (minSampleL + 4.5 - sampleL[i]);
      darkWeightSum += w;
      darkSumX += xs[i] * w;
      darkSumY += ys[i] * w;
    }
  }
  const peakDarkX = darkWeightSum > 0 ? darkSumX / darkWeightSum : meanX;
  const peakDarkY = darkWeightSum > 0 ? darkSumY / darkWeightSum : meanY;

  const makeRadialCandidate = (
    cx: number,
    cy: number,
    rawFx: number,
    rawFy: number,
    scaleY: number
  ): RadialCandidateConfig => {
    const invSy = 1 / Math.max(0.05, scaleY);
    let maxR = 1.5;
    for (let i = 0; i < actualSamples; i++) {
      const d = Math.hypot(xs[i] - cx, (ys[i] - cy) * invSy);
      if (d > maxR) maxR = d;
    }
    const fDist = Math.hypot(rawFx - cx, (rawFy - cy) * invSy);
    const clampScale = fDist > maxR * 0.84 ? (maxR * 0.84) / fDist : 1;
    return {
      cx,
      cy,
      fx: cx + (rawFx - cx) * clampScale,
      fy: cy + (rawFy - cy) * clampScale,
      rOuter: maxR,
      scaleY,
    };
  };

  const radialCandidates: RadialCandidateConfig[] = [
    makeRadialCandidate(cxGeom, cyGeom, cxGeom, cyGeom, 1),
    makeRadialCandidate(meanX, meanY, meanX, meanY, 1),
    makeRadialCandidate(cxGeom, cyGeom, cxGeom, cyGeom, aspectScaleY),
    makeRadialCandidate(meanX, meanY, meanX, meanY, aspectScaleY),
    // Candidatos focais deslocados W3C (iluminação 3D / esfera / reflexo especular / sombra focal!)
    makeRadialCandidate(cxGeom, cyGeom, peakLightX, peakLightY, 1),
    makeRadialCandidate(cxGeom, cyGeom, peakLightX, peakLightY, aspectScaleY),
    makeRadialCandidate(cxGeom, cyGeom, peakDarkX, peakDarkY, 1),
  ];

  let bestRadialCfg = radialCandidates[0];
  let bestRadial = {
    minProj: 0,
    maxProj: 1,
    stops: [] as PerceptualGradientStop[],
    maeRgb: 999,
    p95Rgb: 999,
    meanDeltaE: 999,
  };

  for (const cfg of radialCandidates) {
    const invSy = 1 / Math.max(0.05, cfg.scaleY);
    // Projeta parâmetro exato W3C SVG <radialGradient cx cy r fx fy> escalado por rOuter
    for (let i = 0; i < actualSamples; i++) {
      projBuf[i] =
        computeW3cSvgRadialT(
          xs[i],
          ys[i],
          cfg.cx,
          cfg.cy,
          cfg.rOuter,
          cfg.fx,
          cfg.fy,
          invSy
        ) * cfg.rOuter;
    }
    const fit = buildPerceptualStopsAndMeasureError(
      projBuf,
      samplePixels,
      actualSamples,
      data,
      sampleL,
      sampleOkA,
      sampleOkB,
      Math.max(15, numBins - 2),
      pruneTol
    );
    if (fit.meanDeltaE < bestRadial.meanDeltaE) {
      bestRadial = fit;
      bestRadialCfg = cfg;
    }
  }

  const useRadial = bestRadial.meanDeltaE + 0.12 < bestLinear.meanDeltaE;
  const bestGrad = useRadial ? bestRadial : bestLinear;

  if (bestGrad.stops.length < 2 || bestGrad.meanDeltaE + 0.25 >= solidMeanDe) {
    return {
      kind: 'solid',
      fillValue: solidHex,
      fillOpacity: solidOpacity,
      defsXml: '',
      mae: solidMae,
      p95Error: solidP95,
      meanDeltaEOklab: solidMeanDe,
      evalColorAt: () => [meanR, meanG, meanB, meanA],
    };
  }

  const stopTags = formatStopsXml(bestGrad.stops);

  if (useRadial) {
    const { cx, cy, fx, fy, rOuter, scaleY } = bestRadialCfg;
    const rUnscaled = Math.max(1.5, bestRadial.maxProj, rOuter * 0.96);
    const rScaled = Number((rUnscaled * coordScaleFactor).toFixed(2));
    const cxScaled = Number((cx * coordScaleFactor).toFixed(2));
    const cyScaled = Number((cy * coordScaleFactor).toFixed(2));

    let focalAttr = '';
    const invSy = 1 / Math.max(0.05, scaleY);
    const fDist = Math.hypot(fx - cx, (fy - cy) * invSy);
    if (fDist > 0.75) {
      const fxClamped = Number((fx * coordScaleFactor).toFixed(2));
      const fyClamped = Number((fy * coordScaleFactor).toFixed(2));
      focalAttr = ` fx="${fxClamped}" fy="${fyClamped}"`;
    }

    const syClean = Number(scaleY.toFixed(4));
    const transformAttr =
      Math.abs(scaleY - 1) > 0.04
        ? ` gradientTransform="translate(${cxScaled} ${cyScaled}) scale(1 ${syClean}) translate(${-cxScaled} ${-cyScaled})"`
        : '';

    // Renormaliza stops para [minProj..rUnscaled] -> [0..1] para alinhamento exato com rScaled!
    const normStops: PerceptualGradientStop[] = bestRadial.stops.map((st) => {
      const rawDist = bestRadial.minProj + st.t * (bestRadial.maxProj - bestRadial.minProj);
      return {
        ...st,
        t: Math.max(0, Math.min(1, rawDist / rUnscaled)),
      };
    });
    const radialStopTags = formatStopsXml(normStops);

    const defsXml = `<radialGradient id="${gradId}" gradientUnits="userSpaceOnUse" cx="${cxScaled}" cy="${cyScaled}" r="${rScaled}"${focalAttr}${transformAttr}>${radialStopTags}</radialGradient>`;

    return {
      kind: 'radial',
      fillValue: `url(#${gradId})`,
      defsXml,
      mae: bestRadial.maeRgb,
      p95Error: bestRadial.p95Rgb,
      meanDeltaEOklab: bestRadial.meanDeltaE,
      evalColorAt: (x: number, y: number) => {
        const t = computeW3cSvgRadialT(x, y, cx, cy, rUnscaled, fx, fy, invSy);
        const ev = evalStopsOklabAndRgba(normStops, t);
        return [ev.r, ev.g, ev.b, ev.a];
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

  const baseEvalAt = (x: number, y: number): [number, number, number, number] => {
    const p = x * dirX + y * dirY;
    const ev = evalStopsOklabAndRgba(bestLinear.stops, (p - bestLinear.minProj) / linRange);
    return [ev.r, ev.g, ev.b, ev.a];
  };

  // 3. Se o gradiente linear 1D ainda deixa variação ortogonal 2D relevante (ex.: iluminação curva ou metal),
  // sintetiza uma camada secundária de gradiente composto sobreposto!
  let overlayLayer: OverlaySvgLayer | undefined;
  if (bestLinear.meanDeltaE >= 2.3 && actualSamples >= 60) {
    const fittedOverlay = tryFitCompoundResidualOverlay(
      xs,
      ys,
      actualSamples,
      sampleL,
      sampleOkA,
      sampleOkB,
      baseEvalAt,
      bestAngleRad,
      meanX,
      meanY,
      coordScaleFactor,
      `${gradId}-comp`
    );
    if (fittedOverlay) {
      overlayLayer = fittedOverlay;
    }
  }

  return {
    kind: overlayLayer ? 'compound' : 'linear',
    fillValue: `url(#${gradId})`,
    defsXml,
    overlayLayer,
    mae: bestLinear.maeRgb,
    p95Error: bestLinear.p95Rgb,
    meanDeltaEOklab: bestLinear.meanDeltaE,
    evalColorAt: baseEvalAt,
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
      if (fit.overlayLayer?.defsXml) {
        defsList.push(fit.overlayLayer.defsXml);
      }
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
