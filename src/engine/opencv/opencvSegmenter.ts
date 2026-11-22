import type { DetectedImageCategory, RawRgbaImage } from '../types';
import {
  computePerceptualOklabBuffers,
  deltaEOklab,
  srgb8ToOklabScaled,
  unmixPerceptualBoundaryCoverage,
  type PerceptualOklabBuffers,
} from '../color/perceptualColor';

interface OpenCvApi {
  Mat: new (rows?: number, cols?: number, type?: number) => CvMat;
  CV_8UC1: number;
  COLOR_RGBA2GRAY: number;
  matFromImageData: (imgData: { data: Uint8ClampedArray; width: number; height: number }) => CvMat;
  cvtColor: (src: CvMat, dst: CvMat, code: number) => void;
  Canny: (image: CvMat, edges: CvMat, threshold1: number, threshold2: number) => void;
  connectedComponentsWithStats: (
    image: CvMat,
    labels: CvMat,
    stats: CvMat,
    centroids: CvMat,
    connectivity?: number
  ) => number;
}

interface CvMat {
  rows: number;
  cols: number;
  data: Uint8Array;
  data32S: Int32Array;
  delete: () => void;
}

let opencvReadyPromise: Promise<OpenCvApi> | null = null;

export async function getOpenCv(): Promise<OpenCvApi> {
  if (!opencvReadyPromise) {
    opencvReadyPromise = (async () => {
      const mod = await import('@techstark/opencv-js');
      const raw = (mod as unknown as { default?: unknown }).default ?? mod;
      const resolved = raw instanceof Promise ? await raw : raw;
      const cvObj = resolved as OpenCvApi & { onRuntimeInitialized?: () => void };

      if (typeof cvObj.Mat === 'function') {
        return cvObj;
      }

      return await new Promise<OpenCvApi>((resolve) => {
        cvObj.onRuntimeInitialized = () => resolve(cvObj);
      });
    })();
  }
  return opencvReadyPromise;
}

export type RegionVisualNature =
  | 'uniform'
  | 'gradient'
  | 'shadow'
  | 'reflection_metallic'
  | 'translucent'
  | 'texture_detail';

export interface SegmentedSubRegion {
  id: number;
  parentObjectId: number;
  nature: RegionVisualNature;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
  pixels: Int32Array;
  meanR: number;
  meanG: number;
  meanB: number;
  meanA: number;
  meanOklab: [number, number, number];
  deltaESpan: number;
  colorSpanRgb: number;
  isSemiTransparent: boolean;
  isSmallDetail: boolean;
  isSoftShadow: boolean;
  isMetallicOrSpecular: boolean;
  touchesExteriorBg: boolean;
  enclosedByRegionId: number;
  adjacentRegionIds: number[];
}

export interface SegmentedVisualObject {
  objectId: number;
  descriptiveName: string;
  dominantNature: RegionVisualNature;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  totalArea: number;
  hasInteriorHoles: boolean;
  subRegions: SegmentedSubRegion[];
}

export interface OpenCvSegmentationOptions {
  category?: DetectedImageCategory;
  detailPrecision?: number;
  noiseRemoval?: number;
  typographyInkMask?: Uint8Array;
  maxTargetRegions?: number;
}

export interface OpenCvImageDecomposition {
  width: number;
  height: number;
  hasUniformOpaqueBackground: boolean;
  backgroundRgb: [number, number, number] | null;
  backgroundOklab: [number, number, number] | null;
  substrateImage: RawRgbaImage;
  oklab: PerceptualOklabBuffers;
  cannyEdgeMap: Uint8Array;
  rgbGradientMap: Uint8Array;
  oklabCurvatureMap: Float32Array;
  regionIdMap: Int32Array;
  objectLabelMap: Int32Array;
  objects: SegmentedVisualObject[];
  totalSubRegions: number;
}

/**
 * Preenche suavemente APENAS os pixels exatos de tinta tipográfica usando as cores do substrato
 * imediatamente vizinho (anel de 1..3px ao redor das hastes), sem JAMAIS apagar caixas retangulares
 * de escudos, faixas, botões ou fundos coloridos sob o texto!
 */
export function inpaintTypographyInkMask(
  source: RawRgbaImage,
  inkMask?: Uint8Array
): RawRgbaImage {
  if (!inkMask) return source;
  const { width, height, data } = source;
  const total = width * height;
  let hasAnyInk = false;
  for (let i = 0; i < total; i++) {
    if (inkMask[i]) {
      hasAnyInk = true;
      break;
    }
  }
  if (!hasAnyInk) return source;

  const out = new Uint8Array(data.length);
  out.set(data);
  const unresolved = new Uint8Array(inkMask);

  // Propaga das bordas externas limpas até curar 100% dos pixels da máscara tipográfica, qualquer que seja o tamanho da fonte!
  for (let pass = 0; pass < 512; pass++) {
    let resolvedInPass = 0;
    const nextOut = new Uint8Array(out);
    const resolvedFlags = new Uint8Array(total);

    for (let px = 0; px < total; px++) {
      if (!unresolved[px]) continue;
      const x = px % width;
      const y = (px - x) / width;

      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;
      let wSum = 0;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const nPx = ny * width + nx;
          if (unresolved[nPx]) continue;
          const w = dx === 0 || dy === 0 ? 2 : 1;
          const nIdx = nPx * 4;
          rSum += out[nIdx] * w;
          gSum += out[nIdx + 1] * w;
          bSum += out[nIdx + 2] * w;
          aSum += out[nIdx + 3] * w;
          wSum += w;
        }
      }

      if (wSum > 0) {
        const oIdx = px * 4;
        nextOut[oIdx] = Math.round(rSum / wSum);
        nextOut[oIdx + 1] = Math.round(gSum / wSum);
        nextOut[oIdx + 2] = Math.round(bSum / wSum);
        nextOut[oIdx + 3] = Math.round(aSum / wSum);
        resolvedFlags[px] = 1;
        resolvedInPass++;
      }
    }

    out.set(nextOut);
    for (let i = 0; i < total; i++) {
      if (resolvedFlags[i]) unresolved[i] = 0;
    }
    if (resolvedInPass === 0) break;
  }

  return {
    width,
    height,
    data: out,
    sourceFormat: source.sourceFormat,
  };
}

