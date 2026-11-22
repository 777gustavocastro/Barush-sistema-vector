import type { QualityComparisonReport, RawRgbaImage } from '../types';

function isNodeRuntime(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    Boolean((globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node) &&
    typeof window === 'undefined' &&
    typeof OffscreenCanvas === 'undefined'
  );
}

/**
 * Rasteriza o SVG gerado exatamente nas dimensões (width x height) da imagem original
 * tanto em Node.js (@resvg/resvg-js) quanto em Navegador / Web Worker (OffscreenCanvas / Canvas).
 */
export async function rasterizeSvgAtExactSize(
  svgMarkup: string,
  targetWidth: number,
  targetHeight: number,
  opaqueBackgroundRgb?: [number, number, number]
): Promise<RawRgbaImage | null> {
  if (isNodeRuntime()) {
    const resvgPkg = '@resvg/resvg-js';
    const { Resvg } = await import(/* @vite-ignore */ resvgPkg);
    const bgStr = opaqueBackgroundRgb
      ? `rgb(${opaqueBackgroundRgb[0]}, ${opaqueBackgroundRgb[1]}, ${opaqueBackgroundRgb[2]})`
      : undefined;
    const resvg = new Resvg(svgMarkup, {
      fitTo: { mode: 'width', value: targetWidth },
      ...(bgStr ? { background: bgStr } : {}),
    });
    const rendered = resvg.render();
    return {
      width: rendered.width,
      height: rendered.height,
      data: new Uint8Array(
        rendered.pixels.buffer,
        rendered.pixels.byteOffset,
        rendered.pixels.byteLength
      ),
    };
  }

  // Navegador ou Web Worker com OffscreenCanvas + createImageBitmap / Image
  try {
    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const url = URL.createObjectURL(svgBlob);
      try {
        return await new Promise<RawRgbaImage>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              reject(new Error('Contexto 2D indisponível'));
              return;
            }
            if (opaqueBackgroundRgb) {
              ctx.fillStyle = `rgb(${opaqueBackgroundRgb[0]}, ${opaqueBackgroundRgb[1]}, ${opaqueBackgroundRgb[2]})`;
              ctx.fillRect(0, 0, targetWidth, targetHeight);
            }
            ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
            const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
            resolve({
              width: targetWidth,
              height: targetHeight,
              data: new Uint8Array(imgData.data.buffer),
            });
          };
          img.onerror = () => reject(new Error('Falha ao renderizar SVG para comparação'));
          img.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Calcula métricas comparativas reais entre a imagem original e o SVG renderizado:
 * 1) Semelhança visual por pixels (%) e PSNR (dB)
 * 2) Fidelidade de contornos (Sobel F1 com tolerância de 1px)
 * 3) Preservação cromática em blocos espaciais (%)
 */
