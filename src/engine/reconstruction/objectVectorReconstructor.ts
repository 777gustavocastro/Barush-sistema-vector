import type {
  DetectedImageCategory,
  RawRgbaImage,
  TypographyRegion,
  VectorizationParameters,
} from '../types';
import {
  analyzeAndSegmentWithOpenCv,
  type OpenCvImageDecomposition,
  type SegmentedSubRegion,
  type SegmentedVisualObject,
} from '../opencv/opencvSegmenter';
import { fitRegionSvgFill, type RegionSvgFillFit } from '../gradients/svgGradientReconstructor';
import { traceMaskToFlatBezierPathData } from '../vectorizers/potraceEngine';

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
      .join('')
  );
}

function buildExactEllipseBezierPathD(cx: number, cy: number, rx: number, ry: number): string {
  const k = 0.55228475;
  const kx = rx * k;
  const ky = ry * k;
  const f = (n: number) => Number(n.toFixed(2));
  return [
    `M ${f(cx)} ${f(cy - ry)}`,
    `C ${f(cx + kx)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ky)} ${f(cx + rx)} ${f(cy)}`,
    `C ${f(cx + rx)} ${f(cy + ky)} ${f(cx + kx)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)}`,
    `C ${f(cx - kx)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ky)} ${f(cx - rx)} ${f(cy)}`,
    `C ${f(cx - rx)} ${f(cy - ky)} ${f(cx - kx)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)}`,
    `Z`,
  ].join(' ');
}

function detectAnalyticalEllipseIfMatch(
  sub: SegmentedSubRegion,
  imgWidth: number
): { cx: number; cy: number; rx: number; ry: number } | null {
  if (sub.pixelCount < 3) return null;

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < sub.pixelCount; i++) {
    const px = sub.pixels[i];
    sumX += (px % imgWidth) + 0.5;
    sumY += Math.floor(px / imgWidth) + 0.5;
  }
  const cx = sumX / sub.pixelCount;
  const cy = sumY / sub.pixelCount;

  const bw = sub.maxX - sub.minX + 1;
  const bh = sub.maxY - sub.minY + 1;
  if (sub.pixelCount <= 22 && bw <= 7 && bh <= 7 && Math.abs(bw - bh) <= 2) {
    const r = Math.sqrt(sub.pixelCount / Math.PI);
    return { cx, cy, rx: Math.max(0.95, r), ry: Math.max(0.95, r) };
  }

  let mxx = 0;
  let myy = 0;
  let mxy = 0;
  for (let i = 0; i < sub.pixelCount; i++) {
    const px = sub.pixels[i];
    const dx = (px % imgWidth) + 0.5 - cx;
    const dy = Math.floor(px / imgWidth) + 0.5 - cy;
    mxx += dx * dx;
    myy += dy * dy;
    mxy += dx * dy;
  }
  mxx /= sub.pixelCount;
  myy /= sub.pixelCount;
  mxy /= sub.pixelCount;

  if (Math.abs(mxy) > Math.max(mxx, myy) * 0.18) {
    return null;
  }

  const rx = 2 * Math.sqrt(Math.max(0.25, mxx));
  const ry = 2 * Math.sqrt(Math.max(0.25, myy));
  const theoreticalArea = Math.PI * rx * ry;
  const areaRatio = sub.pixelCount / Math.max(1, theoreticalArea);
  if (areaRatio < 0.85 || areaRatio > 1.15) {
    return null;
  }

  let inside = 0;
  const rxTol = rx + 0.8;
  const ryTol = ry + 0.8;
  for (let i = 0; i < sub.pixelCount; i++) {
    const px = sub.pixels[i];
    const dx = ((px % imgWidth) + 0.5 - cx) / rxTol;
    const dy = (Math.floor(px / imgWidth) + 0.5 - cy) / ryTol;
    if (dx * dx + dy * dy <= 1.08) {
      inside++;
    }
  }
  if (inside / sub.pixelCount < 0.93) {
    return null;
  }

  if (
    Math.abs(bw - 2 * rx) > Math.max(3, rx * 0.24) ||
    Math.abs(bh - 2 * ry) > Math.max(3, ry * 0.24)
  ) {
    return null;
  }

  return { cx, cy, rx, ry };
}

