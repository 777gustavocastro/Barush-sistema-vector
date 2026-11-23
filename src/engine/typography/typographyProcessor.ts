import type { RawRgbaImage, TypographyRegion } from '../types';
import { traceMaskToFlatBezierPathData } from '../vectorizers/potraceEngine';
import { upscaleRgbaCatmullRom } from '../image-processing/filters';
import { fitRegionSvgFill } from '../gradients/svgGradientReconstructor';

interface GlyphCandidate {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  area: number;
  rMean: number;
  gMean: number;
  bMean: number;
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
      .join('')
  );
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  return [
    parseInt(c.slice(0, 2), 16),
    parseInt(c.slice(2, 4), 16),
    parseInt(c.slice(4, 6), 16),
  ];
}

/**
 * Detecção estrutural tipo OCR geométrico (MSER / limiar adaptativo por imagem integral + análise
 * de colinearidade de linha de base, altura x-height/cap-height, espessura de haste e kerning).
 */
export function detectTypographyRegions(image: RawRgbaImage): TypographyRegion[] {
  const { width, height, data } = image;
  const totalPixels = width * height;
  if (width < 40 || height < 20 || totalPixels > 3_500_000) {
    return [];
  }

  const lum = new Float32Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const a = data[idx + 3] / 255;
    const r = data[idx] * a + 255 * (1 - a);
    const g = data[idx + 1] * a + 255 * (1 - a);
    const b = data[idx + 2] * a + 255 * (1 - a);
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y++) {
    let rowSum = 0;
    for (let x = 1; x <= width; x++) {
      rowSum += lum[(y - 1) * width + (x - 1)];
      integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + rowSum;
    }
  }

  const winRadius = Math.max(6, Math.min(24, Math.round(Math.min(width, height) * 0.04)));
  const candidates: GlyphCandidate[] = [];

  for (const polarity of ['dark_on_light', 'light_on_dark'] as const) {
    const mask = new Uint8Array(totalPixels);
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - winRadius);
      const y1 = Math.min(height, y + winRadius + 1);
      for (let x = 0; x < width; x++) {
        const px = y * width + x;
        if (data[px * 4 + 3] < 90) continue;

        const x0 = Math.max(0, x - winRadius);
        const x1 = Math.min(width, x + winRadius + 1);
        const area = (x1 - x0) * (y1 - y0);
        const sum =
          integral[y1 * (width + 1) + x1] -
          integral[y0 * (width + 1) + x1] -
          integral[y1 * (width + 1) + x0] +
          integral[y0 * (width + 1) + x0];
        const localMean = sum / area;
        const diff = polarity === 'dark_on_light' ? localMean - lum[px] : lum[px] - localMean;
        if (diff >= 24) {
          mask[px] = 1;
        }
      }
    }

    const visited = new Uint8Array(totalPixels);
    const queue = new Int32Array(Math.min(totalPixels, 65536));
    const minGlyphH = 6;
    const maxGlyphH = Math.max(18, Math.round(height * 0.3));

    for (let start = 0; start < totalPixels; start++) {
      if (!mask[start] || visited[start]) continue;

      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      visited[start] = 1;

      let minX = width, maxX = 0, minY = height, maxY = 0;
      let rSum = 0, gSum = 0, bSum = 0;
      let area = 0;
      let overflowed = false;

      while (head < tail) {
        const px = queue[head++];
        const x = px % width;
        const y = (px - x) / width;
        const idx = px * 4;
        area++;
        rSum += data[idx];
        gSum += data[idx + 1];
        bSum += data[idx + 2];

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const nPx = ny * width + nx;
            if (mask[nPx] && !visited[nPx]) {
              visited[nPx] = 1;
              if (tail < queue.length) {
                queue[tail++] = nPx;
              } else {
                overflowed = true;
              }
            }
          }
        }
      }

      if (overflowed) continue;

      const gw = maxX - minX + 1;
      const gh = maxY - minY + 1;
      const bboxArea = gw * gh;
      const fillRatio = area / Math.max(1, bboxArea);
      const aspect = gw / Math.max(1, gh);

      if (
        gh >= minGlyphH &&
        gh <= maxGlyphH &&
        gw >= 2 &&
        aspect >= 0.1 &&
        aspect <= 3.4 &&
        fillRatio >= 0.11 &&
        fillRatio <= 0.88 &&
        area >= 8
      ) {
        candidates.push({
          minX,
          minY,
          maxX,
          maxY,
          width: gw,
          height: gh,
          area,
          rMean: rSum / area,
          gMean: gSum / area,
          bMean: bSum / area,
        });
      }
    }
  }

  if (candidates.length < 3) {
    return [];
  }

  candidates.sort((a, b) => a.minX - b.minX);
  const used = new Uint8Array(candidates.length);
  const regions: TypographyRegion[] = [];

  for (let i = 0; i < candidates.length; i++) {
    if (used[i]) continue;
    const seed = candidates[i];
    const lineGroup: GlyphCandidate[] = [seed];
    used[i] = 1;

    let lastGlyph = seed;
    for (let j = i + 1; j < candidates.length; j++) {
      if (used[j]) continue;
      const cand = candidates[j];

      const heightRatio =
        Math.max(lastGlyph.height, cand.height) / Math.max(1, Math.min(lastGlyph.height, cand.height));
      const baselineDiff = Math.abs(cand.maxY - seed.maxY);
      const toplineDiff = Math.abs(cand.minY - seed.minY);
      const horizGap = cand.minX - lastGlyph.maxX;
      const colorDist = Math.hypot(
        cand.rMean - seed.rMean,
        cand.gMean - seed.gMean,
        cand.bMean - seed.bMean
      );

      if (
        heightRatio <= 1.6 &&
        (baselineDiff <= seed.height * 0.34 || toplineDiff <= seed.height * 0.34) &&
        horizGap >= -2 &&
        horizGap <= seed.height * 2.2 &&
        colorDist <= 48
      ) {
        lineGroup.push(cand);
        used[j] = 1;
        lastGlyph = cand;
      }
    }

    if (lineGroup.length >= 3) {
      let rx0 = width, ry0 = height, rx1 = 0, ry1 = 0;
      let rSum = 0, gSum = 0, bSum = 0;
      let highFillSquareCount = 0;
      for (const g of lineGroup) {
        if (g.minX < rx0) rx0 = g.minX;
        if (g.minY < ry0) ry0 = g.minY;
        if (g.maxX > rx1) rx1 = g.maxX;
        if (g.maxY > ry1) ry1 = g.maxY;
        rSum += g.rMean;
        gSum += g.gMean;
        bSum += g.bMean;
        const fillR = g.area / Math.max(1, g.width * g.height);
        const sqAspect = g.width / Math.max(1, g.height);
        if (fillR > 0.74 && sqAspect >= 0.78 && sqAspect <= 1.28) {
          highFillSquareCount++;
        }
      }

      // Rejeita grades geométricas periódicas (ex.: matriz de blocos/círculos sólidos repetitivos)
      if (highFillSquareCount >= lineGroup.length * 0.75) {
        continue;
      }

      const lineW = rx1 - rx0 + 1;
      const lineH = ry1 - ry0 + 1;
      if (lineW < lineH * 1.9) {
        continue;
      }

      const inkR = rSum / lineGroup.length;
      const inkG = gSum / lineGroup.length;
      const inkB = bSum / lineGroup.length;

      const pad = 3;
      const x = Math.max(0, rx0 - pad);
      const y = Math.max(0, ry0 - pad);
      const rw = Math.min(width - x, rx1 - rx0 + 1 + pad * 2);
      const rh = Math.min(height - y, ry1 - ry0 + 1 + pad * 2);

      let borderR = 0, borderG = 0, borderB = 0, borderCount = 0;
      let borderCleanBgCount = 0;
      const borderSamples: Array<[number, number]> = [];
      for (let bx = x; bx < x + rw; bx += 2) {
        borderSamples.push([bx, y], [bx, y + rh - 1]);
      }
      for (let by = y; by < y + rh; by += 2) {
        borderSamples.push([x, by], [x + rw - 1, by]);
      }
      for (const [sx, sy] of borderSamples) {
        const idx = (sy * width + sx) * 4;
        if (data[idx + 3] >= 180) {
          borderR += data[idx];
          borderG += data[idx + 1];
          borderB += data[idx + 2];
          borderCount++;
          if (Math.hypot(data[idx] - inkR, data[idx + 1] - inkG, data[idx + 2] - inkB) >= 42) {
            borderCleanBgCount++;
          }
        }
      }

      const bgR = borderCount > 0 ? borderR / borderCount : 255;
      const bgG = borderCount > 0 ? borderG / borderCount : 255;
      const bgB = borderCount > 0 ? borderB / borderCount : 255;
      const inkBgContrast = Math.hypot(inkR - bgR, inkG - bgG, inkB - bgB);
      const cleanPerimeterRatio =
        borderSamples.length > 0 && borderCount >= borderSamples.length * 0.65
          ? borderCleanBgCount / borderCount
          : 0;

      // Rejeita letras com contorno oco ou contorno duplo (múltiplas transições por linha de varredura)
      // para que o motor topológico planar reconstrua fielmente cada anel concêntrico (preenchimento + bordas)!
      let scanRowCount = 0;
      let totalInkRuns = 0;
      const sampleStepY = Math.max(1, Math.floor(rh / 8));
      for (let sy = y + 2; sy < y + rh - 2; sy += sampleStepY) {
        let runsInRow = 0;
        let inInk = false;
        for (let sx = x; sx < x + rw; sx++) {
          const pIdx = (sy * width + sx) * 4;
          const isInkPx =
            data[pIdx + 3] >= 120 &&
            Math.hypot(data[pIdx] - inkR, data[pIdx + 1] - inkG, data[pIdx + 2] - inkB) <
              Math.hypot(data[pIdx] - bgR, data[pIdx + 1] - bgG, data[pIdx + 2] - bgB) * 0.88;
          if (isInkPx && !inInk) {
            runsInRow++;
            inInk = true;
          } else if (!isInkPx) {
            inInk = false;
          }
        }
        if (runsInRow > 0) {
          totalInkRuns += runsInRow;
          scanRowCount++;
        }
      }
      const avgRunsPerGlyphPerRow =
        scanRowCount > 0 ? totalInkRuns / scanRowCount / Math.max(1, lineGroup.length) : 0;
      const hasHollowOrDoubleOutline = avgRunsPerGlyphPerRow >= 2.45;

      // Rejeita caixas que contenham elementos internos de uma 3ª cor distinta (ex.: letras contornadas multicoloridas ou ícones!)
      let thirdColorPixels = 0;
      let totalBoxSamples = 0;
      for (let by = y; by < y + rh; by += 2) {
        for (let bx = x; bx < x + rw; bx += 2) {
          const pIdx = (by * width + bx) * 4;
          if (data[pIdx + 3] < 150) continue;
          totalBoxSamples++;
          const pr = data[pIdx];
          const pg = data[pIdx + 1];
          const pb = data[pIdx + 2];
          // Verifica se o pixel NÃO está sobre o segmento linear [bg, ink] (resíduo ortogonal > 32)
          const vx = inkR - bgR;
          const vy = inkG - bgG;
          const vz = inkB - bgB;
          const denom = Math.max(1, vx * vx + vy * vy + vz * vz);
          const t = Math.max(
            0,
            Math.min(1, ((pr - bgR) * vx + (pg - bgG) * vy + (pb - bgB) * vz) / denom)
          );
          const ortho = Math.hypot(pr - (bgR + t * vx), pg - (bgG + t * vy), pb - (bgB + t * vz));
          if (ortho > 52) {
            thirdColorPixels++;
          }
        }
      }
      const thirdColorRatio = totalBoxSamples > 0 ? thirdColorPixels / totalBoxSamples : 0;

      if (
        inkBgContrast >= 60 &&
        cleanPerimeterRatio >= 0.72 &&
        thirdColorRatio < 0.025 &&
        !hasHollowOrDoubleOutline
      ) {
        regions.push({
          id: `tipografia-${regions.length + 1}`,
          x,
          y,
          width: rw,
          height: rh,
          glyphCount: lineGroup.length,
          isSingleColorInk: true,
          inkHex: rgbToHex(inkR, inkG, inkB),
          backgroundHex: rgbToHex(bgR, bgG, bgB),
          confidence: Math.min(0.99, Number((0.65 + lineGroup.length * 0.05).toFixed(2))),
        });
      }
    }
  }

  return regions;
}