export function computeQualityComparisonFromBuffers(
  original: RawRgbaImage,
  renderedSvg: RawRgbaImage
): QualityComparisonReport {
  const width = Math.min(original.width, renderedSvg.width);
  const height = Math.min(original.height, renderedSvg.height);
  const totalPixels = Math.max(1, width * height);

  let absDiffSum = 0;
  let sqDiffSum = 0;

  // Luminâncias para comparação de contornos Sobel
  const origLum = new Float32Array(width * height);
  const vecLum = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const oIdx = (y * original.width + x) * 4;
      const vIdx = (y * renderedSvg.width + x) * 4;

      const oa = original.data[oIdx + 3] / 255;
      const va = renderedSvg.data[vIdx + 3] / 255;

      const or = original.data[oIdx] * oa;
      const og = original.data[oIdx + 1] * oa;
      const ob = original.data[oIdx + 2] * oa;

      const vr = renderedSvg.data[vIdx] * va;
      const vg = renderedSvg.data[vIdx + 1] * va;
      const vb = renderedSvg.data[vIdx + 2] * va;

      const dr = Math.abs(or - vr);
      const dg = Math.abs(og - vg);
      const db = Math.abs(ob - vb);
      const da = Math.abs(original.data[oIdx + 3] - renderedSvg.data[vIdx + 3]);

      absDiffSum += dr + dg + db + da;
      sqDiffSum += dr * dr + dg * dg + db * db + da * da;

      origLum[y * width + x] = 0.299 * or + 0.587 * og + 0.114 * ob;
      vecLum[y * width + x] = 0.299 * vr + 0.587 * vg + 0.114 * vb;
    }
  }

  const mae = absDiffSum / (totalPixels * 4);
  const mse = sqDiffSum / (totalPixels * 4);
  const psnrDb = mse <= 1e-6 ? 60 : Math.min(60, Number((10 * Math.log10((255 * 255) / mse)).toFixed(2)));
  const pixelSimilarityPct = Number(Math.max(0, Math.min(100, (1 - mae / 255) * 100)).toFixed(2));

  // Comparação de contornos (bordas de gradiente local com tolerância de 1px)
  const origEdges = new Uint8Array(width * height);
  const vecEdges = new Uint8Array(width * height);
  const edgeThresh = 26;
  let origEdgeCount = 0;
  let vecEdgeCount = 0;

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      const ogx = Math.abs(origLum[idx + 1] - origLum[idx - 1]);
      const ogy = Math.abs(origLum[idx + width] - origLum[idx - width]);
      if (ogx + ogy >= edgeThresh) {
        origEdges[idx] = 1;
        origEdgeCount++;
      }

      const vgx = Math.abs(vecLum[idx + 1] - vecLum[idx - 1]);
      const vgy = Math.abs(vecLum[idx + width] - vecLum[idx - width]);
      if (vgx + vgy >= edgeThresh) {
        vecEdges[idx] = 1;
        vecEdgeCount++;
      }
    }
  }

  let matchedOrig = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      if (!origEdges[idx]) continue;
      if (
        vecEdges[idx] ||
        vecEdges[idx - 1] ||
        vecEdges[idx + 1] ||
        vecEdges[idx - width] ||
        vecEdges[idx + width] ||
        vecEdges[idx - width - 1] ||
        vecEdges[idx - width + 1] ||
        vecEdges[idx + width - 1] ||
        vecEdges[idx + width + 1]
      ) {
        matchedOrig++;
      }
    }
  }

  let matchedVec = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      if (!vecEdges[idx]) continue;
      if (
        origEdges[idx] ||
        origEdges[idx - 1] ||
        origEdges[idx + 1] ||
        origEdges[idx - width] ||
        origEdges[idx - width] ||
        origEdges[idx - width - 1] ||
        origEdges[idx - width + 1] ||
        origEdges[idx + width - 1] ||
        origEdges[idx + width + 1]
      ) {
        matchedVec++;
      }
    }
  }

  const recall = origEdgeCount > 0 ? matchedOrig / origEdgeCount : 1;
  const precision = vecEdgeCount > 0 ? matchedVec / vecEdgeCount : 1;
  const contourF1 =
    recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 1;
  const contourFidelityPct = Number((contourF1 * 100).toFixed(2));

  // Fidelidade cromática em grade espacial 16x16
  const gridCols = Math.min(16, width);
  const gridRows = Math.min(16, height);
  let blockColorErrorSum = 0;
  let activeBlocks = 0;

  for (let gy = 0; gy < gridRows; gy++) {
    const y0 = Math.floor((gy * height) / gridRows);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / gridRows));
    for (let gx = 0; gx < gridCols; gx++) {
      const x0 = Math.floor((gx * width) / gridCols);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / gridCols));

      let orSum = 0, ogSum = 0, obSum = 0, oCnt = 0;
      let vrSum = 0, vgSum = 0, vbSum = 0, vCnt = 0;

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const oIdx = (y * original.width + x) * 4;
          const vIdx = (y * renderedSvg.width + x) * 4;
          if (original.data[oIdx + 3] >= 32) {
            orSum += original.data[oIdx];
            ogSum += original.data[oIdx + 1];
            obSum += original.data[oIdx + 2];
            oCnt++;
          }
          if (renderedSvg.data[vIdx + 3] >= 32) {
            vrSum += renderedSvg.data[vIdx];
            vgSum += renderedSvg.data[vIdx + 1];
            vbSum += renderedSvg.data[vIdx + 2];
            vCnt++;
          }
        }
      }

      if (oCnt > 0 && vCnt > 0) {
        const dist =
          (Math.abs(orSum / oCnt - vrSum / vCnt) +
            Math.abs(ogSum / oCnt - vgSum / vCnt) +
            Math.abs(obSum / oCnt - vbSum / vCnt)) /
          3;
        blockColorErrorSum += dist;
        activeBlocks++;
      }
    }
  }

  const avgBlockColorErr = activeBlocks > 0 ? blockColorErrorSum / activeBlocks : 0;
  const colorFidelityPct = Number(
    Math.max(0, Math.min(100, (1 - avgBlockColorErr / 255) * 100)).toFixed(2)
  );

  return {
    pixelSimilarityPct,
    psnrDb,
    contourFidelityPct,
    colorFidelityPct,
    meanAbsoluteError: Number(mae.toFixed(2)),
  };
}

export async function evaluateSvgVisualQuality(
  original: RawRgbaImage,
  svgMarkup: string,
  hasTransparency: boolean
): Promise<QualityComparisonReport | undefined> {
  const opaqueBg: [number, number, number] | undefined = !hasTransparency
    ? [original.data[0], original.data[1], original.data[2]]
    : undefined;

  const rendered = await rasterizeSvgAtExactSize(
    svgMarkup,
    original.width,
    original.height,
    opaqueBg
  );
  if (!rendered) return undefined;

  return computeQualityComparisonFromBuffers(original, rendered);
}