/**
 * RECONSTRUÇÃO GEOMÉTRICA SUB-PIXEL POR INVERSÃO DE ANTI-ALIASING:
 * Em vez de traçar uma máscara binária 0/1 com degraus ("escadas"), calcula o campo contínuo
 * real de cobertura `φ(x, y) ∈ [0, 1]` diretamente a partir dos pixels anti-aliased da borda original
 * `(C_px - C_ext) · (C_int - C_ext) / ||C_int - C_ext||²`, interpola em 4× e extrai curvas Bézier
 * cúbicas ultra-lisas (`alphamax = 1.18, opttolerance = 0.65` em 4× = 0.16px reais)!
 */
async function traceSubRegionCoverageBezier(
  subPixels: Int32Array,
  subCount: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  image: RawRgbaImage,
  decomposition: OpenCvImageDecomposition,
  fit: RegionSvgFillFit,
  dilateInternalSeamsPx: number,
  curveAlphaMax: number,
  curveOptTolBase: number
): Promise<string[]> {
  const { width, height, data } = image;
  const pad = 4;
  const cx0 = Math.max(0, minX - pad);
  const cy0 = Math.max(0, minY - pad);
  const cw = Math.min(width - cx0, maxX - minX + 1 + pad * 2);
  const ch = Math.min(height - cy0, maxY - minY + 1 + pad * 2);

  const inSub = new Uint8Array(cw * ch);
  for (let i = 0; i < subCount; i++) {
    const px = subPixels[i];
    const lx = (px % width) - cx0;
    const ly = Math.floor(px / width) - cy0;
    if (lx >= 0 && lx < cw && ly >= 0 && ly < ch) {
      inSub[ly * cw + lx] = 1;
    }
  }

  // Se esta parte fica sob outra parte no mesmo objeto (ex.: asa sob o corpo central),
  // expande apenas nos pixels internos que pertencem a outras sub-regiões do mesmo objeto!
  if (dilateInternalSeamsPx > 0) {
    for (let step = 0; step < dilateInternalSeamsPx; step++) {
      const snap = new Uint8Array(inSub);
      for (let ly = 1; ly < ch - 1; ly++) {
        const gy = cy0 + ly;
        for (let lx = 1; lx < cw - 1; lx++) {
          const mIdx = ly * cw + lx;
          if (snap[mIdx]) continue;
          const gx = cx0 + lx;
          const gPx = gy * width + gx;
          // Só dilata para dentro de outra sub-região positiva (NUNCA para o fundo externo!)
          if (decomposition.regionIdMap[gPx] <= 0) continue;
          if (snap[mIdx - 1] || snap[mIdx + 1] || snap[mIdx - cw] || snap[mIdx + cw]) {
            inSub[mIdx] = 1;
          }
        }
      }
    }
  }

  // Constrói o campo escalar contínuo φ(lx, ly) ∈ [0, 1] medindo a cobertura anti-aliased exata na borda!
  const phi = new Float32Array(cw * ch);
  const bgRgb = decomposition.backgroundRgb;

  for (let ly = 0; ly < ch; ly++) {
    const gy = cy0 + ly;
    for (let lx = 0; lx < cw; lx++) {
      const mIdx = ly * cw + lx;
      const isInside = inSub[mIdx] === 1;

      // Verifica se está na faixa de transição de 1px da fronteira
      let nearBoundary = false;
      for (let dy = -1; dy <= 1 && !nearBoundary; dy++) {
        const nly = ly + dy;
        if (nly < 0 || nly >= ch) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nlx = lx + dx;
          if (nlx < 0 || nlx >= cw) continue;
          if ((inSub[nly * cw + nlx] === 1) !== isInside) {
            nearBoundary = true;
            break;
          }
        }
      }

      if (!nearBoundary) {
        phi[mIdx] = isInside ? 1.0 : 0.0;
        continue;
      }

      const gx = cx0 + lx;
      const rgbaIdx = (gy * width + gx) * 4;
      const r = data[rgbaIdx];
      const g = data[rgbaIdx + 1];
      const b = data[rgbaIdx + 2];
      const a = data[rgbaIdx + 3];

      // Cor interior esperada pelo modelo de gradiente/sólido na coordenada exata (gx, gy)
      const [ir, ig, ib] = fit.evalColorAt(gx, gy);

      // Encontra a cor externa local (fundo ou outra região adjacente)
      let er = bgRgb ? bgRgb[0] : 255;
      let eg = bgRgb ? bgRgb[1] : 255;
      let eb = bgRgb ? bgRgb[2] : 255;
      let foundExt = false;

      for (let rSearch = 1; rSearch <= 2 && !foundExt; rSearch++) {
        for (let dy = -rSearch; dy <= rSearch && !foundExt; dy++) {
          const nly = ly + dy;
          if (nly < 0 || nly >= ch) continue;
          for (let dx = -rSearch; dx <= rSearch; dx++) {
            const nlx = lx + dx;
            if (nlx < 0 || nlx >= cw) continue;
            if (inSub[nly * cw + nlx] === 0) {
              const eIdx = ((cy0 + nly) * width + (cx0 + nlx)) * 4;
              // Prefere vizinho externo já fora da zona de mistura
              const distFromIn = Math.hypot(data[eIdx] - ir, data[eIdx + 1] - ig, data[eIdx + 2] - ib);
              if (distFromIn > 25 || rSearch === 2) {
                er = data[eIdx];
                eg = data[eIdx + 1];
                eb = data[eIdx + 2];
                foundExt = true;
                break;
              }
            }
          }
        }
      }

      if (!decomposition.hasUniformOpaqueBackground && a < 250) {
        phi[mIdx] = a / 255;
        continue;
      }

      const vx = ir - er;
      const vy = ig - eg;
      const vz = ib - eb;
      const denom = vx * vx + vy * vy + vz * vz;

      if (denom > 64) {
        const wx = r - er;
        const wy = g - eg;
        const wz = b - eb;
        const cov = Math.max(0, Math.min(1, (wx * vx + wy * vy + wz * vz) / denom));
        phi[mIdx] = cov;
      } else {
        phi[mIdx] = isInside ? 1.0 : 0.0;
      }
    }
  }

  // Suavização Gaussiana leve 3x3 sobre o campo contínuo φ para estabilizar normais sem arredondar pontas agudas
  const smoothPhi = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const center = phi[y * cw + x];
      if (center === 0 || center === 1) {
        // Verifica se vizinhos também são constantes
        let allSame = true;
        for (let dy = -1; dy <= 1 && allSame; dy++) {
          const ny = Math.max(0, Math.min(ch - 1, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const nx = Math.max(0, Math.min(cw - 1, x + dx));
            if (phi[ny * cw + nx] !== center) {
              allSame = false;
              break;
            }
          }
        }
        if (allSame) {
          smoothPhi[y * cw + x] = center;
          continue;
        }
      }

      let sum = 0;
      let wSum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = Math.max(0, Math.min(ch - 1, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const nx = Math.max(0, Math.min(cw - 1, x + dx));
          const w = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
          sum += phi[ny * cw + nx] * w;
          wSum += w;
        }
      }
      smoothPhi[y * cw + x] = sum / wSum;
    }
  }

  const longest = Math.max(cw, ch);
  const factor: 1 | 2 | 4 = longest <= 340 ? 4 : longest <= 720 ? 2 : 1;
  const uw = cw * factor;
  const uh = ch * factor;
  const invFactor = 1 / factor;

  const hiMask = new Uint8Array(uw * uh);

  const sampleSmoothPhi = (fx: number, fy: number): number => {
    const x0 = Math.max(0, Math.min(cw - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(ch - 1, Math.floor(fy)));
    const x1 = Math.min(cw - 1, x0 + 1);
    const y1 = Math.min(ch - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0));
    const ty = Math.max(0, Math.min(1, fy - y0));
    return (
      smoothPhi[y0 * cw + x0] * (1 - tx) * (1 - ty) +
      smoothPhi[y0 * cw + x1] * tx * (1 - ty) +
      smoothPhi[y1 * cw + x0] * (1 - tx) * ty +
      smoothPhi[y1 * cw + x1] * tx * ty
    );
  };

  for (let uy = 0; uy < uh; uy++) {
    const ly = (uy + 0.5) * invFactor - 0.5;
    for (let ux = 0; ux < uw; ux++) {
      const lx = (ux + 0.5) * invFactor - 0.5;
      hiMask[uy * uw + ux] = sampleSmoothPhi(lx, ly) >= 0.49 ? 1 : 0;
    }
  }

  // CRÍTICO: opttolerance do Potrace é expresso em pixels da grade escalada!
  // Multiplicar por `factor` mantém tolerância geométrica de ~0.22px reais (elimina 100% dos dentes de escada!)
  const scaledOptTol = Number((curveOptTolBase * factor).toFixed(3));

  return traceMaskToFlatBezierPathData(hiMask, uw, uh, cx0, cy0, invFactor, {
    alphamax: curveAlphaMax,
    opttolerance: scaledOptTol,
    turdsize: factor * factor,
  });
}

