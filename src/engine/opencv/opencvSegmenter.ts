import type { RawRgbaImage } from '../types';

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

export interface SegmentedSubRegion {
  id: number;
  parentObjectId: number;
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
  colorSpanRgb: number;
  isSemiTransparent: boolean;
  isSmallDetail: boolean;
  isSoftShadow: boolean;
}

export interface SegmentedVisualObject {
  objectId: number;
  descriptiveName: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  totalArea: number;
  subRegions: SegmentedSubRegion[];
}

export interface OpenCvImageDecomposition {
  width: number;
  height: number;
  hasUniformOpaqueBackground: boolean;
  backgroundRgb: [number, number, number] | null;
  cannyEdgeMap: Uint8Array;
  rgbGradientMap: Uint8Array;
  regionIdMap: Int32Array;
  objects: SegmentedVisualObject[];
  totalSubRegions: number;
}

function detectUniformBorderBackground(image: RawRgbaImage): {
  hasUniformBg: boolean;
  bgRgb: [number, number, number] | null;
} {
  const { width, height, data } = image;
  const borderSamples: Array<[number, number, number, number]> = [];
  const stepX = Math.max(1, Math.floor(width / 48));
  const stepY = Math.max(1, Math.floor(height / 48));

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
  if (transparentBorderCount >= borderSamples.length * 0.4) {
    return { hasUniformBg: false, bgRgb: null };
  }

  const opaqueSamples = borderSamples.filter((s) => s[3] >= 220);
  if (opaqueSamples.length < borderSamples.length * 0.7) {
    return { hasUniformBg: false, bgRgb: null };
  }

  const rs = opaqueSamples.map((s) => s[0]).sort((a, b) => a - b);
  const gs = opaqueSamples.map((s) => s[1]).sort((a, b) => a - b);
  const bs = opaqueSamples.map((s) => s[2]).sort((a, b) => a - b);
  const mid = Math.floor(opaqueSamples.length / 2);
  const medR = rs[mid];
  const medG = gs[mid];
  const medB = bs[mid];

  let matching = 0;
  for (const s of opaqueSamples) {
    if (Math.abs(s[0] - medR) + Math.abs(s[1] - medG) + Math.abs(s[2] - medB) <= 18) {
      matching++;
    }
  }

  if (matching >= opaqueSamples.length * 0.82) {
    return { hasUniformBg: true, bgRgb: [medR, medG, medB] };
  }
  return { hasUniformBg: false, bgRgb: null };
}

/**
 * Etapa A + Etapa B (OpenCV + Decomposição Limpa sem Farpas de Anti-Aliasing):
 * - Separa cada parte anatômica/cor/gradiente em um único núcleo contínuo (ex.: Asa Superior, Penas Inferiores,
 *   Corpo em S, Olho, Pupila, Pontos e Sombra Elíptica);
 * - Trata matematicamente a borda de anti-aliasing (projeção linear entre cor do núcleo e cor externa/fundo),
 *   absorvendo pixels com cobertura >= 50% no próprio núcleo e descartando halos externos < 50% para NUNCA
 *   criar centenas de micro-farpas ("dentes") ao redor das curvas!
 */