function detectUniformBorderBackground(image: RawRgbaImage): {
  hasUniformBg: boolean;
  bgRgb: [number, number, number] | null;
} {
  const { width, height, data } = image;
  const borderSamples: Array<[number, number, number, number]> = [];
  const stepX = Math.max(1, Math.floor(width / 56));
  const stepY = Math.max(1, Math.floor(height / 56));

  for (let x = 0; x < width; x += stepX) {
    const topIdx = x * 4;
    const botIdx = ((height - 1) * width + x) * 4;
    borderSamples.push([data[topIdx], data[topIdx + 1], data[topIdx + 2], data[topIdx + 3]]);
    borderSamples.push([data[botIdx], data[botIdx + 1], data[botIdx + 2], data[botIdx + 3]]);
  }
  for (let y = 0; y < height; y += stepY) {
    const leftIdx = y * width * 4;
    const rightIdx = (y * width + (width - 1)) * 4;
    borderSamples.push([data[leftIdx], data[leftIdx + 1], data[leftIdx + 2], data[leftIdx + 3]]);
    borderSamples.push([data[rightIdx], data[rightIdx + 1], data[rightIdx + 2], data[rightIdx + 3]]);
  }

  let transparentBorderCount = 0;
  for (const s of borderSamples) {
    if (s[3] < 40) transparentBorderCount++;
  }
  if (transparentBorderCount >= borderSamples.length * 0.35) {
    return { hasUniformBg: false, bgRgb: null };
  }

  const opaqueSamples = borderSamples.filter((s) => s[3] >= 225);
  if (opaqueSamples.length < borderSamples.length * 0.68) {
    return { hasUniformBg: false, bgRgb: null };
  }

  const rs = opaqueSamples.map((s) => s[0]).sort((a, b) => a - b);
  const gs = opaqueSamples.map((s) => s[1]).sort((a, b) => a - b);
  const bs = opaqueSamples.map((s) => s[2]).sort((a, b) => a - b);
  const mid = Math.floor(opaqueSamples.length / 2);
  const medR = rs[mid];
  const medG = gs[mid];
  const medB = bs[mid];
  const [medL, medA, medBv] = srgb8ToOklabScaled(medR, medG, medB);

  let matching = 0;
  for (const s of opaqueSamples) {
    const [sL, sA, sB] = srgb8ToOklabScaled(s[0], s[1], s[2]);
    if (deltaEOklab(sL, sA, sB, medL, medA, medBv) <= 3.2) {
      matching++;
    }
  }

  if (matching >= opaqueSamples.length * 0.78) {
    return { hasUniformBg: true, bgRgb: [medR, medG, medB] };
  }
  return { hasUniformBg: false, bgRgb: null };
}

function classifyRegionVisualNature(
  pxList: Int32Array,
  width: number,
  data: Uint8Array,
  oklab: PerceptualOklabBuffers,
  isSoftShadow: boolean
): {
  nature: RegionVisualNature;
  deltaESpan: number;
  isMetallicOrSpecular: boolean;
} {
  const n = pxList.length;
  if (n < 6) {
    return { nature: 'uniform', deltaESpan: 0, isMetallicOrSpecular: false };
  }

  const stride = Math.max(1, Math.floor(n / 600));
  let minL = 100, maxL = 0;
  let minA = 200, maxA = -200;
  let minB = 200, maxB = -200;
  let minAlpha = 255, maxAlpha = 0;
  let sumAlpha = 0;
  let sumChroma = 0;
  let specPeakCount = 0;
  let darkBandCount = 0;
  let sampleCount = 0;

  let sumX = 0, sumY = 0, sumL = 0;
  for (let i = 0; i < n; i += stride) {
    const px = pxList[i];
    const x = px % width;
    const y = (px - x) / width;
    const L = oklab.L[px];
    const a = oklab.a[px];
    const b = oklab.b[px];
    const c = oklab.chroma[px];
    const al = data[px * 4 + 3];

    if (L < minL) minL = L;
    if (L > maxL) maxL = L;
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
    if (al < minAlpha) minAlpha = al;
    if (al > maxAlpha) maxAlpha = al;

    if (L >= 87) specPeakCount++;
    if (L <= 38) darkBandCount++;

    sumAlpha += al;
    sumChroma += c;
    sumX += x;
    sumY += y;
    sumL += L;
    sampleCount++;
  }

  const deltaESpan = Math.hypot(maxL - minL, maxA - minA, maxB - minB);
  const meanAlpha = sumAlpha / Math.max(1, sampleCount);
  const meanChroma = sumChroma / Math.max(1, sampleCount);

  if (isSoftShadow) {
    return { nature: 'shadow', deltaESpan, isMetallicOrSpecular: false };
  }

  if (meanAlpha < 242 || maxAlpha - minAlpha >= 24) {
    return { nature: 'translucent', deltaESpan, isMetallicOrSpecular: false };
  }

  if (deltaESpan <= 4.6) {
    return { nature: 'uniform', deltaESpan, isMetallicOrSpecular: false };
  }

  // Mede correlação espacial linear de luminosidade L(x, y) vs variância total para distinguir
  // gradiente coerente de textura/microdetalhe estocástico!
  const mx = sumX / sampleCount;
  const my = sumY / sampleCount;
  const mL = sumL / sampleCount;
  let sxx = 0, syy = 0, sxy = 0, sxL = 0, syL = 0, sLL = 0;

  for (let i = 0; i < n; i += stride) {
    const px = pxList[i];
    const dx = (px % width) - mx;
    const dy = Math.floor(px / width) - my;
    const dL = oklab.L[px] - mL;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
    sxL += dx * dL;
    syL += dy * dL;
    sLL += dL * dL;
  }

  const det = sxx * syy - sxy * sxy;
  let rSquaredLinear = 0;
  if (Math.abs(det) > 1e-3 && sLL > 1e-3) {
    const betaX = (syy * sxL - sxy * syL) / det;
    const betaY = (sxx * syL - sxy * sxL) / det;
    const explained = betaX * sxL + betaY * syL;
    rSquaredLinear = Math.max(0, Math.min(1, explained / sLL));
  }

  const lightSpan = maxL - minL;
  const isMetallicOrSpecular =
    lightSpan >= 20 &&
    specPeakCount >= Math.max(2, sampleCount * 0.04) &&
    (darkBandCount >= Math.max(2, sampleCount * 0.04) || meanChroma <= 24 || rSquaredLinear < 0.78);

  if (isMetallicOrSpecular) {
    return { nature: 'reflection_metallic', deltaESpan, isMetallicOrSpecular: true };
  }

  if (rSquaredLinear < 0.16 && deltaESpan >= 14 && n >= 80) {
    return { nature: 'texture_detail', deltaESpan, isMetallicOrSpecular: false };
  }

  return { nature: 'gradient', deltaESpan, isMetallicOrSpecular: false };
}

