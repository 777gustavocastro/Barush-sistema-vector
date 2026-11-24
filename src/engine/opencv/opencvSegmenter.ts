import type { DetectedImageCategory, RawRgbaImage } from '../types';
import {
  computePerceptualOklabBuffers,
  decontaminateBoundaryPixelSrgb8,
  deltaEOklab,
  srgb8ToOklabScaled,
  unmixDualSpaceBoundaryMatting,
  unmixPerceptualBoundaryCoverage,
  type PerceptualOklabBuffers,
} from '../color/perceptualColor';
import {
  classifyCanvasBackground,
  paintUniformBackgroundMask,
  type BackgroundClassification,
} from '../background/backgroundClassifier';
import { cleanContextualSegmentationNoise } from '../noise/contextualNoiseCleaner';
import {
  isAuditActive,
  noteFinalSegmentation,
  noteHighContrastSmall,
  noteMergedRegion,
  noteProtectedRegions,
  noteSegmentationStage,
} from '../audit/pipelineAudit';

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
  backgroundKind: BackgroundClassification['kind'];
  backgroundRgb: [number, number, number] | null;
  backgroundOklab: [number, number, number] | null;
  substrateImage: RawRgbaImage;
  decontaminatedImage: RawRgbaImage;
  interiorMask: Uint8Array;
  oklab: PerceptualOklabBuffers;
  cannyEdgeMap: Uint8Array;
  rgbGradientMap: Uint8Array;
  oklabCurvatureMap: Float32Array;
  regionIdMap: Int32Array;
  objectLabelMap: Int32Array;
  objects: SegmentedVisualObject[];
  totalSubRegions: number;
  noiseCleanup?: import('../noise/contextualNoiseCleaner').NoiseCleanupReport;
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