export async function analyzeAndSegmentWithOpenCv(
  image: RawRgbaImage,
  excludedBoxes: Array<{ x: number; y: number; width: number; height: number }> = []
): Promise<OpenCvImageDecomposition> {
  const cv = await getOpenCv();
  const { width, height, data } = image;
  const totalPixels = width * height;

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
    cv.Canny(grayMat, cannyMat, 40, 120);
    const cannyEdgeMap = new Uint8Array(cannyMat.data);

    // Gradiente central de 2px máximo em R, G, B, A
    const rgbGradientMap = new Uint8Array(totalPixels);
    for (let y = 0; y < height; y++) {
      const yPrev = Math.max(0, y - 1);
      const yNext = Math.min(height - 1, y + 1);
      for (let x = 0; x < width; x++) {
        const xPrev = Math.max(0, x - 1);
        const xNext = Math.min(width - 1, x + 1);

        const iL = (y * width + xPrev) * 4;
        const iR = (y * width + xNext) * 4;
        const iU = (yPrev * width + x) * 4;
        const iD = (yNext * width + x) * 4;

        let maxMag = 0;
        for (let c = 0; c < 4; c++) {
          const gx = data[iR + c] - data[iL + c];
          const gy = data[iD + c] - data[iU + c];
          const mag = Math.hypot(gx, gy);
          if (mag > maxMag) maxMag = mag;
        }
        rgbGradientMap[y * width + x] = Math.min(255, Math.round(maxMag));
      }
    }

    const { hasUniformBg, bgRgb } = detectUniformBorderBackground(image);

    const isExcludedTypo = new Uint8Array(totalPixels);
    for (const box of excludedBoxes) {
      const x0 = Math.max(0, box.x);
      const y0 = Math.max(0, box.y);
      const x1 = Math.min(width, box.x + box.width);
      const y1 = Math.min(height, box.y + box.height);
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) {
          isExcludedTypo[row + x] = 1;
        }
      }
    }

    // Flood-fill estrito do fundo externo (tolerância <= 5 preserva integralmente sombras elípticas suaves!)
    const isBackgroundPx = new Uint8Array(totalPixels);
    if (!hasUniformBg) {
      for (let i = 0; i < totalPixels; i++) {
        if (data[i * 4 + 3] < 16 || isExcludedTypo[i]) {
          isBackgroundPx[i] = 1;
        }
      }
    } else if (bgRgb) {
      const bgQueue = new Int32Array(totalPixels);
      let bHead = 0;
      let bTail = 0;

      const isPureBgColor = (px: number): boolean => {
        const idx = px * 4;
        if (data[idx + 3] < 16) return true;
        const dist =
          Math.abs(data[idx] - bgRgb[0]) +
          Math.abs(data[idx + 1] - bgRgb[1]) +
          Math.abs(data[idx + 2] - bgRgb[2]);
        return dist <= 5;
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

        const nbs = [
          x > 0 ? px - 1 : -1,
          x + 1 < width ? px + 1 : -1,
          y > 0 ? px - width : -1,
          y + 1 < height ? px + width : -1,
        ];
        for (let k = 0; k < 4; k++) {
          const nPx = nbs[k];
          if (nPx < 0 || isBackgroundPx[nPx]) continue;
          if (isPureBgColor(nPx)) {
            isBackgroundPx[nPx] = 1;
            bgQueue[bTail++] = nPx;
          }
        }
      }

      for (let i = 0; i < totalPixels; i++) {
        if (isExcludedTypo[i]) isBackgroundPx[i] = 1;
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
    const ccLabels = labelsMat.data32S;

    // Passo 1: Extração de núcleos suaves interiores (rgbGradientMap < 26)
    const regionIdMap = new Int32Array(totalPixels);
    const bfsQueue = new Int32Array(totalPixels);
    let nextRegionId = 1;
    const ridgeThreshold = 26;

    for (let startPx = 0; startPx < totalPixels; startPx++) {
      if (isBackgroundPx[startPx] || regionIdMap[startPx] !== 0) continue;
      if (rgbGradientMap[startPx] >= ridgeThreshold) continue;
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
        const idx = px * 4;
        const r0 = data[idx];
        const g0 = data[idx + 1];
        const b0 = data[idx + 2];
        const a0 = data[idx + 3];

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
          if (rgbGradientMap[nPx] >= ridgeThreshold) continue;

          const nIdx = nPx * 4;
          const stepMax = Math.max(
            Math.abs(data[nIdx] - r0),
            Math.abs(data[nIdx + 1] - g0),
            Math.abs(data[nIdx + 2] - b0),
            Math.abs(data[nIdx + 3] - a0)
          );
          if (stepMax <= 18) {
            regionIdMap[nPx] = currentRegId;
            bfsQueue[tail++] = nPx;
          }
        }
      }
    }

    // Passo 2: Desmistura Matemática de Anti-Aliasing na Fronteira (até convergência das faixas de 2-3px)!
    for (let pass = 0; pass < 8; pass++) {
      let changed = 0;
      for (let px = 0; px < totalPixels; px++) {
        if (isBackgroundPx[px] || regionIdMap[px] !== 0) continue;
        const objLabel = ccLabels[px];
        if (objLabel <= 0) continue;

        const x = px % width;
        const y = (px - x) / width;
        const idx = px * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];

        // Verifica vizinhança de raio 2 para detectar proximidade ao fundo externo mesmo em rampa anti-aliased de 2px
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

        let bestNeighborReg = 0;
        let bestNeighborPx = -1;
        let bestColorDist = Infinity;

        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const nPx = ny * width + nx;
            const candReg = regionIdMap[nPx];
            if (candReg > 0 && ccLabels[nPx] === objLabel) {
              const nIdx = nPx * 4;
              const d =
                Math.abs(data[nIdx] - r) +
                Math.abs(data[nIdx + 1] - g) +
                Math.abs(data[nIdx + 2] - b);
              if (d < bestColorDist) {
                bestColorDist = d;
                bestNeighborReg = candReg;
                bestNeighborPx = nPx;
              }
            }
          }
        }

        if (bestNeighborReg > 0 && bestNeighborPx >= 0) {
          const cIdx = bestNeighborPx * 4;
          const cr = data[cIdx];
          const cg = data[cIdx + 1];
          const cb = data[cIdx + 2];

          if (touchesExteriorBg) {
            if (!hasUniformBg || !bgRgb) {
              regionIdMap[px] = a >= 127 ? bestNeighborReg : -1;
              changed++;
              continue;
            } else {
              const vx = cr - bgRgb[0];
              const vy = cg - bgRgb[1];
              const vz = cb - bgRgb[2];
              const denom = vx * vx + vy * vy + vz * vz;
              if (denom > 36) {
                const wx = r - bgRgb[0];
                const wy = g - bgRgb[1];
                const wz = b - bgRgb[2];
                const alphaCov = Math.max(0, Math.min(1, (wx * vx + wy * vy + wz * vz) / denom));
                const blendR = bgRgb[0] + alphaCov * vx;
                const blendG = bgRgb[1] + alphaCov * vy;
                const blendB = bgRgb[2] + alphaCov * vz;
                const blendResidual = Math.hypot(r - blendR, g - blendG, b - blendB);

                if (blendResidual <= 42) {
                  regionIdMap[px] = alphaCov >= 0.48 ? bestNeighborReg : -1;
                  changed++;
                  continue;
                }
              }
            }
          }

          // Costura interna entre duas regiões: absorve a menos que seja um detalhe interno de alto contraste (ex: pupila!)
          if (bestColorDist <= 180) {
            regionIdMap[px] = bestNeighborReg;
            changed++;
          }
        }
      }
      if (changed === 0) break;
    }

    // Passo 3: Preserva microdetalhes reais de alto contraste (ex.: pupila escura dentro do olho branco),
    // fundindo ou descartando qualquer resquício de borda sem contraste real!
    for (let startPx = 0; startPx < totalPixels; startPx++) {
      if (isBackgroundPx[startPx] || regionIdMap[startPx] !== 0) continue;
      const objLabel = ccLabels[startPx];
      if (objLabel <= 0) continue;

      const fineRegId = nextRegionId++;
      let head = 0;
      let tail = 0;
      bfsQueue[tail++] = startPx;
      regionIdMap[startPx] = fineRegId;

      let rSum = 0, gSum = 0, bSum = 0;
      let touchesBg = false;
      let adjReg = -1;
      let minContrastToAdj = Infinity;

      while (head < tail) {
        const px = bfsQueue[head++];
        const x = px % width;
        const y = (px - x) / width;
        const pIdx = px * 4;
        rSum += data[pIdx];
        gSum += data[pIdx + 1];
        bSum += data[pIdx + 2];

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
              const nIdx = nPx * 4;
              const cDist =
                Math.abs(data[nIdx] - data[pIdx]) +
                Math.abs(data[nIdx + 1] - data[pIdx + 1]) +
                Math.abs(data[nIdx + 2] - data[pIdx + 2]);
              if (cDist < minContrastToAdj) {
                minContrastToAdj = cDist;
                adjReg = nr;
              }
              continue;
            }
            if (nr !== 0 || ccLabels[nPx] !== objLabel) continue;
            const nIdx = nPx * 4;
            const d =
              Math.abs(data[nIdx] - data[startPx * 4]) +
              Math.abs(data[nIdx + 1] - data[startPx * 4 + 1]) +
              Math.abs(data[nIdx + 2] - data[startPx * 4 + 2]);
            if (d <= 95) {
              regionIdMap[nPx] = fineRegId;
              bfsQueue[tail++] = nPx;
            }
          }
        }
      }

      // Se toca o fundo externo e é pequeno (< 20px), ou se não tem alto contraste com o vizinho (< 90), não cria farpa!
      if ((touchesBg && tail < 20 && adjReg > 0) || (adjReg > 0 && minContrastToAdj < 90)) {
        const target = touchesBg && tail <= 8 ? -1 : adjReg;
        for (let i = 0; i < tail; i++) {
          regionIdMap[bfsQueue[i]] = target;
        }
      } else {
        void rSum;
        void gSum;
        void bSum;
      }
    }

    const buckets = new Map<number, number[]>();
    for (let px = 0; px < totalPixels; px++) {
      const rid = regionIdMap[px];
      if (rid <= 0) continue;
      const list = buckets.get(rid);
      if (list) list.push(px);
      else buckets.set(rid, [px]);
    }

    const subRegionsByObject = new Map<number, SegmentedSubRegion[]>();
    let totalSubRegions = 0;

    for (const [rid, pxList] of buckets.entries()) {
      if (pxList.length < 2) continue;
      const objLabel = ccLabels[pxList[0]];

      let minX = width, maxX = 0, minY = height, maxY = 0;
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
      let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
      let perimeterTouchesBg = 0;
      let perimeterTotal = 0;
      let perimeterBgSimSum = 0;

      const typed = new Int32Array(pxList.length);

      for (let i = 0; i < pxList.length; i++) {
        const px = pxList[i];
        typed[i] = px;
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

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (g < minG) minG = g;
        if (g > maxG) maxG = g;
        if (b < minB) minB = b;
        if (b > maxB) maxB = b;

        if (
          x === 0 ||
          x === width - 1 ||
          y === 0 ||
          y === height - 1 ||
          regionIdMap[px - 1] !== rid ||
          regionIdMap[px + 1] !== rid ||
          regionIdMap[px - width] !== rid ||
          regionIdMap[px + width] !== rid
        ) {
          perimeterTotal++;
          if (bgRgb) {
            perimeterTouchesBg++;
            perimeterBgSimSum +=
              (Math.abs(r - bgRgb[0]) + Math.abs(g - bgRgb[1]) + Math.abs(b - bgRgb[2])) / 3;
          }
        }
      }

      const n = pxList.length;
      const avgPerimDiffToBg =
        perimeterTouchesBg > 0 ? perimeterBgSimSum / perimeterTouchesBg : 255;
      const isSoftShadow =
        n >= 120 && perimeterTotal > 0 && avgPerimDiffToBg <= 10 && Math.max(maxR - minR, maxG - minG, maxB - minB) >= 12;

      const sub: SegmentedSubRegion = {
        id: rid,
        parentObjectId: objLabel,
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
        colorSpanRgb: Math.max(maxR - minR, maxG - minG, maxB - minB),
        isSemiTransparent: aSum / n < 242 || isSoftShadow,
        isSmallDetail: n <= 120,
        isSoftShadow,
      };

      const arr = subRegionsByObject.get(objLabel);
      if (arr) arr.push(sub);
      else subRegionsByObject.set(objLabel, [sub]);
      totalSubRegions++;
    }

    const objects: SegmentedVisualObject[] = [];
    for (let label = 1; label < numLabels; label++) {
      const subs = subRegionsByObject.get(label);
      if (!subs || subs.length === 0) continue;

      subs.sort((a, b) => b.pixelCount - a.pixelCount);

      let minX = width, minY = height, maxX = 0, maxY = 0, totalArea = 0;
      for (const s of subs) {
        if (s.minX < minX) minX = s.minX;
        if (s.minY < minY) minY = s.minY;
        if (s.maxX > maxX) maxX = s.maxX;
        if (s.maxY > maxY) maxY = s.maxY;
        totalArea += s.pixelCount;
      }

      objects.push({
        objectId: label,
        descriptiveName: 'objeto-vetorial',
        minX,
        minY,
        maxX,
        maxY,
        totalArea,
        subRegions: subs,
      });
    }

    // Sombras suaves são desenhadas atrás dos objetos principais!
    objects.sort((a, b) => {
      const aShadow = a.subRegions[0]?.isSoftShadow ? 1 : 0;
      const bShadow = b.subRegions[0]?.isSoftShadow ? 1 : 0;
      if (aShadow !== bShadow) return bShadow - aShadow;
      return b.totalArea - a.totalArea;
    });

    objects.forEach((obj, idx) => {
      obj.objectId = idx + 1;
      obj.descriptiveName = obj.subRegions[0]?.isSoftShadow
        ? `sombra-suave-${idx + 1}`
        : obj.totalArea <= 120
          ? `detalhe-${idx + 1}`
          : obj.subRegions.some((s) => s.colorSpanRgb >= 30)
            ? `objeto-gradiente-${idx + 1}`
            : `objeto-forma-${idx + 1}`;
    });

    return {
      width,
      height,
      hasUniformOpaqueBackground: hasUniformBg,
      backgroundRgb: bgRgb,
      cannyEdgeMap,
      rgbGradientMap,
      regionIdMap,
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