/**
 * Gera uma máscara binária exata (`width × height`) cobrindo APENAS os pixels de tinta das letras
 * detectadas (+ 1px de halo de anti-aliasing), permitindo curar o substrato sob o texto sem jamais
 * furar caixas retangulares em faixas, escudos ou fundos coloridos!
 */
export function buildExactTypographyInkMask(
  image: RawRgbaImage,
  regions: TypographyRegion[],
  scaleFromOriginal = 1
): Uint8Array | undefined {
  if (regions.length === 0) return undefined;
  const { width, height, data } = image;
  const mask = new Uint8Array(width * height);
  let marked = 0;

  for (const reg of regions) {
    const x0 = Math.max(0, Math.floor(reg.x * scaleFromOriginal) - 2);
    const y0 = Math.max(0, Math.floor(reg.y * scaleFromOriginal) - 2);
    const x1 = Math.min(width, Math.ceil((reg.x + reg.width) * scaleFromOriginal) + 2);
    const y1 = Math.min(height, Math.ceil((reg.y + reg.height) * scaleFromOriginal) + 2);

    const [inkR, inkG, inkB] = hexToRgbTuple(reg.inkHex);
    const [bgR, bgG, bgB] = hexToRgbTuple(reg.backgroundHex);

    const vx = inkR - bgR;
    const vy = inkG - bgG;
    const vz = inkB - bgB;
    const segLenSq = Math.max(1, vx * vx + vy * vy + vz * vz);

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const px = y * width + x;
        const idx = px * 4;
        if (data[idx + 3] < 30) continue;
        const pr = data[idx];
        const pg = data[idx + 1];
        const pb = data[idx + 2];
        const dInk = Math.hypot(pr - inkR, pg - inkG, pb - inkB);
        const dBg = Math.hypot(pr - bgR, pg - bgG, pb - bgB);
        const t = ((pr - bgR) * vx + (pg - bgG) * vy + (pb - bgB) * vz) / segLenSq;
        const projR = bgR + Math.max(0, Math.min(1, t)) * vx;
        const projG = bgG + Math.max(0, Math.min(1, t)) * vy;
        const projB = bgB + Math.max(0, Math.min(1, t)) * vz;
        const ortho = Math.hypot(pr - projR, pg - projG, pb - projB);

        // Captura 100% do núcleo e toda a rampa gama/sub-pixel de anti-aliasing (>= 1.8% de tinta)
        if ((t >= 0.018 && dBg >= 3 && ortho <= 55) || (dInk < dBg * 1.45 && dBg >= 5)) {
          mask[px] = 1;
          marked++;
        }
      }
    }
  }

  if (marked === 0) return undefined;

  // Dilatação morfológica de 3px garante 0% de halo residual nas bordas das letras antes do inpainting!
  let curr = mask;
  for (let pass = 0; pass < 3; pass++) {
    const dilated = new Uint8Array(curr);
    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const p = row + x;
        if (curr[p]) {
          dilated[p - 1] = 1;
          dilated[p + 1] = 1;
          dilated[p - width] = 1;
          dilated[p + width] = 1;
          dilated[p - width - 1] = 1;
          dilated[p - width + 1] = 1;
          dilated[p + width - 1] = 1;
          dilated[p + width + 1] = 1;
        }
      }
    }
    curr = dilated;
  }

  return curr;
}