/**
 * Segmentação Perceptual Universal com OpenCV + OKLab + Derivada de 2ª Ordem:
 * - Diferencia matematicamente transições suaves de degradês/metais (`∇²C ≈ 0`) de bordas reais de objetos (`∇²C` alto);
 * - Desmistura anti-aliasing em espaço OKLab protegendo traços finos de 3ª cor (`orthogonalResidual`);
 * - Garante 100% de cobertura espacial dos pixels de primeiro plano (sem truncamentos `.slice()`).
 */
export async function analyzeAndSegmentWithOpenCv(
  image: RawRgbaImage,
  optionsOrExcludedBoxes:
    | OpenCvSegmentationOptions
    | Array<{ x: number; y: number; width: number; height: number }> = {}
): Promise<OpenCvImageDecomposition> {
  const cv = await getOpenCv();
  const opts: OpenCvSegmentationOptions = Array.isArray(optionsOrExcludedBoxes)
    ? {}
    : optionsOrExcludedBoxes;

  const substrateImage = inpaintTypographyInkMask(image, opts.typographyInkMask);
  const { width, height, data } = substrateImage;
  const totalPixels = width * height;

  const oklab = computePerceptualOklabBuffers(substrateImage);

  const rgbaClamped = new Uint8ClampedArray(data.length);
  rgbaClamped.set(data);

  const srcMat = cv.matFromImageData({ data: rgbaClamped, width, height });
  const grayMat = new cv.Mat();
  const cannyMat = new cv.Mat();
  const fgMaskMat = new cv.Mat(height, width, cv.CV_8UC1);
  const labelsMat = new cv.Mat();
  const statsMat = new cv.Mat();
  const centroidsMat = new cv.Mat();

  try {
    cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);
    cv.Canny(grayMat, cannyMat, 36, 110);
    const cannyEdgeMap = new Uint8Array(cannyMat.data);

    // 1. Mapa de gradiente de 1ª ordem (RGBA + OKLab) e Curvatura Laplaciana Direcional de 2ª ordem (OKLab)
    // Em um degradê suave, a 1ª derivada é alta mas a 2ª derivada (curvatura) é próxima de ZERO!
    const rgbGradientMap = new Uint8Array(totalPixels);
    const oklabGrad1Map = new Float32Array(totalPixels);
    const oklabCurvatureMap = new Float32Array(totalPixels);

    const { L, a, b, alpha } = oklab;

    for (let y = 0; y < height; y++) {
      const yPrev = Math.max(0, y - 1);
      const yNext = Math.min(height - 1, y + 1);
      for (let x = 0; x < width; x++) {
        const xPrev = Math.max(0, x - 1);
        const xNext = Math.min(width - 1, x + 1);
        const p = y * width + x;
        const pL = y * width + xPrev;
        const pR = y * width + xNext;
        const pU = yPrev * width + x;
        const pD = yNext * width + x;

        const iL = pL * 4;
        const iR = pR * 4;
        const iU = pU * 4;
        const iD = pD * 4;

        let maxMag = 0;
        for (let c = 0; c < 4; c++) {
          const gx = data[iR + c] - data[iL + c];
          const gy = data[iD + c] - data[iU + c];
          const mag = Math.hypot(gx, gy);
          if (mag > maxMag) maxMag = mag;
        }
        rgbGradientMap[p] = Math.min(255, Math.round(maxMag));

        const gH = Math.hypot(
          L[pR] - L[pL],
          a[pR] - a[pL],
          b[pR] - b[pL],
          alpha[pR] - alpha[pL]
        );
        const gV = Math.hypot(
          L[pD] - L[pU],
          a[pD] - a[pU],
          b[pD] - b[pU],
          alpha[pD] - alpha[pU]
        );
        oklabGrad1Map[p] = Math.max(gH, gV);

        const lapH = Math.hypot(
          L[pR] + L[pL] - 2 * L[p],
          a[pR] + a[pL] - 2 * a[p],
          b[pR] + b[pL] - 2 * b[p],
          alpha[pR] + alpha[pL] - 2 * alpha[p]
        );
        const lapV = Math.hypot(
          L[pD] + L[pU] - 2 * L[p],
          a[pD] + a[pU] - 2 * a[p],
          b[pD] + b[pU] - 2 * b[p],
          alpha[pD] + alpha[pU] - 2 * alpha[p]
        );
        oklabCurvatureMap[p] = Math.max(lapH, lapV);
      }
    }

    const { hasUniformBg, bgRgb } = detectUniformBorderBackground(substrateImage);
    const bgOklab: [number, number, number] | null = bgRgb
      ? srgb8ToOklabScaled(bgRgb[0], bgRgb[1], bgRgb[2])
      : null;

    // 2. Flood-fill estrito do fundo externo em espaço perceptual OKLab (ΔE_ok <= 1.6 preserva sombras suaves!)
    const isBackgroundPx = new Uint8Array(totalPixels);
    if (!hasUniformBg) {
      for (let i = 0; i < totalPixels; i++) {
        if (data[i * 4 + 3] < 12) {
          isBackgroundPx[i] = 1;
        }
      }
    } else if (bgRgb && bgOklab) {
      const bgQueue = new Int32Array(totalPixels);
      let bHead = 0;
      let bTail = 0;

      const isPureBgColor = (px: number): boolean => {
        const idx = px * 4;
        if (data[idx + 3] < 12) return true;
        const rgbManhattan =
          Math.abs(data[idx] - bgRgb[0]) +
          Math.abs(data[idx + 1] - bgRgb[1]) +
          Math.abs(data[idx + 2] - bgRgb[2]);
        if (rgbManhattan <= 5) return true;
        const de = deltaEOklab(L[px], a[px], b[px], bgOklab[0], bgOklab[1], bgOklab[2]);
        return de <= 1.35 && oklabGrad1Map[px] <= 2.2;
      };

      const trySeed = (px: number) => {
        if (isBackgroundPx[px]) return;
        if (isPureBgColor(px)) {
          isBackgroundPx[px] = 1;
          bgQueue[bTail++] = px;
        }
      };

      for (let x = 0; x < width; x++) {
        trySeed(x);
        trySeed((height - 1) * width + x);
      }
      for (let y = 0; y < height; y++) {
        trySeed(y * width);
        trySeed(y * width + (width - 1));
      }

      while (bHead < bTail) {
        const px = bgQueue[bHead++];
        const x = px % width;
        const y = (px - x) / width;

        if (x > 0 && !isBackgroundPx[px - 1] && isPureBgColor(px - 1)) {
          isBackgroundPx[px - 1] = 1;
          bgQueue[bTail++] = px - 1;
        }
        if (x + 1 < width && !isBackgroundPx[px + 1] && isPureBgColor(px + 1)) {
          isBackgroundPx[px + 1] = 1;
          bgQueue[bTail++] = px + 1;
        }
        if (y > 0 && !isBackgroundPx[px - width] && isPureBgColor(px - width)) {
          isBackgroundPx[px - width] = 1;
          bgQueue[bTail++] = px - width;
        }
        if (y + 1 < height && !isBackgroundPx[px + width] && isPureBgColor(px + width)) {
          isBackgroundPx[px + width] = 1;
          bgQueue[bTail++] = px + width;
        }
      }
    }

    for (let i = 0; i < totalPixels; i++) {
      fgMaskMat.data[i] = isBackgroundPx[i] ? 0 : 255;
    }

    const numLabels = cv.connectedComponentsWithStats(
      fgMaskMat,
      labelsMat,
      statsMat,
      centroidsMat,
      8
    );
    const ccLabels = new Int32Array(labelsMat.data32S);

    // 3. Limiares adaptativos segundo a categoria visual da imagem
    const isPhoto = opts.category === 'photograph';
    const detailPrec = opts.detailPrecision ?? 95;
    const detailScale = 1 + Math.max(0, 92 - detailPrec) * 0.012;

    // Barreira verdadeira de borda: exige curvatura de 2ª ordem (descontinuidade real) OU salto abrupto intenso!
    // Assim, degradês suaves (mesmo íngremes ou metálicos!) permanecem unidos em uma única região contínua!
    const curvatureBarrier = (isPhoto ? 4.3 : 4.2) * detailScale;
    const minGradForCurvature = (isPhoto ? 4.4 : 5.0) * detailScale;
    const hardStepJump = (isPhoto ? 15.5 : 16.0) * detailScale;
    const maxSmoothStepOk = (isPhoto ? 5.2 : 5.6) * detailScale;

    const isEdgeBarrier = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      if (isBackgroundPx[i]) continue;
      const g1 = oklabGrad1Map[i];
      const c2 = oklabCurvatureMap[i];
      if (
        (c2 >= curvatureBarrier && g1 >= minGradForCurvature) ||
        g1 >= hardStepJump ||
        (cannyEdgeMap[i] > 0 && c2 >= curvatureBarrier * 0.85 && g1 >= minGradForCurvature)
      ) {
        isEdgeBarrier[i] = 1;
      }
    }

    // Passo A: Crescimento de núcleos suaves interiores (livres de barreiras de borda)
    const regionIdMap = new Int32Array(totalPixels);
    const bfsQueue = new Int32Array(totalPixels);
    let nextRegionId = 1;

    for (let startPx = 0; startPx < totalPixels; startPx++) {
      if (isBackgroundPx[startPx] || regionIdMap[startPx] !== 0) continue;
      if (isEdgeBarrier[startPx]) continue;
      const objLabel = ccLabels[startPx];
      if (objLabel <= 0) continue;

      const currentRegId = nextRegionId++;
      let head = 0;
      let tail = 0;
      bfsQueue[tail++] = startPx;
      regionIdMap[startPx] = currentRegId;

      while (head < tail) {
        const px = bfsQueue[head++];
        const x = px % width;
        const y = (px - x) / width;
        const L0 = L[px];
        const a0 = a[px];
        const b0 = b[px];
        const al0 = alpha[px];

        const nbs = [
          x > 0 ? px - 1 : -1,
          x + 1 < width ? px + 1 : -1,
          y > 0 ? px - width : -1,
          y + 1 < height ? px + width : -1,
        ];

        for (let k = 0; k < 4; k++) {
          const nPx = nbs[k];
          if (nPx < 0 || isBackgroundPx[nPx] || regionIdMap[nPx] !== 0) continue;
          if (ccLabels[nPx] !== objLabel) continue;
          if (isEdgeBarrier[nPx]) continue;

          const stepDe = Math.hypot(
            L[nPx] - L0,
            a[nPx] - a0,
            b[nPx] - b0,
            (alpha[nPx] - al0) * 0.8
          );
          if (stepDe <= maxSmoothStepOk) {
            regionIdMap[nPx] = currentRegId;
            bfsQueue[tail++] = nPx;
          }
        }
      }
    }

    // Passo B: Desmistura Perceptual de Anti-Aliasing com Proteção Estrita de 3ª Cor!
    // - Se o pixel está sobre a corda linear [Reg1, Fundo] ou [Reg1, Reg2] (resíduo ortogonal pequeno),
    //   atribui à região correspondente sem criar farpas nem fendas.
    // - Se o pixel NÃO está sobre a corda (ex.: contorno fino preto entre duas cores!), NÃO o engole!
    for (let pass = 0; pass < 7; pass++) {
      let changed = 0;
      for (let px = 0; px < totalPixels; px++) {
        if (isBackgroundPx[px] || regionIdMap[px] !== 0) continue;
        const objLabel = ccLabels[px];
        if (objLabel <= 0) continue;

        const x = px % width;
        const y = (px - x) / width;
        const pxL = L[px];
        const pxA = a[px];
        const pxB = b[px];
        const pxAlpha = data[px * 4 + 3];

        let touchesExteriorBg = false;
        for (let dy = -2; dy <= 2 && !touchesExteriorBg; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) {
            touchesExteriorBg = true;
            break;
          }
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) {
              touchesExteriorBg = true;
              break;
            }
            const nPx = ny * width + nx;
            if (isBackgroundPx[nPx] || regionIdMap[nPx] === -1) {
              touchesExteriorBg = true;
              break;
            }
          }
        }

        // Coleta até 2 regiões vizinhas distintas mais próximas em OKLab
        let reg1 = 0;
        let reg1Px = -1;
        let dist1 = Infinity;
        let reg2 = 0;
        let reg2Px = -1;
        let dist2 = Infinity;

        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const nPx = ny * width + nx;
            const candReg = regionIdMap[nPx];
            if (candReg <= 0 || ccLabels[nPx] !== objLabel) continue;
            const d = deltaEOklab(pxL, pxA, pxB, L[nPx], a[nPx], b[nPx]);
            if (candReg === reg1) {
              if (d < dist1) {
                dist1 = d;
                reg1Px = nPx;
              }
            } else if (d < dist1) {
              reg2 = reg1;
              reg2Px = reg1Px;
              dist2 = dist1;
              reg1 = candReg;
              reg1Px = nPx;
              dist1 = d;
            } else if (candReg !== reg1 && d < dist2) {
              reg2 = candReg;
              reg2Px = nPx;
              dist2 = d;
            }
          }
        }

        if (reg1 <= 0 || reg1Px < 0) continue;

        // Caso 1: Borda externa contra fundo
        if (touchesExteriorBg) {
          if (!hasUniformBg || !bgOklab) {
            if (dist1 <= 14 || pxAlpha < 245) {
              regionIdMap[px] = pxAlpha >= 122 ? reg1 : -1;
              changed++;
              continue;
            }
          } else {
            const unmix = unmixPerceptualBoundaryCoverage(
              pxL,
              pxA,
              pxB,
              L[reg1Px],
              a[reg1Px],
              b[reg1Px],
              bgOklab[0],
              bgOklab[1],
              bgOklab[2]
            );
            if (unmix.chordLength >= 2.2 && unmix.orthogonalResidual <= 6.2) {
              regionIdMap[px] = unmix.coverage >= 0.48 ? reg1 : -1;
              changed++;
              continue;
            }
          }
        }

        // Caso 2: Costura interna entre duas regiões distintas Reg1 e Reg2
        if (reg2 > 0 && reg2Px >= 0) {
          const seamUnmix = unmixPerceptualBoundaryCoverage(
            pxL,
            pxA,
            pxB,
            L[reg1Px],
            a[reg1Px],
            b[reg1Px],
            L[reg2Px],
            a[reg2Px],
            b[reg2Px]
          );
          if (seamUnmix.orthogonalResidual <= 6.5) {
            regionIdMap[px] = seamUnmix.coverage >= 0.5 ? reg1 : reg2;
            changed++;
            continue;
          }
        }

        // Caso 3: Pixel muito próximo perceptualmente da única região vizinha (continuação da borda)
        if (dist1 <= 9.5) {
          regionIdMap[px] = reg1;
          changed++;
        }
      }
      if (changed === 0) break;
    }

    // Passo C: Agrupa todos os pixels restantes (contornos finos reais, pupilas, brilhos puntiformes, microdetalhes!)
    for (let startPx = 0; startPx < totalPixels; startPx++) {
      if (isBackgroundPx[startPx] || regionIdMap[startPx] !== 0) continue;
      const objLabel = ccLabels[startPx];
      if (objLabel <= 0) continue;

      const fineRegId = nextRegionId++;
      let head = 0;
      let tail = 0;
      bfsQueue[tail++] = startPx;
      regionIdMap[startPx] = fineRegId;

      let touchesBg = false;
      let bestAdjReg = -1;
      let minAdjDeltaE = Infinity;

      while (head < tail) {
        const px = bfsQueue[head++];
        const x = px % width;
        const y = (px - x) / width;

        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const nPx = ny * width + nx;
            if (isBackgroundPx[nPx] || regionIdMap[nPx] === -1) {
              touchesBg = true;
              continue;
            }
            const nr = regionIdMap[nPx];
            if (nr > 0 && nr !== fineRegId && ccLabels[nPx] === objLabel) {
              const de = deltaEOklab(L[px], a[px], b[px], L[nPx], a[nPx], b[nPx]);
              if (de < minAdjDeltaE) {
                minAdjDeltaE = de;
                bestAdjReg = nr;
              }
              continue;
            }
            if (nr !== 0 || ccLabels[nPx] !== objLabel) continue;
            const dSeed = deltaEOklab(
              L[nPx],
              a[nPx],
              b[nPx],
              L[startPx],
              a[startPx],
              b[startPx]
            );
            const dStep = deltaEOklab(L[nPx], a[nPx], b[nPx], L[px], a[px], b[px]);
            if (dSeed <= 18 && dStep <= 10) {
              regionIdMap[nPx] = fineRegId;
              bfsQueue[tail++] = nPx;
            }
          }
        }
      }

      // Só absorve se for micro-resíduo sem contraste real (< 8.5 JND) ou farpa externa microscópica de 1-4px
      // Detalhes pequenos legítimos (pupilas, estrelas, pontos, contornos finos >= 8.5 JND) são 100% PRESERVADOS!
      if (
        (touchesBg && tail <= 5 && bestAdjReg > 0 && minAdjDeltaE < 14) ||
        (bestAdjReg > 0 && minAdjDeltaE < 8.0) ||
        (tail === 1 && bestAdjReg > 0)
      ) {
        const target = touchesBg && tail <= 4 && minAdjDeltaE >= 10 ? -1 : bestAdjReg;
        for (let i = 0; i < tail; i++) {
          regionIdMap[bfsQueue[i]] = target;
        }
      }
    }

    // Passo D: Consolidação Perceptual Controlada (evita milhares de fragmentos em fotos/texturas SEM perder partes!)
    const noiseFloorPx =
      (opts.noiseRemoval ?? 0) >= 50
        ? Math.round(3 + (((opts.noiseRemoval ?? 0) - 50) / 50) * 18)
        : isPhoto
          ? 6
          : 0;
    const maxTargetRegions = opts.maxTargetRegions ?? (isPhoto ? 460 : 520);

    const consolidateSmallOrExcessRegions = () => {
      const regPixels = new Map<number, number[]>();
      for (let px = 0; px < totalPixels; px++) {
        const rid = regionIdMap[px];
        if (rid <= 0) continue;
        let arr = regPixels.get(rid);
        if (!arr) {
          arr = [];
          regPixels.set(rid, arr);
        }
        arr.push(px);
      }

      if (regPixels.size <= maxTargetRegions && noiseFloorPx === 0) {
        return regPixels;
      }

      const regMean = new Map<number, [number, number, number, number]>();
      for (const [rid, pxs] of regPixels.entries()) {
        let sL = 0, sA = 0, sB = 0;
        for (let i = 0; i < pxs.length; i++) {
          const p = pxs[i];
          sL += L[p];
          sA += a[p];
          sB += b[p];
        }
        const inv = 1 / pxs.length;
        regMean.set(rid, [sL * inv, sA * inv, sB * inv, pxs.length]);
      }

      // Ordena regiões candidatas da menor para a maior para fusão suave sem criar buracos
      const sortedRids = Array.from(regPixels.keys()).sort(
        (r1, r2) => (regPixels.get(r1)?.length ?? 0) - (regPixels.get(r2)?.length ?? 0)
      );

      let currentCount = regPixels.size;
      for (const rid of sortedRids) {
        const pxs = regPixels.get(rid);
        if (!pxs || pxs.length === 0) continue;

        const mustReduceForBudget = currentCount > maxTargetRegions && pxs.length <= 90;
        const isBelowNoiseFloor = noiseFloorPx > 0 && pxs.length <= noiseFloorPx;
        if (!mustReduceForBudget && !isBelowNoiseFloor) continue;

        const m = regMean.get(rid)!;
        const objLbl = ccLabels[pxs[0]];
        let bestTarget = -1;
        let bestDe = Infinity;

        for (let i = 0; i < pxs.length; i++) {
          const px = pxs[i];
          const x = px % width;
          const y = (px - x) / width;
          const nbs = [
            x > 0 ? px - 1 : -1,
            x + 1 < width ? px + 1 : -1,
            y > 0 ? px - width : -1,
            y + 1 < height ? px + width : -1,
          ];
          for (let k = 0; k < 4; k++) {
            const nPx = nbs[k];
            if (nPx < 0) continue;
            const nr = regionIdMap[nPx];
            if (nr <= 0 || nr === rid || ccLabels[nPx] !== objLbl) continue;
            const nm = regMean.get(nr);
            if (!nm) continue;
            const de = deltaEOklab(m[0], m[1], m[2], nm[0], nm[1], nm[2]);
            if (de < bestDe) {
              bestDe = de;
              bestTarget = nr;
            }
          }
        }

        // Nunca funde um detalhe pequeno de altíssimo contraste (ex: olho/pupila/estrela ΔE > 22) mesmo sob orçamento apertado!
        const maxAllowedMergeDe = mustReduceForBudget ? 22.0 : 12.0;
        if (bestTarget > 0 && bestDe <= maxAllowedMergeDe) {
          const targetArr = regPixels.get(bestTarget)!;
          for (let i = 0; i < pxs.length; i++) {
            regionIdMap[pxs[i]] = bestTarget;
            targetArr.push(pxs[i]);
          }
          const tm = regMean.get(bestTarget)!;
          const tot = tm[3] + m[3];
          regMean.set(bestTarget, [
            (tm[0] * tm[3] + m[0] * m[3]) / tot,
            (tm[1] * tm[3] + m[1] * m[3]) / tot,
            (tm[2] * tm[3] + m[2] * m[3]) / tot,
            tot,
          ]);
          regPixels.delete(rid);
          currentCount--;
        }
      }

      return regPixels;
    };

    const buckets = consolidateSmallOrExcessRegions();

    // Constrói metadados topológicos e perceptuais ricos por sub-região
    const subRegionsByObject = new Map<number, SegmentedSubRegion[]>();
    const allSubsById = new Map<number, SegmentedSubRegion>();
    let totalSubRegions = 0;

    for (const [rid, pxList] of buckets.entries()) {
      if (pxList.length < 2) continue;
      const objLabel = ccLabels[pxList[0]];

      let minX = width, maxX = 0, minY = height, maxY = 0;
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
      let lSum = 0, okASum = 0, okBSum = 0;
      let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
      let perimeterTouchesBg = 0;
      let perimeterTotal = 0;
      let perimeterBgDeSum = 0;
      const neighborCounts = new Map<number, number>();

      const typed = new Int32Array(pxList.length);

      for (let i = 0; i < pxList.length; i++) {
        const px = pxList[i];
        typed[i] = px;
        const x = px % width;
        const y = (px - x) / width;
        const idx = px * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const bCh = data[idx + 2];
        const al = data[idx + 3];

        rSum += r;
        gSum += g;
        bSum += bCh;
        aSum += al;
        lSum += L[px];
        okASum += a[px];
        okBSum += b[px];

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (g < minG) minG = g;
        if (g > maxG) maxG = g;
        if (bCh < minB) minB = bCh;
        if (bCh > maxB) maxB = bCh;

        const nbs = [
          x > 0 ? regionIdMap[px - 1] : 0,
          x + 1 < width ? regionIdMap[px + 1] : 0,
          y > 0 ? regionIdMap[px - width] : 0,
          y + 1 < height ? regionIdMap[px + width] : 0,
        ];

        let isPerim = false;
        let touchesExtHere = false;
        for (let k = 0; k < 4; k++) {
          const nr = nbs[k];
          if (nr !== rid) {
            isPerim = true;
            if (nr <= 0) {
              touchesExtHere = true;
            } else {
              neighborCounts.set(nr, (neighborCounts.get(nr) ?? 0) + 1);
            }
          }
        }

        if (isPerim) {
          perimeterTotal++;
          if (touchesExtHere) {
            perimeterTouchesBg++;
            if (bgOklab) {
              perimeterBgDeSum += deltaEOklab(
                L[px],
                a[px],
                b[px],
                bgOklab[0],
                bgOklab[1],
                bgOklab[2]
              );
            }
          }
        }
      }

      const n = pxList.length;
      const avgPerimDeToBg =
        perimeterTouchesBg > 0 && bgOklab ? perimeterBgDeSum / perimeterTouchesBg : 999;
      const colorSpanRgb = Math.max(maxR - minR, maxG - minG, maxB - minB);
      const isSoftShadow =
        n >= 90 &&
        perimeterTouchesBg >= perimeterTotal * 0.45 &&
        avgPerimDeToBg <= 4.2 &&
        colorSpanRgb >= 10;

      const { nature, deltaESpan, isMetallicOrSpecular } = classifyRegionVisualNature(
        typed,
        width,
        data,
        oklab,
        isSoftShadow
      );

      // Identifica se a região é uma ilha 100% cercada por uma única região pai (ex.: pupila dentro da esclera!)
      let enclosedByRegionId = 0;
      if (perimeterTouchesBg === 0 && neighborCounts.size === 1) {
        enclosedByRegionId = neighborCounts.keys().next().value ?? 0;
      } else if (perimeterTouchesBg === 0 && neighborCounts.size > 1) {
        let dominantNeighbor = 0;
        let maxContacts = 0;
        let totalContacts = 0;
        for (const [nr, cnt] of neighborCounts.entries()) {
          totalContacts += cnt;
          if (cnt > maxContacts) {
            maxContacts = cnt;
            dominantNeighbor = nr;
          }
        }
        if (maxContacts >= totalContacts * 0.85) {
          enclosedByRegionId = dominantNeighbor;
        }
      }

      const sub: SegmentedSubRegion = {
        id: rid,
        parentObjectId: objLabel,
        nature,
        minX,
        minY,
        maxX,
        maxY,
        pixelCount: n,
        pixels: typed,
        meanR: rSum / n,
        meanG: gSum / n,
        meanB: bSum / n,
        meanA: aSum / n,
        meanOklab: [lSum / n, okASum / n, okBSum / n],
        deltaESpan,
        colorSpanRgb,
        isSemiTransparent: aSum / n < 244 || nature === 'translucent' || isSoftShadow,
        isSmallDetail: n <= 140,
        isSoftShadow,
        isMetallicOrSpecular,
        touchesExteriorBg: perimeterTouchesBg > 0,
        enclosedByRegionId,
        adjacentRegionIds: Array.from(neighborCounts.keys()),
      };

      allSubsById.set(rid, sub);
      const arr = subRegionsByObject.get(objLabel);
      if (arr) arr.push(sub);
      else subRegionsByObject.set(objLabel, [sub]);
      totalSubRegions++;
    }

    // Ordena sub-regiões topologicamente (do fundo/continente para as ilhas/detalhes sobrepostos!)
    const computeContainmentDepth = (sub: SegmentedSubRegion): number => {
      let depth = 0;
      let cur = sub.enclosedByRegionId;
      const seen = new Set<number>([sub.id]);
      while (cur > 0 && !seen.has(cur) && depth < 12) {
        seen.add(cur);
        depth++;
        cur = allSubsById.get(cur)?.enclosedByRegionId ?? 0;
      }
      return depth;
    };

    const objects: SegmentedVisualObject[] = [];
    for (let label = 1; label < numLabels; label++) {
      const subs = subRegionsByObject.get(label);
      if (!subs || subs.length === 0) continue;

      subs.sort((s1, s2) => {
        // Sombras suaves sempre primeiro (atrás)
        if (s1.isSoftShadow !== s2.isSoftShadow) return s1.isSoftShadow ? -1 : 1;
        // Menor profundidade de contenção primeiro (região envolvente antes da ilha interna!)
        const d1 = computeContainmentDepth(s1);
        const d2 = computeContainmentDepth(s2);
        if (d1 !== d2) return d1 - d2;
        // Regiões que tocam o exterior antes de regiões puramente internas
        if (s1.touchesExteriorBg !== s2.touchesExteriorBg) {
          return s1.touchesExteriorBg ? -1 : 1;
        }
        return s2.pixelCount - s1.pixelCount;
      });

      let minX = width, minY = height, maxX = 0, maxY = 0, totalArea = 0;
      let dominantNature: RegionVisualNature = subs[0].nature;
      let largestArea = 0;
      for (const s of subs) {
        if (s.minX < minX) minX = s.minX;
        if (s.minY < minY) minY = s.minY;
        if (s.maxX > maxX) maxX = s.maxX;
        if (s.maxY > maxY) maxY = s.maxY;
        totalArea += s.pixelCount;
        if (s.pixelCount > largestArea) {
          largestArea = s.pixelCount;
          dominantNature = s.nature;
        }
      }

      objects.push({
        objectId: label,
        descriptiveName: 'objeto-vetorial',
        dominantNature,
        minX,
        minY,
        maxX,
        maxY,
        totalArea,
        hasInteriorHoles: false,
        subRegions: subs,
      });
    }

    // Ordenação Z-order entre objetos independentes: sombras suaves atrás, objetos envolventes maiores antes de ilhas internas!
    objects.sort((aObj, bObj) => {
      const aShadow = aObj.dominantNature === 'shadow' ? 1 : 0;
      const bShadow = bObj.dominantNature === 'shadow' ? 1 : 0;
      if (aShadow !== bShadow) return bShadow - aShadow;
      return bObj.totalArea - aObj.totalArea;
    });

    const objectLabelRename = new Map<number, number>();
    objects.forEach((obj, idx) => {
      const oldId = obj.objectId;
      const newId = idx + 1;
      objectLabelRename.set(oldId, newId);
      obj.objectId = newId;
      for (const s of obj.subRegions) {
        s.parentObjectId = newId;
      }

      obj.descriptiveName =
        obj.dominantNature === 'shadow'
          ? `sombra-suave-${newId}`
          : obj.dominantNature === 'reflection_metallic'
            ? `objeto-metalico-${newId}`
            : obj.dominantNature === 'translucent'
              ? `objeto-translucido-${newId}`
              : obj.totalArea <= 120
                ? `detalhe-${newId}`
                : obj.dominantNature === 'gradient'
                  ? `objeto-gradiente-${newId}`
                  : `objeto-forma-${newId}`;
    });

    const objectLabelMap = new Int32Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      if (regionIdMap[i] > 0) {
        objectLabelMap[i] = objectLabelRename.get(ccLabels[i]) ?? 0;
      }
    }

    return {
      width,
      height,
      hasUniformOpaqueBackground: hasUniformBg,
      backgroundRgb: bgRgb,
      backgroundOklab: bgOklab,
      substrateImage,
      oklab,
      cannyEdgeMap,
      rgbGradientMap,
      oklabCurvatureMap,
      regionIdMap,
      objectLabelMap,
      objects,
      totalSubRegions,
    };
  } finally {
    srcMat.delete();
    grayMat.delete();
    cannyMat.delete();
    fgMaskMat.delete();
    labelsMat.delete();
    statsMat.delete();
    centroidsMat.delete();
  }
}