function classifyRegionVisualNature(
  pxList: Int32Array,
  width: number,
  data: Uint8Array,
  oklab: PerceptualOklabBuffers,
  isSoftShadow: boolean,
  interiorMask?: Uint8Array
): {
  nature: RegionVisualNature;
  deltaESpan: number;
  isMetallicOrSpecular: boolean;
} {
  let effectiveList = pxList;
  if (!isSoftShadow && interiorMask) {
    let intCount = 0;
    for (let i = 0; i < pxList.length; i++) {
      if (interiorMask[pxList[i]]) intCount++;
    }
    if (intCount >= 8) {
      const onlyInterior = new Int32Array(intCount);
      let w = 0;
      for (let i = 0; i < pxList.length; i++) {
        const px = pxList[i];
        if (interiorMask[px]) onlyInterior[w++] = px;
      }
      effectiveList = onlyInterior;
    }
  }

  const n = effectiveList.length;
  if (n < 6) {
    return { nature: 'uniform', deltaESpan: 0, isMetallicOrSpecular: false };
  }

  const stride = Math.max(1, Math.floor(n / 600));
  const lVals: number[] = [];
  const aVals: number[] = [];
  const bVals: number[] = [];
  let minL = 100, maxL = 0;
  let minAlpha = 255, maxAlpha = 0;
  let sumAlpha = 0;
  let sumChroma = 0;
  let specPeakCount = 0;
  let darkBandCount = 0;
  let sampleCount = 0;

  let sumX = 0, sumY = 0, sumL = 0;
  for (let i = 0; i < n; i += stride) {
    const px = effectiveList[i];
    const x = px % width;
    const y = (px - x) / width;
    const L = oklab.L[px];
    const a = oklab.a[px];
    const b = oklab.b[px];
    const c = oklab.chroma[px];
    const al = data[px * 4 + 3];

    lVals.push(L);
    aVals.push(a);
    bVals.push(b);
    if (L < minL) minL = L;
    if (L > maxL) maxL = L;
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

  // Usa intervalo robusto P90 - P10 para não confundir 1–2 pixels residuais de canto com gradiente/textura!
  lVals.sort((u, v) => u - v);
  aVals.sort((u, v) => u - v);
  bVals.sort((u, v) => u - v);
  const i10 = Math.floor((lVals.length - 1) * 0.1);
  const i90 = Math.ceil((lVals.length - 1) * 0.9);
  const deltaESpan = Math.hypot(
    lVals[i90] - lVals[i10],
    aVals[i90] - aVals[i10],
    bVals[i90] - bVals[i10]
  );
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
    const px = effectiveList[i];
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

  const rawSubstrateImage = inpaintTypographyInkMask(image, opts.typographyInkMask);
  const { width, height } = rawSubstrateImage;
  const totalPixels = width * height;

  // Pré-condicionamento Bilateral 3×3 estritamente seletivo para imagens com ruído de sensor ou artefatos JPEG 8×8:
  // Em PNGs/WebPs limpos (ruído local de alta frequência ~ 0 e noiseRemoval < 20), NÃO altera um único bit!
  const isJpegSource =
    image.sourceFormat === 'jpg' || image.sourceFormat === 'jpeg';
  let flatLapSamples: number[] = [];
  const sampleStride = Math.max(1, Math.floor(totalPixels / 4096));
  for (let p = width + 1; p < totalPixels - width - 1; p += sampleStride) {
    const i4 = p * 4;
    if (rawSubstrateImage.data[i4 + 3] < 200) continue;
    const iL = (p - 1) * 4;
    const iR = (p + 1) * 4;
    const iU = (p - width) * 4;
    const iD = (p + width) * 4;
    const lapRgb =
      Math.abs(rawSubstrateImage.data[iL] + rawSubstrateImage.data[iR] - 2 * rawSubstrateImage.data[i4]) +
      Math.abs(rawSubstrateImage.data[iL + 1] + rawSubstrateImage.data[iR + 1] - 2 * rawSubstrateImage.data[i4 + 1]) +
      Math.abs(rawSubstrateImage.data[iL + 2] + rawSubstrateImage.data[iR + 2] - 2 * rawSubstrateImage.data[i4 + 2]) +
      Math.abs(rawSubstrateImage.data[iU] + rawSubstrateImage.data[iD] - 2 * rawSubstrateImage.data[i4]);
    flatLapSamples.push(lapRgb);
  }
  flatLapSamples.sort((u, v) => u - v);
  const p45LapRgb =
    flatLapSamples.length > 16
      ? flatLapSamples[Math.floor(flatLapSamples.length * 0.45)]
      : 0;
  const hasSensorNoise = p45LapRgb >= 10;
  const shouldBilateralClean =
    hasSensorNoise || isJpegSource || (opts.noiseRemoval ?? 0) >= 20;

  let substrateImage = rawSubstrateImage;
  if (shouldBilateralClean && width >= 6 && height >= 6) {
    const srcBuf = rawSubstrateImage.data;
    const cleanBuf = new Uint8Array(srcBuf.length);
    cleanBuf.set(srcBuf);
    const maxColorDiff = hasSensorNoise ? 38 : 22;

    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const p = row + x;
        const c4 = p * 4;
        const ca = srcBuf[c4 + 3];
        if (ca < 200) continue;
        const cr = srcBuf[c4];
        const cg = srcBuf[c4 + 1];
        const cb = srcBuf[c4 + 2];
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++) {
          const nRow = (y + dy) * width;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const n4 = (nRow + x + dx) * 4;
            const l1 =
              Math.abs(srcBuf[n4] - cr) +
              Math.abs(srcBuf[n4 + 1] - cg) +
              Math.abs(srcBuf[n4 + 2] - cb);
            if (l1 > 52) edge = true;
          }
        }
        if (edge) continue;

        let rAcc = cr * 4;
        let gAcc = cg * 4;
        let bAcc = cb * 4;
        let wAcc = 4;

        for (let dy = -1; dy <= 1; dy++) {
          const nRow = (y + dy) * width;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const n4 = (nRow + x + dx) * 4;
            if (srcBuf[n4 + 3] < 200) continue;
            const dr = Math.abs(srcBuf[n4] - cr);
            const dg = Math.abs(srcBuf[n4 + 1] - cg);
            const db = Math.abs(srcBuf[n4 + 2] - cb);
            const l1 = dr + dg + db;
            if (l1 <= maxColorDiff) {
              const w = dx === 0 || dy === 0 ? 2 : 1;
              rAcc += srcBuf[n4] * w;
              gAcc += srcBuf[n4 + 1] * w;
              bAcc += srcBuf[n4 + 2] * w;
              wAcc += w;
            }
          }
        }

        if (wAcc > 4) {
          cleanBuf[c4] = Math.round(rAcc / wAcc);
          cleanBuf[c4 + 1] = Math.round(gAcc / wAcc);
          cleanBuf[c4 + 2] = Math.round(bAcc / wAcc);
        }
      }
    }

    substrateImage = {
      width,
      height,
      data: cleanBuf,
      sourceFormat: rawSubstrateImage.sourceFormat,
    };
  }

  const { data } = substrateImage;

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

    const backgroundClass = classifyCanvasBackground(substrateImage, oklab);
    const hasUniformBg = backgroundClass.hasUniformCanvas;
    const bgRgb = backgroundClass.rgb;
    const bgOklab = backgroundClass.oklab;

    const isBackgroundPx = new Uint8Array(totalPixels);
    paintUniformBackgroundMask(substrateImage, oklab, backgroundClass, isBackgroundPx);

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
    const gradientCanvas = backgroundClass.kind === 'gradient';
    const curvatureBarrier = (isPhoto ? 4.3 : gradientCanvas ? 6.4 : 4.2) * detailScale;
    const minGradForCurvature = (isPhoto ? 4.4 : gradientCanvas ? 8.0 : 5.0) * detailScale;
    const hardStepJump = (isPhoto ? 15.5 : gradientCanvas ? 22 : 16.0) * detailScale;
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

    if (isAuditActive()) noteSegmentationStage('A-nucleos', regionIdMap);

    // Passo A.2: Semeadura Estrutural de Espinhas de Contornos e Traços Finos (1.5–4px) ANTES do Passo B!
    // Garante que contornos pretos, contornos brancos, contornos duplos e linhas finas tenham sua espinha
    // central pura registrada antes da desmistura de anti-aliasing, evitando espessuras irregulares,
    // invasão do preto sobre áreas claras e fragmentação de bordas contínuas.
    {
      const isContourSpineCandidate = new Uint8Array(totalPixels);
      const crossDirs: ReadonlyArray<[number, number]> = [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, -1],
      ];

      for (let y = 2; y < height - 2; y++) {
        const rowOff = y * width;
        for (let x = 2; x < width - 2; x++) {
          const px = rowOff + x;
          if (isBackgroundPx[px] || regionIdMap[px] !== 0 || ccLabels[px] <= 0) continue;
          const p4 = px * 4;
          if (data[p4 + 3] < 140) continue;

          const r0 = data[p4];
          const g0 = data[p4 + 1];
          const b0 = data[p4 + 2];
          const L0 = L[px];
          const a0 = a[px];
          const okB0 = b[px];

          let confirmedRidge = false;
          for (let dIdx = 0; dIdx < 4; dIdx++) {
            const [dx, dy] = crossDirs[dIdx];
            const pM1 = (y - dy) * width + (x - dx);
            const pP1 = (y + dy) * width + (x + dx);
            const pM2 = (y - 2 * dy) * width + (x - 2 * dx);
            const pP2 = (y + 2 * dy) * width + (x + 2 * dx);

            // Não pode ser mistura de anti-aliasing entre os vizinhos de raio 1px nem de raio 2px
            const blend1 = unmixDualSpaceBoundaryMatting(
              r0,
              g0,
              b0,
              data[pM1 * 4],
              data[pM1 * 4 + 1],
              data[pM1 * 4 + 2],
              data[pP1 * 4],
              data[pP1 * 4 + 1],
              data[pP1 * 4 + 2]
            );
            if (blend1.isTrueAntialiasBlend) continue;

            const blend2 = unmixDualSpaceBoundaryMatting(
              r0,
              g0,
              b0,
              data[pM2 * 4],
              data[pM2 * 4 + 1],
              data[pM2 * 4 + 2],
              data[pP2 * 4],
              data[pP2 * 4 + 1],
              data[pP2 * 4 + 2]
            );
            if (blend2.isTrueAntialiasBlend) continue;

            // Contraste bilateral genuíno contra os dois lados da seção transversal (raio 2px transpõe traços de 1–3px)
            const deM2 = deltaEOklab(L0, a0, okB0, L[pM2], a[pM2], b[pM2]);
            const deP2 = deltaEOklab(L0, a0, okB0, L[pP2], a[pP2], b[pP2]);
            if (deM2 < 12.0 || deP2 < 12.0) continue;

            // Exige que o pixel esteja no pico/vale central da crista (evita incluir a franja cinza externa na semente pura!)
            const minCrossL = Math.min(L[pM2], L[pM1], L0, L[pP1], L[pP2]);
            const maxCrossL = Math.max(L[pM2], L[pM1], L0, L[pP1], L[pP2]);
            const isDarkRidge = L0 <= minCrossL + 5.5 && L0 < Math.min(L[pM2], L[pP2]) - 8.0;
            const isLightRidge = L0 >= maxCrossL - 5.5 && L0 > Math.max(L[pM2], L[pP2]) + 8.0;
            const chromaCrossPeak =
              oklab.chroma[px] > Math.max(oklab.chroma[pM2], oklab.chroma[pP2]) + 10.0 &&
              Math.abs(L0 - L[pM1]) <= 9.0 &&
              Math.abs(L0 - L[pP1]) <= 9.0;

            if (isDarkRidge || isLightRidge || chromaCrossPeak) {
              confirmedRidge = true;
              break;
            }
          }

          if (confirmedRidge) {
            isContourSpineCandidate[px] = 1;
          }
        }
      }

      // Conecta espinhas contínuas (incluindo pontes de 1px em estreitamentos curvos)
      for (let startPx = 0; startPx < totalPixels; startPx++) {
        if (!isContourSpineCandidate[startPx] || regionIdMap[startPx] !== 0) continue;
        const objLabel = ccLabels[startPx];
        if (objLabel <= 0) continue;

        const spineRegId = nextRegionId++;
        let head = 0;
        let tail = 0;
        bfsQueue[tail++] = startPx;
        regionIdMap[startPx] = spineRegId;

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
              if (regionIdMap[nPx] !== 0 || ccLabels[nPx] !== objLabel || isBackgroundPx[nPx]) {
                continue;
              }
              if (isContourSpineCandidate[nPx]) {
                const dStep = deltaEOklab(L[nPx], a[nPx], b[nPx], L[px], a[px], b[px]);
                const dSeed = deltaEOklab(L[nPx], a[nPx], b[nPx], L[startPx], a[startPx], b[startPx]);
                if (dStep <= 13.5 && dSeed <= 20.0) {
                  regionIdMap[nPx] = spineRegId;
                  bfsQueue[tail++] = nPx;
                }
              } else {
                // Ponte de 1px entre dois pixels de espinha confirmados de mesma tinta
                const nnx = nx + dx;
                const nny = ny + dy;
                if (nnx >= 0 && nnx < width && nny >= 0 && nny < height) {
                  const farPx = nny * width + nnx;
                  if (
                    isContourSpineCandidate[farPx] &&
                    ccLabels[farPx] === objLabel &&
                    deltaEOklab(L[farPx], a[farPx], b[farPx], L[px], a[px], b[px]) <= 10.0 &&
                    deltaEOklab(L[nPx], a[nPx], b[nPx], L[px], a[px], b[px]) <= 14.0
                  ) {
                    regionIdMap[nPx] = spineRegId;
                    bfsQueue[tail++] = nPx;
                  }
                }
              }
            }
          }
        }

        // Descarta falsas micro-espinhas isoladas (< 4px) para que o Passo B/C trate normalmente
        if (tail < 4) {
          for (let i = 0; i < tail; i++) {
            regionIdMap[bfsQueue[i]] = 0;
          }
          nextRegionId--;
        }
      }
    }

    if (isAuditActive()) noteSegmentationStage('A2-espinhas', regionIdMap);

    // Congela a máscara de sementes puras do Passo A + A.2 para impedir que o Passo B "rasteje" (creep)
    // por cima de contornos finos internos usando pixels de franja recém-atribuídos como referência!
    const isSeedCorePx = new Uint8Array(totalPixels);
    const seedCoreRgbA = new Float32Array(nextRegionId * 4);
    const seedCoreLab = new Float32Array(nextRegionId * 3);
    const seedCoreCnt = new Int32Array(nextRegionId);
    for (let px = 0; px < totalPixels; px++) {
      const rId = regionIdMap[px];
      if (rId > 0) {
        isSeedCorePx[px] = 1;
        const p4 = px * 4;
        const b4 = rId * 4;
        const b3 = rId * 3;
        seedCoreRgbA[b4] += data[p4];
        seedCoreRgbA[b4 + 1] += data[p4 + 1];
        seedCoreRgbA[b4 + 2] += data[p4 + 2];
        seedCoreRgbA[b4 + 3] += data[p4 + 3];
        seedCoreLab[b3] += L[px];
        seedCoreLab[b3 + 1] += a[px];
        seedCoreLab[b3 + 2] += b[px];
        seedCoreCnt[rId]++;
      }
    }
    for (let rId = 1; rId < nextRegionId; rId++) {
      const cnt = seedCoreCnt[rId];
      if (cnt > 0) {
        const inv = 1 / cnt;
        seedCoreRgbA[rId * 4] *= inv;
        seedCoreRgbA[rId * 4 + 1] *= inv;
        seedCoreRgbA[rId * 4 + 2] *= inv;
        seedCoreRgbA[rId * 4 + 3] *= inv;
        seedCoreLab[rId * 3] *= inv;
        seedCoreLab[rId * 3 + 1] *= inv;
        seedCoreLab[rId * 3 + 2] *= inv;
      }
    }

    const getPureAnchorForNeighbor = (
      candReg: number,
      nPx: number
    ): { r: number; g: number; b: number; al: number; L: number; okA: number; okB: number } => {
      if (isSeedCorePx[nPx]) {
        const i4 = nPx * 4;
        return {
          r: data[i4],
          g: data[i4 + 1],
          b: data[i4 + 2],
          al: data[i4 + 3],
          L: L[nPx],
          okA: a[nPx],
          okB: b[nPx],
        };
      }
      // Procura semente pura de candReg em vizinhança curta (preserva gradientes locais sem contaminar com franja!)
      const nx0 = nPx % width;
      const ny0 = (nPx - nx0) / width;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = ny0 + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = nx0 + dx;
          if (xx < 0 || xx >= width) continue;
          const sp = yy * width + xx;
          if (regionIdMap[sp] === candReg && isSeedCorePx[sp]) {
            const i4 = sp * 4;
            return {
              r: data[i4],
              g: data[i4 + 1],
              b: data[i4 + 2],
              al: data[i4 + 3],
              L: L[sp],
              okA: a[sp],
              okB: b[sp],
            };
          }
        }
      }
      const b4 = candReg * 4;
      const b3 = candReg * 3;
      return {
        r: Math.round(seedCoreRgbA[b4]),
        g: Math.round(seedCoreRgbA[b4 + 1]),
        b: Math.round(seedCoreRgbA[b4 + 2]),
        al: Math.round(seedCoreRgbA[b4 + 3]),
        L: seedCoreLab[b3],
        okA: seedCoreLab[b3 + 1],
        okB: seedCoreLab[b3 + 2],
      };
    };

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
        for (let dy = -1; dy <= 1 && !touchesExteriorBg; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) {
            touchesExteriorBg = true;
            break;
          }
          for (let dx = -1; dx <= 1; dx++) {
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

        // Coleta até 2 regiões vizinhas distintas mais próximas em raio 2px, SEMPRE ancoradas na cor pura de semente!
        let reg1 = 0;
        let reg1Px = -1;
        let dist1 = Infinity;
        let reg2 = 0;
        let reg2Px = -1;
        let dist2 = Infinity;

        for (let dy = -2; dy <= 2; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -2; dx <= 2; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const nPx = ny * width + nx;
            const candReg = regionIdMap[nPx];
            if (candReg <= 0 || ccLabels[nPx] !== objLabel) continue;
            const spatialBias = Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? 0 : 1.5;
            const anchor = getPureAnchorForNeighbor(candReg, nPx);
            const d = deltaEOklab(pxL, pxA, pxB, anchor.L, anchor.okA, anchor.okB) + spatialBias;
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
        const pIdx4 = px * 4;
        const anchor1 = getPureAnchorForNeighbor(reg1, reg1Px);

        // Caso 1: Borda externa contra fundo (Linear-RGB + sRGB + OKLab alpha matting + cobertura relativa de alfa)
        if (touchesExteriorBg) {
          if (!hasUniformBg || !bgOklab || !bgRgb) {
            const reg1Alpha = anchor1.al;
            if (dist1 <= 15 || (pxAlpha < 64 && dist1 <= 28)) {
              const halfAlphaThresh = Math.max(12, reg1Alpha * 0.48);
              regionIdMap[px] = pxAlpha >= halfAlphaThresh ? reg1 : -1;
              changed++;
              continue;
            }
          } else {
            const unmix = unmixPerceptualBoundaryCoverage(
              pxL,
              pxA,
              pxB,
              anchor1.L,
              anchor1.okA,
              anchor1.okB,
              bgOklab[0],
              bgOklab[1],
              bgOklab[2]
            );
            const dualBg = unmixDualSpaceBoundaryMatting(
              data[pIdx4],
              data[pIdx4 + 1],
              data[pIdx4 + 2],
              anchor1.r,
              anchor1.g,
              anchor1.b,
              bgRgb[0],
              bgRgb[1],
              bgRgb[2]
            );
            if (
              (unmix.chordLength >= 2.2 && unmix.orthogonalResidual <= 5.8 && dualBg.blendResidualSrgb <= 24) ||
              dualBg.isTrueAntialiasBlend
            ) {
              const cov = dualBg.isTrueAntialiasBlend ? dualBg.coverageOfFirst : unmix.coverage;
              // Evita que regiões pretas invadam áreas brancas ou claras por viés de gama sRGB
              const minFgCov = anchor1.L <= 24 && bgOklab[0] >= 75 ? 0.51 : 0.49;
              regionIdMap[px] = cov >= minFgCov ? reg1 : -1;
              changed++;
              continue;
            }
          }
        }

        // Caso 2: Costura interna entre duas regiões distintas Reg1 e Reg2 (evita fitas fantasmas de antialiasing!)
        if (reg2 > 0 && reg2Px >= 0) {
          const anchor2 = getPureAnchorForNeighbor(reg2, reg2Px);
          const seamUnmix = unmixPerceptualBoundaryCoverage(
            pxL,
            pxA,
            pxB,
            anchor1.L,
            anchor1.okA,
            anchor1.okB,
            anchor2.L,
            anchor2.okA,
            anchor2.okB
          );
          const dualSeam = unmixDualSpaceBoundaryMatting(
            data[pIdx4],
            data[pIdx4 + 1],
            data[pIdx4 + 2],
            anchor1.r,
            anchor1.g,
            anchor1.b,
            anchor2.r,
            anchor2.g,
            anchor2.b
          );
          if (seamUnmix.orthogonalResidual <= 6.5 || dualSeam.isTrueAntialiasBlend) {
            const cov = dualSeam.isTrueAntialiasBlend
              ? dualSeam.coverageOfFirst
              : seamUnmix.coverage;
            regionIdMap[px] = cov >= 0.5 ? reg1 : reg2;
            changed++;
            continue;
          }
        }

        // Caso 3: Pixel muito próximo perceptualmente da cor pura da semente (nunca avança sobre traço escuro/claro!)
        if (dist1 <= 6.8) {
          regionIdMap[px] = reg1;
          changed++;
        }
      }
      if (changed === 0) break;
    }

    if (isAuditActive()) noteSegmentationStage('B-antialiasing', regionIdMap);

    // Passo C: Agrupa todos os pixels restantes (contornos finos reais, pupilas, brilhos puntiformes, microdetalhes!)
    // Ordena sementes para iniciar SEMPRE na espinha central pura do traço fino (maior contraste local / extremo de L),
    // evitando iniciar na franja cinza de antialiasing e estilhaçar contornos finos de 1.5–3px!
    const unassignedCandidates: number[] = [];
    for (let px = 0; px < totalPixels; px++) {
      if (!isBackgroundPx[px] && regionIdMap[px] === 0 && ccLabels[px] > 0) {
        unassignedCandidates.push(px);
      }
    }
    unassignedCandidates.sort((p1, p2) => Math.abs(L[p2] - 52) - Math.abs(L[p1] - 52));

    for (let cIdx = 0; cIdx < unassignedCandidates.length; cIdx++) {
      const startPx = unassignedCandidates[cIdx];
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
            if (dSeed <= 29 && dStep <= 18) {
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

    // Passo C.2: Dissolução Cirúrgica de Fitas Fantasmas / Halos de Antialiasing (Sandwich Blend Test)
    // Identifica fitas de 1-2px sem núcleo interior que estão ensanduichadas entre duas regiões maiores (ou região + fundo)
    // e cuja cor observada é combinação convexa real (Linear-RGB / sRGB) das duas vizinhas — preservando 100% contornos pretos/claros intencionais!
    {
      const tempBuckets = new Map<number, number[]>();
      for (let px = 0; px < totalPixels; px++) {
        const rid = regionIdMap[px];
        if (rid <= 0) continue;
        let list = tempBuckets.get(rid);
        if (!list) {
          list = [];
          tempBuckets.set(rid, list);
        }
        list.push(px);
      }

      for (const [rid, pxs] of tempBuckets.entries()) {
        if (pxs.length > 600) continue;

        // Verifica se a região possui algum núcleo interior real (sobrevive a erosão 4-conexa de 1px)
        let interiorCount = 0;
        for (let i = 0; i < pxs.length; i++) {
          const p = pxs[i];
          const x = p % width;
          const y = (p - x) / width;
          if (
            x > 0 &&
            x + 1 < width &&
            y > 0 &&
            y + 1 < height &&
            regionIdMap[p - 1] === rid &&
            regionIdMap[p + 1] === rid &&
            regionIdMap[p - width] === rid &&
            regionIdMap[p + width] === rid
          ) {
            interiorCount++;
            if (interiorCount > Math.max(2, pxs.length * 0.12)) break;
          }
        }
        if (interiorCount > Math.max(2, pxs.length * 0.12)) continue;

        let blendConfirmed = 0;
        let sandwichedPixels = 0;
        const targetAssignments = new Int32Array(pxs.length);

        for (let i = 0; i < pxs.length; i++) {
          const p = pxs[i];
          const x = p % width;
          const y = (p - x) / width;
          const objLbl = ccLabels[p];
          const p4 = p * 4;

          let n1Reg = -999;
          let n1Rgb: [number, number, number] | null = null;
          let n2Reg = -999;
          let n2Rgb: [number, number, number] | null = null;

          for (let dy = -2; dy <= 2; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -2; dx <= 2; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              if (nx < 0 || nx >= width) continue;
              const np = ny * width + nx;
              const nr = regionIdMap[np];
              if (nr === rid) continue;

              if (nr <= 0 || isBackgroundPx[np]) {
                if (bgRgb) {
                  if (n1Reg === -999) {
                    n1Reg = -1;
                    n1Rgb = bgRgb;
                  } else if (n1Reg !== -1 && n2Reg === -999) {
                    n2Reg = -1;
                    n2Rgb = bgRgb;
                  }
                }
                continue;
              }

              // Regiões vizinhas (> pxs.length, ou núcleos de micro-detalhes >= 2px quando o anel tem <= 24px) servem de parede do sanduíche
              const nbLen = tempBuckets.get(nr)?.length ?? 0;
              if (nbLen < 2 || (nbLen <= pxs.length && pxs.length > 24) || ccLabels[np] !== objLbl) continue;
              const np4 = np * 4;
              if (n1Reg === -999) {
                n1Reg = nr;
                n1Rgb = [data[np4], data[np4 + 1], data[np4 + 2]];
              } else if (nr !== n1Reg && n2Reg === -999) {
                n2Reg = nr;
                n2Rgb = [data[np4], data[np4 + 1], data[np4 + 2]];
              }
            }
          }

          if (n1Reg !== -999 && n2Reg !== -999 && n1Rgb && n2Rgb) {
            sandwichedPixels++;
            const dual = unmixDualSpaceBoundaryMatting(
              data[p4],
              data[p4 + 1],
              data[p4 + 2],
              n1Rgb[0],
              n1Rgb[1],
              n1Rgb[2],
              n2Rgb[0],
              n2Rgb[1],
              n2Rgb[2]
            );
            if (dual.isTrueAntialiasBlend) {
              blendConfirmed++;
              targetAssignments[i] = dual.coverageOfFirst >= 0.5 ? n1Reg : n2Reg;
            } else {
              targetAssignments[i] = n1Reg > 0 ? n1Reg : n2Reg;
            }
          } else if (n1Reg !== -999) {
            targetAssignments[i] = n1Reg;
          }
        }

        // Exige que >= 65% da fita esteja entre DUAS regiões distintas e seja mistura convexa comprovada!
        if (
          sandwichedPixels >= Math.ceil(pxs.length * 0.65) &&
          blendConfirmed >= Math.ceil(sandwichedPixels * 0.68)
        ) {
          for (let i = 0; i < pxs.length; i++) {
            if (targetAssignments[i] !== 0) {
              regionIdMap[pxs[i]] = targetAssignments[i];
            }
          }
        }
      }
    }

    // Passo C.3: Unificação Topológica de Fragmentos Adjacentes de Mesmo Contorno / Mesma Tinta Sólida!
    // Reúne braços e cantos de um mesmo contorno contínuo (que foram semeados em etapas diferentes A, A.2 e C)
    // em uma ÚNICA estrutura vetorial contínua, eliminando dezenas de emendas internas desnecessárias!
    {
      const c3Buckets = new Map<number, number[]>();
      for (let px = 0; px < totalPixels; px++) {
        const rid = regionIdMap[px];
        if (rid <= 0) continue;
        let list = c3Buckets.get(rid);
        if (!list) {
          list = [];
          c3Buckets.set(rid, list);
        }
        list.push(px);
      }

      const uniformCoreByReg = new Map<number, [number, number, number]>();
      for (const [rid, pxs] of c3Buckets.entries()) {
        if (pxs.length < 2) continue;
        const intSamples: number[] = [];
        const step = Math.max(1, Math.floor(pxs.length / 250));
        for (let i = 0; i < pxs.length; i += step) {
          const p = pxs[i];
          const x = p % width;
          const y = (p - x) / width;
          if (
            x > 0 &&
            x + 1 < width &&
            y > 0 &&
            y + 1 < height &&
            regionIdMap[p - 1] === rid &&
            regionIdMap[p + 1] === rid &&
            regionIdMap[p - width] === rid &&
            regionIdMap[p + width] === rid
          ) {
            intSamples.push(p);
          }
        }

        let corePts: number[];
        if (intSamples.length >= 4) {
          corePts = intSamples;
        } else {
          // Para traços finos sem interior 4-conexo: usa os 40% pixels mais extremos (espinha pura, livre de anti-aliasing)
          const sorted = pxs
            .filter((_, idx) => idx % step === 0)
            .sort((p1, p2) => Math.abs(L[p2] - 52) - Math.abs(L[p1] - 52));
          corePts = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.4)));
        }

        const lArr: number[] = [];
        const aArr: number[] = [];
        const bArr: number[] = [];
        let sumAl = 0;
        for (let i = 0; i < corePts.length; i++) {
          const p = corePts[i];
          lArr.push(L[p]);
          aArr.push(a[p]);
          bArr.push(b[p]);
          sumAl += data[p * 4 + 3];
        }
        lArr.sort((u, v) => u - v);
        aArr.sort((u, v) => u - v);
        bArr.sort((u, v) => u - v);
        const p15 = Math.floor((lArr.length - 1) * 0.15);
        const p85 = Math.ceil((lArr.length - 1) * 0.85);
        const mid = Math.floor((lArr.length - 1) * 0.5);
        const inv = 1 / corePts.length;
        const coreSpan = Math.hypot(
          lArr[p85] - lArr[p15],
          aArr[p85] - aArr[p15],
          bArr[p85] - bArr[p15]
        );
        if (coreSpan <= 8.5 && sumAl * inv >= 200) {
          uniformCoreByReg.set(rid, [lArr[mid], aArr[mid], bArr[mid]]);
        }
      }

      if (uniformCoreByReg.size >= 2) {
        const minStepBetweenPair = new Map<string, number>();
        for (let y = 0; y < height; y++) {
          const row = y * width;
          for (let x = 0; x < width; x++) {
            const p = row + x;
            const r1 = regionIdMap[p];
            if (r1 <= 0 || !uniformCoreByReg.has(r1)) continue;
            const obj1 = ccLabels[p];

            const checkNb = (np: number) => {
              const r2 = regionIdMap[np];
              if (r2 <= r1 || !uniformCoreByReg.has(r2) || ccLabels[np] !== obj1) return;
              const key = `${r1}:${r2}`;
              const stepDe = deltaEOklab(L[p], a[p], b[p], L[np], a[np], b[np]);
              const prev = minStepBetweenPair.get(key);
              if (prev === undefined || stepDe < prev) {
                minStepBetweenPair.set(key, stepDe);
              }
            };

            if (x + 1 < width) checkNb(p + 1);
            if (y + 1 < height) checkNb(p + width);
            if (x + 1 < width && y + 1 < height) checkNb(p + width + 1);
            if (x > 0 && y + 1 < height) checkNb(p + width - 1);
          }
        }

        const ufParent = new Map<number, number>();
        const ufFind = (r: number): number => {
          let cur = r;
          while (ufParent.has(cur) && ufParent.get(cur)! !== cur) {
            cur = ufParent.get(cur)!;
          }
          return cur;
        };
        const ufUnion = (u: number, v: number) => {
          const ru = ufFind(u);
          const rv = ufFind(v);
          if (ru !== rv) {
            if (ru < rv) ufParent.set(rv, ru);
            else ufParent.set(ru, rv);
          }
        };

        for (const [pairKey, minBorderStepDe] of minStepBetweenPair.entries()) {
          if (minBorderStepDe > 9.5) continue;
          const sep = pairKey.indexOf(':');
          const r1 = Number(pairKey.slice(0, sep));
          const r2 = Number(pairKey.slice(sep + 1));
          const c1 = uniformCoreByReg.get(r1)!;
          const c2 = uniformCoreByReg.get(r2)!;
          if (deltaEOklab(c1[0], c1[1], c1[2], c2[0], c2[1], c2[2]) <= 4.8) {
            ufUnion(r1, r2);
          }
        }

        if (ufParent.size > 0) {
          for (let px = 0; px < totalPixels; px++) {
            const rid = regionIdMap[px];
            if (rid > 0 && ufParent.has(rid)) {
              regionIdMap[px] = ufFind(rid);
            }
          }
        }
      }
    }

    if (isAuditActive()) noteSegmentationStage('C-unificacao', regionIdMap);

    // Passo D: Consolidação Perceptual Controlada (evita milhares de fragmentos em fotos/texturas/JPEG SEM perder partes!)
    const baseNoiseFloor =
      (opts.noiseRemoval ?? 0) >= 50
        ? Math.round(3 + (((opts.noiseRemoval ?? 0) - 50) / 50) * 18)
        : (opts.noiseRemoval ?? 0) >= 20
          ? 12
          : isPhoto
            ? 6
            : 0;
    const noiseFloorPx = Math.max(
      baseNoiseFloor,
      hasSensorNoise ? 14 : isJpegSource ? 8 : 0
    );
    const maxTargetRegions = opts.maxTargetRegions ?? (isPhoto ? 460 : 520);

    const noiseReport = cleanContextualSegmentationNoise({
      width,
      height,
      data,
      L,
      a,
      b,
      regionIdMap,
      backgroundRgb: bgRgb,
    });
    const protectedRegionIds = new Set(noiseReport.protectedRegionIds);
    if (isAuditActive()) noteProtectedRegions(protectedRegionIds.size);

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
        if (isAuditActive()) {
          let small = 0;
          for (const pxs of regPixels.values()) {
            if (pxs.length >= 4 && pxs.length <= 40) small++;
          }
          noteHighContrastSmall(true, small);
          noteHighContrastSmall(false, small);
        }
        return regPixels;
      }

      if (isAuditActive()) {
        let small = 0;
        for (const pxs of regPixels.values()) {
          if (pxs.length >= 4 && pxs.length <= 40) small++;
        }
        noteHighContrastSmall(true, small);
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
        if (!pxs || pxs.length === 0 || protectedRegionIds.has(rid)) continue;

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
          noteMergedRegion();
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

      if (isAuditActive()) {
        let small = 0;
        for (const pxs of regPixels.values()) {
          if (pxs.length >= 4 && pxs.length <= 40) small++;
        }
        noteHighContrastSmall(false, small);
      }

      return regPixels;
    };

    const buckets = consolidateSmallOrExcessRegions();
    if (isAuditActive()) {
      noteSegmentationStage('D-consolidacao', regionIdMap);
      noteFinalSegmentation(regionIdMap, width, height, L, a, b);
    }

    // Calcula máscara de núcleo interior (1px erodido) e imagem decontaminada de borda (Alpha Matting)
    const interiorMask = new Uint8Array(totalPixels);
    const decontamData = new Uint8Array(data.length);
    decontamData.set(data);

    for (let px = 0; px < totalPixels; px++) {
      const rid = regionIdMap[px];
      if (rid <= 0) continue;
      const x = px % width;
      const y = (px - x) / width;
      if (
        x > 0 &&
        x + 1 < width &&
        y > 0 &&
        y + 1 < height &&
        regionIdMap[px - 1] === rid &&
        regionIdMap[px + 1] === rid &&
        regionIdMap[px - width] === rid &&
        regionIdMap[px + width] === rid
      ) {
        interiorMask[px] = 1;
      }
    }

    // Decontamina pixels de perímetro (1px) usando o núcleo interior mais próximo da própria região + vizinho externo
    for (let px = 0; px < totalPixels; px++) {
      const rid = regionIdMap[px];
      if (rid <= 0 || interiorMask[px]) continue;
      const x = px % width;
      const y = (px - x) / width;

      let innerPx = -1;
      let outerRgb: [number, number, number] | null = null;
      for (let dy = -2; dy <= 2; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const np = ny * width + nx;
          if (regionIdMap[np] === rid && interiorMask[np] && innerPx < 0) {
            innerPx = np;
          } else if (regionIdMap[np] !== rid && !outerRgb && Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
            if (regionIdMap[np] <= 0 && bgRgb) {
              outerRgb = bgRgb;
            } else if (regionIdMap[np] > 0 && data[np * 4 + 3] >= 180) {
              outerRgb = [data[np * 4], data[np * 4 + 1], data[np * 4 + 2]];
            }
          }
        }
      }

      if (innerPx >= 0 && outerRgb && data[px * 4 + 3] >= 180) {
        const p4 = px * 4;
        const in4 = innerPx * 4;
        const dual = unmixDualSpaceBoundaryMatting(
          data[p4],
          data[p4 + 1],
          data[p4 + 2],
          data[in4],
          data[in4 + 1],
          data[in4 + 2],
          outerRgb[0],
          outerRgb[1],
          outerRgb[2]
        );
        if (dual.isTrueAntialiasBlend && dual.coverageOfFirst >= 0.35 && dual.coverageOfFirst < 0.96) {
          const [dr, dg, db] = decontaminateBoundaryPixelSrgb8(
            data[p4],
            data[p4 + 1],
            data[p4 + 2],
            outerRgb[0],
            outerRgb[1],
            outerRgb[2],
            dual.coverageOfFirst
          );
          decontamData[p4] = dr;
          decontamData[p4 + 1] = dg;
          decontamData[p4 + 2] = db;
        }
      }
    }

    const decontaminatedImage: RawRgbaImage = {
      width,
      height,
      data: decontamData,
      sourceFormat: substrateImage.sourceFormat,
    };

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
      let intRSum = 0, intGSum = 0, intBSum = 0, intASum = 0, intCnt = 0;
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
        const r = decontamData[idx];
        const g = decontamData[idx + 1];
        const bCh = decontamData[idx + 2];
        const al = data[idx + 3];

        rSum += r;
        gSum += g;
        bSum += bCh;
        aSum += al;
        lSum += L[px];
        okASum += a[px];
        okBSum += b[px];
        if (interiorMask[px]) {
          intRSum += data[idx];
          intGSum += data[idx + 1];
          intBSum += data[idx + 2];
          intASum += al;
          intCnt++;
        }

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

      let { nature, deltaESpan, isMetallicOrSpecular } = classifyRegionVisualNature(
        typed,
        width,
        data,
        oklab,
        isSoftShadow,
        interiorMask
      );

      let thinStrokeSpineRgb: [number, number, number] | null = null;
      if (intCnt < Math.max(25, n * 0.42) && n >= 8 && !isSoftShadow && aSum / n >= 210) {
        // Traço/contorno fino (espessura <= 2.6px): extrai os 25% pixels de espinha mais puros (maior distância às vizinhanças externas)
        let surL = bgOklab ? bgOklab[0] : 50;
        let surA = bgOklab ? bgOklab[1] : 0;
        let surB = bgOklab ? bgOklab[2] : 0;
        let surCnt = 0;
        let surLSum = 0, surASum = 0, surBSum = 0;
        const stepSur = Math.max(1, Math.floor(n / 120));
        for (let i = 0; i < n; i += stepSur) {
          const p = typed[i];
          const x = p % width;
          const y = (p - x) / width;
          const nbCandidates = [
            x > 0 ? p - 1 : -1,
            x + 1 < width ? p + 1 : -1,
            y > 0 ? p - width : -1,
            y + 1 < height ? p + width : -1,
          ];
          for (const np of nbCandidates) {
            if (np < 0 || regionIdMap[np] === rid) continue;
            if (regionIdMap[np] <= 0 && bgOklab) {
              surLSum += bgOklab[0];
              surASum += bgOklab[1];
              surBSum += bgOklab[2];
              surCnt++;
            } else if (regionIdMap[np] > 0) {
              surLSum += L[np];
              surASum += a[np];
              surBSum += b[np];
              surCnt++;
            }
          }
        }
        if (surCnt > 0) {
          surL = surLSum / surCnt;
          surA = surASum / surCnt;
          surB = surBSum / surCnt;
        }

        const spineSamples: Array<{ px: number; contrast: number }> = [];
        const stepSp = Math.max(1, Math.floor(n / 240));
        for (let i = 0; i < n; i += stepSp) {
          const p = typed[i];
          spineSamples.push({
            px: p,
            contrast: deltaEOklab(L[p], a[p], b[p], surL, surA, surB),
          });
        }
        spineSamples.sort((u, v) => v.contrast - u.contrast);
        const topK = Math.max(3, Math.floor(spineSamples.length * 0.25));
        let spR = 0, spG = 0, spB = 0, spMinL = 100, spMaxL = 0;
        let spLSum = 0, spASum = 0, spBSum = 0;
        for (let k = 0; k < topK; k++) {
          const p = spineSamples[k].px;
          const i4 = p * 4;
          spR += data[i4];
          spG += data[i4 + 1];
          spB += data[i4 + 2];
          spLSum += L[p];
          spASum += a[p];
          spBSum += b[p];
          if (L[p] < spMinL) spMinL = L[p];
          if (L[p] > spMaxL) spMaxL = L[p];
        }
        const spMeanL = spLSum / topK;
        const spMeanA = spASum / topK;
        const spMeanB = spBSum / topK;
        let maxSpineDe = 0;
        for (let k = 0; k < topK; k++) {
          const p = spineSamples[k].px;
          const de = deltaEOklab(L[p], a[p], b[p], spMeanL, spMeanA, spMeanB);
          if (de > maxSpineDe) maxSpineDe = de;
        }
        if (maxSpineDe <= 8.5 && spMaxL - spMinL <= 12 && spineSamples[0].contrast >= 14) {
          nature = 'uniform';
          const pureR = Math.round(spR / topK);
          const pureG = Math.round(spG / topK);
          const pureB = Math.round(spB / topK);
          thinStrokeSpineRgb = [pureR, pureG, pureB];
          for (let i = 0; i < n; i++) {
            const p4 = typed[i] * 4;
            decontamData[p4] = pureR;
            decontamData[p4 + 1] = pureG;
            decontamData[p4 + 2] = pureB;
          }
        }
      }

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

      const finalMeanR = thinStrokeSpineRgb
        ? thinStrokeSpineRgb[0]
        : intCnt >= 6
          ? intRSum / intCnt
          : rSum / n;
      const finalMeanG = thinStrokeSpineRgb
        ? thinStrokeSpineRgb[1]
        : intCnt >= 6
          ? intGSum / intCnt
          : gSum / n;
      const finalMeanB = thinStrokeSpineRgb
        ? thinStrokeSpineRgb[2]
        : intCnt >= 6
          ? intBSum / intCnt
          : bSum / n;
      const finalMeanA = intCnt >= 6 && !isSoftShadow ? intASum / intCnt : aSum / n;
      const finalMeanOklab = srgb8ToOklabScaled(
        Math.round(finalMeanR),
        Math.round(finalMeanG),
        Math.round(finalMeanB)
      );

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
        meanR: finalMeanR,
        meanG: finalMeanG,
        meanB: finalMeanB,
        meanA: finalMeanA,
        meanOklab: finalMeanOklab,
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
      backgroundKind: backgroundClass.kind,
      backgroundRgb: bgRgb,
      backgroundOklab: bgOklab,
      substrateImage,
      decontaminatedImage,
      interiorMask,
      oklab,
      cannyEdgeMap,
      rgbGradientMap,
      oklabCurvatureMap,
      regionIdMap,
      objectLabelMap,
      objects,
      totalSubRegions,
      noiseCleanup: noiseReport,
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