export interface ObjectVectorReconstructionOutput {
  svg: string;
  objectCount: number;
  gradientCount: number;
  pathCount: number;
}

export async function reconstructImageAsEditableObjects(
  image: RawRgbaImage,
  params: VectorizationParameters,
  detectedCategory: DetectedImageCategory,
  extraTypographyDefsXml = '',
  extraTypographyGroupsXml = '',
  typographyBoxes: TypographyRegion[] = []
): Promise<ObjectVectorReconstructionOutput> {
  const { width, height } = image;
  const decomposition = await analyzeAndSegmentWithOpenCv(image, typographyBoxes);

  const defsXmlParts: string[] = [];
  const objectGroupsXml: string[] = [];
  let gradientCounter = 0;
  let pathCounter = 0;

  const curveAlphaMax = Number(
    Math.max(
      0.65,
      1.08 +
        (params.curveSmoothness / 100) * 0.22 +
        ((86 - params.contourSensitivity) / 100) * 0.24
    ).toFixed(3)
  );
  const curveOptTolBase = Number(
    (
      0.22 +
      (params.curveSmoothness / 100) * 0.14 +
      (params.pathSimplification / 100) * 0.95 +
      (Math.max(0, 70 - params.detailPrecision) / 70) * 0.35
    ).toFixed(3)
  );
  const minSubArea =
    params.noiseRemoval >= 60
      ? Math.round(4 + ((params.noiseRemoval - 60) / 40) * 24)
      : 0;

  if (decomposition.hasUniformOpaqueBackground && decomposition.backgroundRgb) {
    const [br, bg, bb] = decomposition.backgroundRgb;
    const bgHex = rgbToHex(br, bg, bb);
    pathCounter++;
    objectGroupsXml.push(
      `  <g id="objeto-plano-fundo" data-tipo="plano-de-fundo">` +
        `<path id="caminho-${pathCounter}" fill="${bgHex}" d="M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z"/>` +
      `</g>`
    );
  }

  const maxObjects = detectedCategory === 'photograph' ? 180 : 140;
  const objectsToProcess: SegmentedVisualObject[] = decomposition.objects.slice(0, maxObjects);

  for (const obj of objectsToProcess) {
    const childPathsXml: string[] = [];
    const maxSubs = detectedCategory === 'photograph' ? 45 : 64;
    const activeSubs = obj.subRegions.slice(0, maxSubs);

    for (let sIdx = 0; sIdx < activeSubs.length; sIdx++) {
      const sub = activeSubs[sIdx];
      if (minSubArea > 0 && sub.pixelCount < minSubArea) continue;
      const gradId = `grad-obj-${obj.objectId}-${sIdx + 1}`;
      const rawFit = fitRegionSvgFill(
        sub.pixels,
        sub.pixelCount,
        sub.minX,
        sub.minY,
        sub.maxX,
        sub.maxY,
        image,
        1,
        gradId,
        decomposition.rgbGradientMap
      );

      let fit = rawFit;
      if (params.colorCount <= 16) {
        const levels = Math.max(2, Math.round(params.colorCount));
        const step = 255 / (levels - 1);
        const qr = Math.round(Math.round(sub.meanR / step) * step);
        const qg = Math.round(Math.round(sub.meanG / step) * step);
        const qb = Math.round(Math.round(sub.meanB / step) * step);
        fit = {
          ...rawFit,
          kind: 'solid',
          fillValue: rgbToHex(qr, qg, qb),
          defsXml: '',
          evalColorAt: () => [qr, qg, qb, 255],
        };
      }

      const ellipseMatch = detectAnalyticalEllipseIfMatch(sub, width);
      let dString = '';

      if (ellipseMatch) {
        dString = buildExactEllipseBezierPathD(
          ellipseMatch.cx,
          ellipseMatch.cy,
          ellipseMatch.rx,
          ellipseMatch.ry
        );
      } else {
        // Dilata 1px APENAS nas costuras internas contra sub-regiões desenhadas por cima (ex.: asa sob o corpo),
        // jamais contra o fundo externo!
        const internalSeamDilate =
          activeSubs.length >= 2 && sIdx < activeSubs.length - 1 && !sub.isSmallDetail ? 1 : 0;

        const dList = await traceSubRegionCoverageBezier(
          sub.pixels,
          sub.pixelCount,
          sub.minX,
          sub.minY,
          sub.maxX,
          sub.maxY,
          image,
          decomposition,
          fit,
          internalSeamDilate,
          curveAlphaMax,
          curveOptTolBase
        );
        dString = dList.join(' ');
      }

      if (!dString) continue;

      if (fit.defsXml) {
        defsXmlParts.push(fit.defsXml);
        gradientCounter++;
      }

      const opAttr =
        fit.fillOpacity !== undefined && fit.fillOpacity < 0.99
          ? ` fill-opacity="${Number(fit.fillOpacity.toFixed(3))}"`
          : '';
      pathCounter++;
      childPathsXml.push(
        `<path id="caminho-${pathCounter}" fill="${fit.fillValue}"${opAttr} d="${dString}"/>`
      );
    }

    if (childPathsXml.length > 0) {
      objectGroupsXml.push(
        `  <g id="objeto-${obj.objectId}" data-nome="${obj.descriptiveName}">` +
          childPathsXml.join('') +
        `</g>`
      );
    }
  }

  const finalDefs =
    defsXmlParts.length > 0 || extraTypographyDefsXml
      ? `  <defs>${defsXmlParts.join('')}${extraTypographyDefsXml}</defs>\n`
      : '';

  const finalSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
    finalDefs +
    objectGroupsXml.join('\n') +
    (extraTypographyGroupsXml ? `\n  ${extraTypographyGroupsXml}` : '') +
    `\n</svg>`;

  const totalObjects =
    objectGroupsXml.length +
    [...extraTypographyGroupsXml.matchAll(/<g\b[^>]*\bid="objeto-/gi)].length;

  return {
    svg: finalSvg,
    objectCount: totalObjects,
    gradientCount: gradientCounter,
    pathCount: pathCounter,
  };
}

export function organizeVTracerPathsIntoObjects(
  rawVTracerSvg: string,
  viewBoxW: number,
  viewBoxH: number
): string {
  const pathTagRegex = /<path\b([^>]*?)\/?>/gi;
  interface ParsedPathItem {
    rawTag: string;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    area: number;
    isCanvasBg: boolean;
  }

  const items: ParsedPathItem[] = [];
  let match: RegExpExecArray | null;

  while ((match = pathTagRegex.exec(rawVTracerSvg)) !== null) {
    const attrs = match[1];
    const dMatch = attrs.match(/\bd\s*=\s*["']([^"']+)["']/i);
    if (!dMatch) continue;

    let tx = 0;
    let ty = 0;
    const trMatch = attrs.match(
      /\btransform\s*=\s*["']translate\(\s*([-+\d.]+)[,\s]+([-+\d.]+)\s*\)["']/i
    );
    if (trMatch) {
      tx = Number(trMatch[1]) || 0;
      ty = Number(trMatch[2]) || 0;
    }

    const nums = dMatch[1].match(/[-+]?(?:\d+\.?\d*|\.\d+)/g);
    let minX = tx, maxX = tx, minY = ty, maxY = ty;
    if (nums && nums.length >= 2) {
      const isAllAbsolute = !/[mlhvcsqt]/.test(dMatch[1]);
      if (isAllAbsolute) {
        minX = Infinity;
        maxX = -Infinity;
        minY = Infinity;
        maxY = -Infinity;
        for (let i = 0; i + 1 < nums.length; i += 2) {
          const x = Number(nums[i]) + tx;
          const y = Number(nums[i + 1]) + ty;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      } else {
        const x0 = Number(nums[0]) + tx;
        const y0 = Number(nums[1]) + ty;
        minX = x0 - 4;
        maxX = x0 + 4;
        minY = y0 - 4;
        maxY = y0 + 4;
      }
    }

    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const area = bw * bh;
    const isCanvasBg = bw >= viewBoxW * 0.96 && bh >= viewBoxH * 0.96;

    items.push({
      rawTag: `<path${attrs}/>`,
      minX,
      minY,
      maxX,
      maxY,
      area,
      isCanvasBg,
    });
  }

  if (items.length === 0) return rawVTracerSvg;

  const bgItems: ParsedPathItem[] = [];
  let idxCursor = 0;
  while (idxCursor < items.length && items[idxCursor].isCanvasBg) {
    bgItems.push(items[idxCursor]);
    idxCursor++;
  }
  const fgItems = items.slice(idxCursor);

  const n = fgItems.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;

  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      if (ra < rb) parent[rb] = ra;
      else parent[ra] = rb;
    }
  };

  for (let i = 0; i < n; i++) {
    const a = fgItems[i];
    for (let j = i + 1; j < n; j++) {
      const b = fgItems[j];
      const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
      if (overlapX > 0 && overlapY > 0) {
        union(i, j);
      }
    }
  }

  const groupsMap = new Map<number, ParsedPathItem[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const list = groupsMap.get(r);
    if (list) list.push(fgItems[i]);
    else groupsMap.set(r, [fgItems[i]]);
  }

  const outGroups: string[] = [];
  if (bgItems.length > 0) {
    outGroups.push(
      `<g id="objeto-plano-fundo" data-tipo="plano-de-fundo">${bgItems.map((b) => b.rawTag).join('')}</g>`
    );
  }

  let objCounter = 1;
  for (const groupPaths of groupsMap.values()) {
    outGroups.push(
      `<g id="objeto-${objCounter++}" data-caminhos="${groupPaths.length}">${groupPaths.map((p) => p.rawTag).join('')}</g>`
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${viewBoxW}" height="${viewBoxH}" viewBox="0 0 ${viewBoxW} ${viewBoxH}">${outGroups.join('')}</svg>`;
}
