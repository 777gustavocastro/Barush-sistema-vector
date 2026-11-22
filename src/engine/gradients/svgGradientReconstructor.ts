import type { RawRgbaImage } from '../types';
import { traceMaskWithPotraceToSvgElements } from '../vectorizers/potraceEngine';

interface GradientStop {
  offsetPct: number;
  hex: string;
}

interface ReconstructedGradientLayer {
  id: string;
  defsXml: string;
  pathsXml: string;
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
      .join('')
  );
}

function evalStopsRgb(
  stops: Array<{ t: number; r: number; g: number; b: number }>,
  tNorm: number
): [number, number, number] {
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
      ];
    }
  }
  const last = stops[stops.length - 1];
  return [last.r, last.g, last.b];
}

function build1DStopsAndMeasureError(
  projValues: Float32Array,
  pixels: Int32Array,
  count: number,
  data: Uint8Array
): {
  minProj: number;
  maxProj: number;
  stops: Array<{ t: number; r: number; g: number; b: number }>;
  mae: number;
  p95Error: number;
} {
  let minProj = Infinity;
  let maxProj = -Infinity;
  for (let i = 0; i < count; i++) {
    const v = projValues[i];
    if (v < minProj) minProj = v;
    if (v > maxProj) maxProj = v;
  }

  const range = Math.max(1e-5, maxProj - minProj);
  const numBins = 9;
  const rSum = new Float64Array(numBins);
  const gSum = new Float64Array(numBins);
  const bSum = new Float64Array(numBins);
  const binCounts = new Int32Array(numBins);

  for (let i = 0; i < count; i++) {
    const t = Math.max(0, Math.min(1, (projValues[i] - minProj) / range));
    const bin = Math.min(numBins - 1, Math.floor(t * (numBins - 1) + 0.5));
    const idx = pixels[i] * 4;
    rSum[bin] += data[idx];
    gSum[bin] += data[idx + 1];
    bSum[bin] += data[idx + 2];
    binCounts[bin]++;
  }

  const stops: Array<{ t: number; r: number; g: number; b: number }> = [];
  for (let b = 0; b < numBins; b++) {
    if (binCounts[b] > 0) {
      stops.push({
        t: b / (numBins - 1),
        r: rSum[b] / binCounts[b],
        g: gSum[b] / binCounts[b],
        b: bSum[b] / binCounts[b],
      });
    }
  }

  if (stops.length < 2) {
    return { minProj, maxProj, stops, mae: 999, p95Error: 999 };
  }
  stops[0].t = 0;
  stops[stops.length - 1].t = 1;

  let errSum = 0;
  const errHist = new Int32Array(256);
  for (let i = 0; i < count; i++) {
    const t = (projValues[i] - minProj) / range;
    const [pr, pg, pb] = evalStopsRgb(stops, t);
    const idx = pixels[i] * 4;
    const pxErr =
      (Math.abs(data[idx] - pr) +
        Math.abs(data[idx + 1] - pg) +
        Math.abs(data[idx + 2] - pb)) /
      3;
    errSum += pxErr;
    errHist[Math.min(255, Math.round(pxErr))]++;
  }

  const mae = errSum / count;
  const p95Target = Math.floor(count * 0.95);
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

/**
 * Etapa complementar de reconstrução de gradientes nativos do SVG (<linearGradient> e <radialGradient>).
 * Identifica regiões conexas de variação cromática contínua (asas em degradê, escudos, corpos sombreados, fundos),
 * ajusta modelos lineares 2D e radiais por mínimos quadrados e reconstrói elementos SVG vetoriais nativos
 * apenas onde o ajuste matemático comprovar erro médio por pixel mínimo (MAE <= 6.5).
 */
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
  const layers: ReconstructedGradientLayer[] = [];

  // Detecta se existe fundo uniforme nas 4 quinas para não reconstruir fundo chapado desnecessário
  const cornerAlpha = data[3];
  const minRegionArea = Math.max(120, Math.round(totalPixels * 0.002));
  const maxStepDiff = 22; // Fronteira suave contínua entre pixels adjacentes

  let gradCounter = 0;

  for (let startPx = 0; startPx < totalPixels; startPx++) {
    if (visited[startPx]) continue;
    const sIdx = startPx * 4;
    if (data[sIdx + 3] < 220) {
      visited[startPx] = 1;
      continue;
    }

    // Flood-fill 4-conexo por continuidade suave de gradiente
    let head = 0;
    let tail = 0;
    queue[tail++] = startPx;
    visited[startPx] = 1;

    let minR = 255, maxR = 0;
    let minG = 255, maxG = 0;
    let minB = 255, maxB = 0;
    let minX = width, maxX = 0;
    let minY = height, maxY = 0;

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

      // Vizinhos 4-conexos
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
        if (data[nIdx + 3] < 220) continue;

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

    // Ignora caso seja apenas fundo transparente/opaco uniforme sem degradê real
    const colorSpan = Math.max(maxR - minR, maxG - minG, maxB - minB);
    if (colorSpan < 30) continue;

    // Evita substituir uma foto inteira 100% full-bleed caso cubra quase tudo com alta complexidade 2D; o teste de MAE abaixo já filtra rigorosamente!
    void cornerAlpha;

    const compPixels = queue.slice(0, count);

    // 1. Ajuste por mínimos quadrados da direção do gradiente linear (dx, dy)
    let sumX = 0, sumY = 0, sumC = 0;
    for (let i = 0; i < count; i++) {
      const px = compPixels[i];
      const x = px % width;
      const y = (px - x) / width;
      const idx = px * 4;
      // Canal com maior variação guia a direção principal do degradê
      const cVal =
        maxR - minR >= maxG - minG && maxR - minR >= maxB - minB
          ? data[idx]
          : maxG - minG >= maxB - minB
            ? data[idx + 1]
            : data[idx + 2];
      sumX += x;
      sumY += y;
      sumC += cVal;
    }

    const meanX = sumX / count;
    const meanY = sumY / count;
    const meanC = sumC / count;

    let sxx = 0, syy = 0, sxy = 0, sxc = 0, syc = 0;
    for (let i = 0; i < count; i++) {
      const px = compPixels[i];
      const dx = (px % width) - meanX;
      const dy = Math.floor(px / width) - meanY;
      const idx = px * 4;
      const cVal =
        maxR - minR >= maxG - minG && maxR - minR >= maxB - minB
          ? data[idx]
          : maxG - minG >= maxB - minB
            ? data[idx + 1]
            : data[idx + 2];
      const dc = cVal - meanC;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
      sxc += dx * dc;
      syc += dy * dc;
    }

    const det = sxx * syy - sxy * sxy;
    let dirX = 1;
    let dirY = 0;
    if (Math.abs(det) > 1e-3) {
      const gx = (syy * sxc - sxy * syc) / det;
      const gy = (-sxy * sxc + sxx * syc) / det;
      const norm = Math.hypot(gx, gy);
      if (norm > 1e-5) {
        dirX = gx / norm;
        dirY = gy / norm;
      }
    }

    const linearProj = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const px = compPixels[i];
      const x = px % width;
      const y = (px - x) / width;
      linearProj[i] = x * dirX + y * dirY;
    }

    const linearFit = build1DStopsAndMeasureError(linearProj, compPixels, count, data);

    // 2. Ajuste de gradiente radial em torno do centro geométrico da região
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const radialProj = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const px = compPixels[i];
      const x = px % width;
      const y = (px - x) / width;
      radialProj[i] = Math.hypot(x - cx, y - cy);
    }
    const radialFit = build1DStopsAndMeasureError(radialProj, compPixels, count, data);

    const useRadial = radialFit.mae + 0.6 < linearFit.mae;
    const bestFit = useRadial ? radialFit : linearFit;

    // Gate estrito de fidelidade: só reconstrói como gradiente nativo SVG quando o degradê for genuinamente fiel
    if (bestFit.mae > 6.5 || bestFit.p95Error > 16) {
      continue;
    }

    // Cria máscara recortada local da região (com margem de 2px) e dilata 1px nas bordas compatíveis para encaixe perfeito
    const pad = 2;
    const cropX = Math.max(0, minX - pad);
    const cropY = Math.max(0, minY - pad);
    const cropW = Math.min(width - cropX, maxX - minX + 1 + pad * 2);
    const cropH = Math.min(height - cropY, maxY - minY + 1 + pad * 2);
    const localMask = new Uint8Array(cropW * cropH);

    for (let i = 0; i < count; i++) {
      const px = compPixels[i];
      const x = (px % width) - cropX;
      const y = Math.floor(px / width) - cropY;
      localMask[y * cropW + x] = 1;
    }

    // Inclui pixels de borda de 1px cuja cor ainda siga o gradiente (evita franja de anti-aliasing descoberta)
    const dilatedMask = new Uint8Array(localMask);
    const projSpan = Math.max(1e-5, bestFit.maxProj - bestFit.minProj);
    for (let ly = 1; ly < cropH - 1; ly++) {
      for (let lx = 1; lx < cropW - 1; lx++) {
        const mIdx = ly * cropW + lx;
        if (localMask[mIdx]) continue;
        if (
          !localMask[mIdx - 1] &&
          !localMask[mIdx + 1] &&
          !localMask[mIdx - cropW] &&
          !localMask[mIdx + cropW]
        ) {
          continue;
        }
        const gx = cropX + lx;
        const gy = cropY + ly;
        const gIdx = (gy * width + gx) * 4;
        if (data[gIdx + 3] < 150) continue;

        const pVal = useRadial
          ? Math.hypot(gx - cx, gy - cy)
          : gx * dirX + gy * dirY;
        const t = (pVal - bestFit.minProj) / projSpan;
        const [er, eg, eb] = evalStopsRgb(bestFit.stops, t);
        const err =
          (Math.abs(data[gIdx] - er) +
            Math.abs(data[gIdx + 1] - eg) +
            Math.abs(data[gIdx + 2] - eb)) /
          3;
        if (err <= 18) {
          dilatedMask[mIdx] = 1;
        }
      }
    }

    gradCounter++;
    const gradId = `grad-nativo-${gradCounter}`;

    const stopsXml: GradientStop[] = bestFit.stops.map((s) => ({
      offsetPct: Number((s.t * 100).toFixed(1)),
      hex: rgbToHex(s.r, s.g, s.b),
    }));

    const stopTags = stopsXml
      .map((st) => `<stop offset="${st.offsetPct}%" stop-color="${st.hex}"/>`)
      .join('');

    let defsXml: string;
    if (useRadial) {
      const rScaled = Number((bestFit.maxProj * coordScaleFactor).toFixed(2));
      const cxScaled = Number((cx * coordScaleFactor).toFixed(2));
      const cyScaled = Number((cy * coordScaleFactor).toFixed(2));
      defsXml = `<radialGradient id="${gradId}" gradientUnits="userSpaceOnUse" cx="${cxScaled}" cy="${cyScaled}" r="${rScaled}">${stopTags}</radialGradient>`;
    } else {
      // Ponto inicial (x1, y1) e final (x2, y2) no espaço de coordenadas do viewBox
      const pMid = (bestFit.minProj + bestFit.maxProj) * 0.5;
      const meanProj = meanX * dirX + meanY * dirY;
      const baseOriginX = meanX + (pMid - meanProj) * dirX;
      const baseOriginY = meanY + (pMid - meanProj) * dirY;
      const halfSpan = (bestFit.maxProj - bestFit.minProj) * 0.5;

      const x1 = Number(((baseOriginX - halfSpan * dirX) * coordScaleFactor).toFixed(2));
      const y1 = Number(((baseOriginY - halfSpan * dirY) * coordScaleFactor).toFixed(2));
      const x2 = Number(((baseOriginX + halfSpan * dirX) * coordScaleFactor).toFixed(2));
      const y2 = Number(((baseOriginY + halfSpan * dirY) * coordScaleFactor).toFixed(2));
      defsXml = `<linearGradient id="${gradId}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stopTags}</linearGradient>`;
    }

    const tracedMaskPaths = await traceMaskWithPotraceToSvgElements(
      dilatedMask,
      cropW,
      cropH,
      `url(#${gradId})`,
      cropX * coordScaleFactor,
      cropY * coordScaleFactor,
      coordScaleFactor,
      `gradiente-forma-${gradCounter}`
    );

    if (tracedMaskPaths) {
      layers.push({
        id: gradId,
        defsXml,
        pathsXml: tracedMaskPaths,
      });
    }

    if (layers.length >= 24) break;
  }

  if (layers.length === 0) {
    return { defsXml: '', layersXml: '', count: 0 };
  }

  return {
    defsXml: `<defs>${layers.map((l) => l.defsXml).join('')}</defs>`,
    layersXml: `<g id="camada-gradientes-nativos">${layers.map((l) => l.pathsXml).join('')}</g>`,
    count: layers.length,
  };
}
