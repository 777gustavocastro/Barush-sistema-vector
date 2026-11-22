import type { RawRgbaImage, TypographyRegion } from '../types';
import { traceMaskWithPotraceToSvgElements } from '../vectorizers/potraceEngine';
import { upscaleRgbaCatmullRom } from '../image-processing/filters';

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

/**
 * Reconhecimento estrutural de regiões tipográficas (glifo por glifo + alinhamento de linha de base):
 * Identifica linhas de texto em logotipos, selos e artes gráficas para protegê-las contra simplificação
 * agressiva e reconstruir cada letra com curvas Bézier sub-pixel de altíssima precisão, sem inventar fontes.
 */
export function detectTypographyRegions(image: RawRgbaImage): TypographyRegion[] {
  const { width, height, data } = image;
  const totalPixels = width * height;
  if (width < 40 || height < 24 || totalPixels > 3_500_000) {
    return [];
  }

  // Calcula luminância composta e borda local para destacar traços tipográficos escuros ou claros
  const lum = new Float32Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const a = data[idx + 3] / 255;
    const r = data[idx] * a + 255 * (1 - a);
    const g = data[idx + 1] * a + 255 * (1 - a);
    const b = data[idx + 2] * a + 255 * (1 - a);
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Média local em janela rápida por imagem integral para limiar adaptativo (detecta texto escuro no claro E claro no escuro)
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
        if (diff >= 26) {
          mask[px] = 1;
        }
      }
    }

    const visited = new Uint8Array(totalPixels);
    const queue = new Int32Array(Math.min(totalPixels, 65536));
    const minGlyphH = 6;
    const maxGlyphH = Math.max(18, Math.round(height * 0.28));

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
        aspect >= 0.12 &&
        aspect <= 3.2 &&
        fillRatio >= 0.12 &&
        fillRatio <= 0.86 &&
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

  // Agrupa candidatos a glifos colineares horizontalmente (mesma linha de base, altura similar e kerning regular)
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
        heightRatio <= 1.55 &&
        (baselineDiff <= seed.height * 0.32 || toplineDiff <= seed.height * 0.32) &&
        horizGap >= -2 &&
        horizGap <= seed.height * 2.1 &&
        colorDist <= 42
      ) {
        lineGroup.push(cand);
        used[j] = 1;
        lastGlyph = cand;
      }
    }

    // Exige pelo menos 4 glifos colineares da mesma cor/altura para evitar falsos positivos em ícones geométricos
    if (lineGroup.length >= 4) {
      let rx0 = width, ry0 = height, rx1 = 0, ry1 = 0;
      let rSum = 0, gSum = 0, bSum = 0;
      for (const g of lineGroup) {
        if (g.minX < rx0) rx0 = g.minX;
        if (g.minY < ry0) ry0 = g.minY;
        if (g.maxX > rx1) rx1 = g.maxX;
        if (g.maxY > ry1) ry1 = g.maxY;
        rSum += g.rMean;
        gSum += g.gMean;
        bSum += g.bMean;
      }

      const inkR = rSum / lineGroup.length;
      const inkG = gSum / lineGroup.length;
      const inkB = bSum / lineGroup.length;

      const pad = 3;
      const x = Math.max(0, rx0 - pad);
      const y = Math.max(0, ry0 - pad);
      const rw = Math.min(width - x, rx1 - rx0 + 1 + pad * 2);
      const rh = Math.min(height - y, ry1 - ry0 + 1 + pad * 2);

      // Amostra a borda da caixa tipográfica para estimar se o fundo imediato da linha de texto é uniforme
      let borderR = 0, borderG = 0, borderB = 0, borderCount = 0;
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
        }
      }

      const bgR = borderCount > 0 ? borderR / borderCount : 255;
      const bgG = borderCount > 0 ? borderG / borderCount : 255;
      const bgB = borderCount > 0 ? borderB / borderCount : 255;
      const inkBgContrast = Math.hypot(inkR - bgR, inkG - bgG, inkB - bgB);

      if (inkBgContrast >= 65) {
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

function hexToRgbTuple(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  return [
    parseInt(c.slice(0, 2), 16),
    parseInt(c.slice(2, 4), 16),
    parseInt(c.slice(4, 6), 16),
  ];
}

/**
 * Reconstrói regiões tipográficas identificadas usando super-amostragem bicúbica 3× e traçado
 * Bézier de altíssima precisão (opttolerance=0.04, sem simplificação destrutiva), preservando
 * integralmente olhos das letras (A, B, R, O, e), hastes finas, serifas e cantos originais.
 */
export async function reconstructHighPrecisionTypographySvg(
  sourceImage: RawRgbaImage,
  regions: TypographyRegion[],
  parentCoordScaleFactor: number
): Promise<string> {
  if (regions.length === 0) return '';

  const groups: string[] = [];

  for (const reg of regions) {
    // Extrai recorte exato da região de texto
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

    // Super-amostragem 3× Catmull-Rom monotônica para contornos sub-pixel perfeitos nas letras
    const superFactor: 2 | 3 = Math.max(reg.width, reg.height) <= 360 ? 3 : 2;
    const upscaled = upscaleRgbaCatmullRom(cropImg, superFactor);

    const [inkR, inkG, inkB] = hexToRgbTuple(reg.inkHex);
    const [bgR, bgG, bgB] = hexToRgbTuple(reg.backgroundHex);

    const glyphMask = new Uint8Array(upscaled.width * upscaled.height);
    for (let i = 0; i < glyphMask.length; i++) {
      const idx = i * 4;
      if (upscaled.data[idx + 3] < 110) continue;
      const r = upscaled.data[idx];
      const g = upscaled.data[idx + 1];
      const b = upscaled.data[idx + 2];
      const dInk = Math.hypot(r - inkR, g - inkG, b - inkB);
      const dBg = Math.hypot(r - bgR, g - bgG, b - bgB);
      if (dInk < dBg * 0.92) {
        glyphMask[i] = 1;
      }
    }

    // Preenche o fundo local atrás das letras antes de desenhar os glifos super-precisos para cobrir qualquer resquício borrado da camada inferior
    const bgPatchMask = new Uint8Array(upscaled.width * upscaled.height);
    for (let i = 0; i < glyphMask.length; i++) {
      if (!glyphMask[i]) continue;
      const gx = i % upscaled.width;
      const gy = (i - gx) / upscaled.width;
      for (let dy = -2; dy <= 2; dy++) {
        const ny = gy + dy;
        if (ny < 0 || ny >= upscaled.height) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const nx = gx + dx;
          if (nx < 0 || nx >= upscaled.width) continue;
          bgPatchMask[ny * upscaled.width + nx] = 1;
        }
      }
    }

    const elemScale = parentCoordScaleFactor / superFactor;
    const offsetX = reg.x * parentCoordScaleFactor;
    const offsetY = reg.y * parentCoordScaleFactor;

    const haloCoverXml = await traceMaskWithPotraceToSvgElements(
      bgPatchMask,
      upscaled.width,
      upscaled.height,
      reg.backgroundHex,
      offsetX,
      offsetY,
      elemScale,
      `${reg.id}-base`,
      { alphamax: 0.9, opttolerance: 0.08, turdsize: 1 }
    );

    const crispGlyphsXml = await traceMaskWithPotraceToSvgElements(
      glyphMask,
      upscaled.width,
      upscaled.height,
      reg.inkHex,
      offsetX,
      offsetY,
      elemScale,
      `${reg.id}-glifo`,
      { alphamax: 0.68, opttolerance: 0.035, turdsize: 1 }
    );

    if (crispGlyphsXml) {
      groups.push(
        `<g id="${reg.id}" data-typography-preserved="true">${haloCoverXml}${crispGlyphsXml}</g>`
      );
    }
  }

  return groups.join('');
}