interface IsolatedLetterBlob {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixels: number[];
}

/**
 * Reconstrói cada linha tipográfica separando CADA LETRA INDIVIDUALMENTE como seu próprio
 * caminho vetorial editável (<path id="letra-L-K" d="..."/>) com super-amostragem 3× sub-pixel,
 * preservando kerning, espessura de haste, alinhamento, olhos internos (A, B, O, R, e) e acentos!
 */
export async function reconstructHighPrecisionTypographySvg(
  sourceImage: RawRgbaImage,
  regions: TypographyRegion[],
  parentCoordScaleFactor: number,
  startingObjectIndex = 100
): Promise<{ defsXml: string; groupsXml: string; letterPathCount: number }> {
  if (regions.length === 0) {
    return { defsXml: '', groupsXml: '', letterPathCount: 0 };
  }

  const defsList: string[] = [];
  const groups: string[] = [];
  let letterPathCount = 0;

  for (let rIdx = 0; rIdx < regions.length; rIdx++) {
    const reg = regions[rIdx];
    const cropData = new Uint8Array(reg.width * reg.height * 4);
    for (let ry = 0; ry < reg.height; ry++) {
      const srcOffset = ((reg.y + ry) * sourceImage.width + reg.x) * 4;
      const dstOffset = ry * reg.width * 4;
      cropData.set(sourceImage.data.subarray(srcOffset, srcOffset + reg.width * 4), dstOffset);
    }

    const cropImg: RawRgbaImage = {
      data: cropData,
      width: reg.width,
      height: reg.height,
    };

    const superFactor: 2 | 3 = Math.max(reg.width, reg.height) <= 420 ? 3 : 2;
    const upscaled = upscaleRgbaCatmullRom(cropImg, superFactor);
    const uw = upscaled.width;
    const uh = upscaled.height;

    const [inkR, inkG, inkB] = hexToRgbTuple(reg.inkHex);
    const [bgR, bgG, bgB] = hexToRgbTuple(reg.backgroundHex);

    const glyphMask = new Uint8Array(uw * uh);
    for (let i = 0; i < glyphMask.length; i++) {
      const idx = i * 4;
      if (upscaled.data[idx + 3] < 105) continue;
      const r = upscaled.data[idx];
      const g = upscaled.data[idx + 1];
      const b = upscaled.data[idx + 2];
      const dInk = Math.hypot(r - inkR, g - inkG, b - inkB);
      const dBg = Math.hypot(r - bgR, g - bgG, b - bgB);
      if (dInk < dBg * 0.92) {
        glyphMask[i] = 1;
      }
    }

    // Isola componentes conexos das letras em resolução 3×
    const visited = new Uint8Array(uw * uh);
    const queue = new Int32Array(uw * uh);
    const rawBlobs: IsolatedLetterBlob[] = [];

    for (let s = 0; s < glyphMask.length; s++) {
      if (!glyphMask[s] || visited[s]) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = s;
      visited[s] = 1;

      let minX = uw, maxX = 0, minY = uh, maxY = 0;
      const pxList: number[] = [];

      while (head < tail) {
        const px = queue[head++];
        pxList.push(px);
        const x = px % uw;
        const y = (px - x) / uw;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= uh) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= uw) continue;
            const nPx = ny * uw + nx;
            if (glyphMask[nPx] && !visited[nPx]) {
              visited[nPx] = 1;
              queue[tail++] = nPx;
            }
          }
        }
      }

      if (pxList.length >= 4) {
        rawBlobs.push({ minX, minY, maxX, maxY, pixels: pxList });
      }
    }

    if (rawBlobs.length === 0) continue;

    // Agrupa pingos/acentos (i, j, é, ã, ç) à haste base alinhada verticalmente
    rawBlobs.sort((a, b) => b.pixels.length - a.pixels.length);
    const mergedFlags = new Uint8Array(rawBlobs.length);
    const letters: IsolatedLetterBlob[] = [];

    for (let i = 0; i < rawBlobs.length; i++) {
      if (mergedFlags[i]) continue;
      const base = rawBlobs[i];
      mergedFlags[i] = 1;

      for (let j = i + 1; j < rawBlobs.length; j++) {
        if (mergedFlags[j]) continue;
        const accent = rawBlobs[j];
        const accentCenterX = (accent.minX + accent.maxX) * 0.5;
        const horizAligned = accentCenterX >= base.minX - 3 && accentCenterX <= base.maxX + 3;
        const vertClose =
          Math.abs(base.minY - accent.maxY) <= uh * 0.35 ||
          Math.abs(accent.minY - base.maxY) <= uh * 0.35;
        if (horizAligned && vertClose && accent.pixels.length < base.pixels.length * 0.45) {
          for (const p of accent.pixels) base.pixels.push(p);
          base.minX = Math.min(base.minX, accent.minX);
          base.minY = Math.min(base.minY, accent.minY);
          base.maxX = Math.max(base.maxX, accent.maxX);
          base.maxY = Math.max(base.maxY, accent.maxY);
          mergedFlags[j] = 1;
        }
      }
      letters.push(base);
    }

    // Ordena letras da esquerda para a direita (ordem natural de leitura e edição)
    letters.sort((a, b) => a.minX - b.minX);

    const elemScale = parentCoordScaleFactor / superFactor;
    const baseOffsetX = reg.x * parentCoordScaleFactor;
    const baseOffsetY = reg.y * parentCoordScaleFactor;

    const letterPathsXml: string[] = [];

    for (let lIdx = 0; lIdx < letters.length; lIdx++) {
      const letter = letters[lIdx];
      const pad = 2;
      const lx0 = Math.max(0, letter.minX - pad);
      const ly0 = Math.max(0, letter.minY - pad);
      const lw = Math.min(uw - lx0, letter.maxX - letter.minX + 1 + pad * 2);
      const lh = Math.min(uh - ly0, letter.maxY - letter.minY + 1 + pad * 2);

      const localMask = new Uint8Array(lw * lh);
      const upscaledPxTyped = new Int32Array(letter.pixels.length);
      for (let p = 0; p < letter.pixels.length; p++) {
        const px = letter.pixels[p];
        upscaledPxTyped[p] = px;
        const x = (px % uw) - lx0;
        const y = Math.floor(px / uw) - ly0;
        localMask[y * lw + x] = 1;
      }

      const dList = await traceMaskToFlatBezierPathData(
        localMask,
        lw,
        lh,
        baseOffsetX + lx0 * elemScale,
        baseOffsetY + ly0 * elemScale,
        elemScale,
        { alphamax: 1.0, opttolerance: 0.16 * superFactor, turdsize: superFactor * superFactor }
      );

      if (dList.length === 0) continue;

      // Amostra apenas o núcleo interior da letra (erodido pelo fator de supersampling) para
      // não confundir a rampa de anti-aliasing da borda com um falso gradiente radial na letra!
      const corePixelsBuf: number[] = [];
      const erodeR = Math.max(1, superFactor);
      for (let p = 0; p < letter.pixels.length; p++) {
        const px = letter.pixels[p];
        const lx = (px % uw) - lx0;
        const ly = Math.floor(px / uw) - ly0;
        let isInterior = true;
        for (let dy = -erodeR; dy <= erodeR && isInterior; dy++) {
          const ny = ly + dy;
          if (ny < 0 || ny >= lh) {
            isInterior = false;
            break;
          }
          for (let dx = -erodeR; dx <= erodeR; dx++) {
            const nx = lx + dx;
            if (nx < 0 || nx >= lw || !localMask[ny * lw + nx]) {
              isInterior = false;
              break;
            }
          }
        }
        if (isInterior) {
          corePixelsBuf.push(px);
        }
      }

      const sampleTyped =
        corePixelsBuf.length >= 12 ? Int32Array.from(corePixelsBuf) : upscaledPxTyped;

      // Verifica se a letra possui cor sólida genuína ou degradê próprio no núcleo da tinta
      const fillFit = fitRegionSvgFill(
        sampleTyped,
        sampleTyped.length,
        letter.minX,
        letter.minY,
        letter.maxX,
        letter.maxY,
        upscaled,
        elemScale,
        `grad-letra-${rIdx + 1}-${lIdx + 1}`
      );

      let fillAttr = fillFit.kind === 'solid' ? fillFit.fillValue || reg.inkHex : reg.inkHex;
      if (fillFit.kind !== 'solid' && fillFit.defsXml && corePixelsBuf.length >= 24) {
        // Ajusta coordenadas do gradiente da letra somando (baseOffsetX, baseOffsetY)
        const shiftedDefs = fillFit.defsXml
          .replace(/\bx1="([^"]+)"/, (_, v) => `x1="${(Number(v) + baseOffsetX).toFixed(2)}"`)
          .replace(/\by1="([^"]+)"/, (_, v) => `y1="${(Number(v) + baseOffsetY).toFixed(2)}"`)
          .replace(/\bx2="([^"]+)"/, (_, v) => `x2="${(Number(v) + baseOffsetX).toFixed(2)}"`)
          .replace(/\by2="([^"]+)"/, (_, v) => `y2="${(Number(v) + baseOffsetY).toFixed(2)}"`)
          .replace(/\bcx="([^"]+)"/, (_, v) => `cx="${(Number(v) + baseOffsetX).toFixed(2)}"`)
          .replace(/\bcy="([^"]+)"/, (_, v) => `cy="${(Number(v) + baseOffsetY).toFixed(2)}"`)
          .replace(/\bfx="([^"]+)"/, (_, v) => `fx="${(Number(v) + baseOffsetX).toFixed(2)}"`)
          .replace(/\bfy="([^"]+)"/, (_, v) => `fy="${(Number(v) + baseOffsetY).toFixed(2)}"`);
        defsList.push(shiftedDefs);
        fillAttr = fillFit.fillValue;
      }

      // Combina subpaths externos + olhos internos (ex: A, B, O, R, e) em um único <path> composto por letra!
      const compoundD = dList.join(' ');
      const subPathMoves = (compoundD.match(/M[\s\d.-]/g) ?? []).length;
      const evenOddAttr = subPathMoves > 1 ? ' fill-rule="evenodd"' : '';
      letterPathCount++;
      letterPathsXml.push(
        `<path id="letra-${rIdx + 1}-${lIdx + 1}" fill="${fillAttr}"${evenOddAttr} d="${compoundD}"/>`
      );
    }

    if (letterPathsXml.length > 0) {
      // Estima características tipográficas de referência (peso, inclinação e espaçamento médio)
      let totalFillRatio = 0;
      let gapSum = 0;
      let gapCount = 0;
      let slantSum = 0;
      for (let k = 0; k < letters.length; k++) {
        const L = letters[k];
        const wL = Math.max(1, L.maxX - L.minX + 1);
        const hL = Math.max(1, L.maxY - L.minY + 1);
        totalFillRatio += L.pixels.length / (wL * hL);
        if (k > 0) {
          gapSum += (L.minX - letters[k - 1].maxX) * elemScale;
          gapCount++;
        }
        // Estima inclinação itálica comparando centroide X do terço superior vs terço inferior
        let topX = 0, topN = 0, botX = 0, botN = 0;
        const yTopLim = L.minY + hL * 0.35;
        const yBotLim = L.maxY - hL * 0.35;
        for (const p of L.pixels) {
          const py = Math.floor(p / uw);
          const px = p % uw;
          if (py <= yTopLim) {
            topX += px;
            topN++;
          } else if (py >= yBotLim) {
            botX += px;
            botN++;
          }
        }
        if (topN > 0 && botN > 0 && hL >= 9) {
          slantSum += (topX / topN - botX / botN) / hL;
        }
      }

      const avgFill = totalFillRatio / letters.length;
      const estimatedWeight = avgFill >= 0.44 ? 'bold' : avgFill <= 0.24 ? 'light' : 'regular';
      const avgSlant = slantSum / letters.length;
      const estimatedStyle = Math.abs(avgSlant) >= 0.14 ? 'italic' : 'normal';
      const avgKerning = gapCount > 0 ? Number((gapSum / gapCount).toFixed(2)) : 0;

      const objId = `objeto-${startingObjectIndex + rIdx}`;
      groups.push(
        `<g id="${objId}" data-tipo="tipografia-vetorial" data-letras="${letterPathsXml.length}" data-peso="${estimatedWeight}" data-inclinacao="${estimatedStyle}" data-espacamento-medio="${avgKerning}">${letterPathsXml.join('')}</g>`
      );
    }
  }

  return {
    defsXml: defsList.join(''),
    groupsXml: groups.join(''),
    letterPathCount,
  };
}
