import type { RawRgbaImage } from '../types';
import { hexToRgb8 } from '../color/perceptualColor';

function isNodeRuntime(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    Boolean((globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node) &&
    typeof window === 'undefined'
  );
}

/**
 * Redução por integração exata de área (Supersampling -> Target) em espaço pré-multiplicado por alfa.
 * Evita escurecimento artificial em bordas translúcidas e elimina serrilhamento de 1×!
 */
export function downsamplePremultipliedBox(
  hiRes: RawRgbaImage,
  targetWidth: number,
  targetHeight: number,
  scale: number
): RawRgbaImage {
  if (scale <= 1 || (hiRes.width === targetWidth && hiRes.height === targetHeight)) {
    return hiRes;
  }

  const out = new Uint8Array(targetWidth * targetHeight * 4);
  const src = hiRes.data;
  const sw = hiRes.width;
  const sh = hiRes.height;
  const area = scale * scale;

  for (let ty = 0; ty < targetHeight; ty++) {
    const sy0 = ty * scale;
    for (let tx = 0; tx < targetWidth; tx++) {
      const sx0 = tx * scale;
      let sumPr = 0;
      let sumPg = 0;
      let sumPb = 0;
      let sumA = 0;

      for (let dy = 0; dy < scale; dy++) {
        const sy = Math.min(sh - 1, sy0 + dy);
        const rowBase = sy * sw;
        for (let dx = 0; dx < scale; dx++) {
          const sx = Math.min(sw - 1, sx0 + dx);
          const idx = (rowBase + sx) * 4;
          const a = src[idx + 3];
          sumA += a;
          sumPr += src[idx] * a;
          sumPg += src[idx + 1] * a;
          sumPb += src[idx + 2] * a;
        }
      }

      const oIdx = (ty * targetWidth + tx) * 4;
      if (sumA <= 0) {
        out[oIdx] = 0;
        out[oIdx + 1] = 0;
        out[oIdx + 2] = 0;
        out[oIdx + 3] = 0;
      } else {
        out[oIdx] = Math.max(0, Math.min(255, Math.round(sumPr / sumA)));
        out[oIdx + 1] = Math.max(0, Math.min(255, Math.round(sumPg / sumA)));
        out[oIdx + 2] = Math.max(0, Math.min(255, Math.round(sumPb / sumA)));
        out[oIdx + 3] = Math.max(0, Math.min(255, Math.round(sumA / area)));
      }
    }
  }

  return {
    width: targetWidth,
    height: targetHeight,
    data: out,
  };
}

/**
 * Converte e reduz um buffer que JÁ está em RGBA pré-multiplicado nativo (ex.: tiny-skia / @resvg/resvg-js)
 * diretamente para RGBA straight na resolução alvo, sem dupla multiplicação de alfa e sem halos escuros!
 */
export function downsampleNativePremultipliedBox(
  hiResPremul: RawRgbaImage,
  targetWidth: number,
  targetHeight: number,
  scale: number
): RawRgbaImage {
  const out = new Uint8Array(targetWidth * targetHeight * 4);
  const src = hiResPremul.data;
  const sw = hiResPremul.width;
  const sh = hiResPremul.height;

  if (scale <= 1 || (sw === targetWidth && sh === targetHeight)) {
    for (let i = 0; i < out.length; i += 4) {
      const a = src[i + 3];
      if (a === 0) continue;
      if (a === 255) {
        out[i] = src[i];
        out[i + 1] = src[i + 1];
        out[i + 2] = src[i + 2];
        out[i + 3] = 255;
      } else {
        out[i] = Math.min(255, Math.round((src[i] * 255) / a));
        out[i + 1] = Math.min(255, Math.round((src[i + 1] * 255) / a));
        out[i + 2] = Math.min(255, Math.round((src[i + 2] * 255) / a));
        out[i + 3] = a;
      }
    }
    return { width: targetWidth, height: targetHeight, data: out };
  }

  const area = scale * scale;
  for (let ty = 0; ty < targetHeight; ty++) {
    const sy0 = ty * scale;
    for (let tx = 0; tx < targetWidth; tx++) {
      const sx0 = tx * scale;
      let sumPr = 0;
      let sumPg = 0;
      let sumPb = 0;
      let sumA = 0;

      for (let dy = 0; dy < scale; dy++) {
        const sy = Math.min(sh - 1, sy0 + dy);
        const rowBase = sy * sw;
        for (let dx = 0; dx < scale; dx++) {
          const sx = Math.min(sw - 1, sx0 + dx);
          const idx = (rowBase + sx) * 4;
          sumPr += src[idx];
          sumPg += src[idx + 1];
          sumPb += src[idx + 2];
          sumA += src[idx + 3];
        }
      }

      const oIdx = (ty * targetWidth + tx) * 4;
      if (sumA > 0) {
        out[oIdx] = Math.max(0, Math.min(255, Math.round((sumPr * 255) / sumA)));
        out[oIdx + 1] = Math.max(0, Math.min(255, Math.round((sumPg * 255) / sumA)));
        out[oIdx + 2] = Math.max(0, Math.min(255, Math.round((sumPb * 255) / sumA)));
        out[oIdx + 3] = Math.max(0, Math.min(255, Math.round(sumA / area)));
      }
    }
  }

  return { width: targetWidth, height: targetHeight, data: out };
}

interface ParsedStop {
  offset: number;
  rgba: string;
}

interface ParsedLinearGrad {
  kind: 'linear';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: ParsedStop[];
}

interface ParsedRadialGrad {
  kind: 'radial';
  cx: number;
  cy: number;
  r: number;
  fx: number;
  fy: number;
  matrix: [number, number, number, number, number, number] | null;
  stops: ParsedStop[];
}

interface ParsedClipPath {
  d: string;
  evenOdd: boolean;
}

function parseAttr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}="([^"]*)"`, 'i');
  const m = tag.match(re);
  return m ? m[1] : null;
}

function parseStops(innerXml: string): ParsedStop[] {
  const stops: ParsedStop[] = [];
  const stopRe = /<stop\b[^>]*\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = stopRe.exec(innerXml)) !== null) {
    const tag = m[0];
    const offRaw = parseAttr(tag, 'offset') ?? '0%';
    const offVal = offRaw.endsWith('%') ? parseFloat(offRaw) / 100 : parseFloat(offRaw);
    const offset = Math.max(0, Math.min(1, Number.isFinite(offVal) ? offVal : 0));
    const colorStr = parseAttr(tag, 'stop-color') ?? '#000000';
    const opStr = parseAttr(tag, 'stop-opacity');
    const op = opStr !== null ? Math.max(0, Math.min(1, parseFloat(opStr))) : 1;
    const [r, g, b] = colorStr.startsWith('#') ? hexToRgb8(colorStr) : [0, 0, 0];
    stops.push({
      offset,
      rgba: `rgba(${r},${g},${b},${op})`,
    });
  }
  return stops;
}

/**
 * Renderizador Vetorial Supersampling para Web Worker (`OffscreenCanvas` + `Path2D`):
 * Permite que o Ciclo Iterativo da Etapa 2 renderize e valide SVGs com precisão sub-pixel
 * diretamente dentro do Web Worker do navegador (onde `window` e `Image` não existem)!
 */
function rasterizeSvgInWorkerOffscreenCanvas(
  svgMarkup: string,
  renderWidth: number,
  renderHeight: number,
  opaqueBackgroundRgb?: [number, number, number]
): RawRgbaImage | null {
  if (typeof OffscreenCanvas === 'undefined' || typeof Path2D === 'undefined') {
    return null;
  }

  try {
    const canvas = new OffscreenCanvas(renderWidth, renderHeight);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    let vbX = 0;
    let vbY = 0;
    let vbW = renderWidth;
    let vbH = renderHeight;
    const vbMatch = svgMarkup.match(/\bviewBox="([^"]+)"/i);
    if (vbMatch) {
      const nums = vbMatch[1]
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (nums.length === 4 && nums.every(Number.isFinite) && nums[2] > 0 && nums[3] > 0) {
        [vbX, vbY, vbW, vbH] = nums;
      }
    }

    if (opaqueBackgroundRgb) {
      ctx.fillStyle = `rgb(${opaqueBackgroundRgb[0]},${opaqueBackgroundRgb[1]},${opaqueBackgroundRgb[2]})`;
      ctx.fillRect(0, 0, renderWidth, renderHeight);
    }

    ctx.save();
    ctx.scale(renderWidth / vbW, renderHeight / vbH);
    if (vbX !== 0 || vbY !== 0) {
      ctx.translate(-vbX, -vbY);
    }

    const gradients = new Map<string, ParsedLinearGrad | ParsedRadialGrad>();
    const clips = new Map<string, ParsedClipPath>();

    const linRe = /<linearGradient\b([^>]*)>([\s\S]*?)<\/linearGradient>/gi;
    let lm: RegExpExecArray | null;
    while ((lm = linRe.exec(svgMarkup)) !== null) {
      const attrs = lm[1];
      const id = parseAttr(attrs, 'id');
      if (!id) continue;
      gradients.set(id, {
        kind: 'linear',
        x1: parseFloat(parseAttr(attrs, 'x1') ?? '0') || 0,
        y1: parseFloat(parseAttr(attrs, 'y1') ?? '0') || 0,
        x2: parseFloat(parseAttr(attrs, 'x2') ?? String(vbW)) || vbW,
        y2: parseFloat(parseAttr(attrs, 'y2') ?? '0') || 0,
        stops: parseStops(lm[2]),
      });
    }

    const radRe = /<radialGradient\b([^>]*)>([\s\S]*?)<\/radialGradient>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = radRe.exec(svgMarkup)) !== null) {
      const attrs = rm[1];
      const id = parseAttr(attrs, 'id');
      if (!id) continue;
      const cx = parseFloat(parseAttr(attrs, 'cx') ?? '0') || 0;
      const cy = parseFloat(parseAttr(attrs, 'cy') ?? '0') || 0;
      const r = Math.max(0.1, parseFloat(parseAttr(attrs, 'r') ?? '1') || 1);
      const fx = parseFloat(parseAttr(attrs, 'fx') ?? String(cx));
      const fy = parseFloat(parseAttr(attrs, 'fy') ?? String(cy));
      const gt = parseAttr(attrs, 'gradientTransform');
      let matrix: [number, number, number, number, number, number] | null = null;
      if (gt) {
        const mm = gt.match(/matrix\(([^)]+)\)/i);
        if (mm) {
          const vals = mm[1]
            .trim()
            .split(/[\s,]+/)
            .map(Number);
          if (vals.length === 6 && vals.every(Number.isFinite)) {
            matrix = [vals[0], vals[1], vals[2], vals[3], vals[4], vals[5]];
          }
        }
      }
      gradients.set(id, {
        kind: 'radial',
        cx,
        cy,
        r,
        fx: Number.isFinite(fx) ? fx : cx,
        fy: Number.isFinite(fy) ? fy : cy,
        matrix,
        stops: parseStops(rm[2]),
      });
    }

    const clipRe = /<clipPath\b([^>]*)>([\s\S]*?)<\/clipPath>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = clipRe.exec(svgMarkup)) !== null) {
      const id = parseAttr(cm[1], 'id');
      const pMatch = cm[2].match(/<path\b([^>]*)\/?>/i);
      if (id && pMatch) {
        const d = parseAttr(pMatch[1], 'd');
        const rule = parseAttr(pMatch[1], 'clip-rule') ?? parseAttr(pMatch[1], 'fill-rule');
        if (d) {
          clips.set(id, { d, evenOdd: rule === 'evenodd' });
        }
      }
    }

    // Remove <defs>...</defs> para percorrer apenas os elementos pintáveis na ordem Z exata
    const bodyXml = svgMarkup.replace(/<defs\b[^>]*>[\s\S]*?<\/defs>/gi, '');
    const tokenRe = /<(\/?)(g|path)\b([^>]*?)(\/?)>/gi;
    const groupStateStack: boolean[] = [];

    let tm: RegExpExecArray | null;
    while ((tm = tokenRe.exec(bodyXml)) !== null) {
      const isClose = tm[1] === '/';
      const tagName = tm[2].toLowerCase();
      const attrs = tm[3];
      const selfClose = tm[4] === '/';

      if (tagName === 'g') {
        if (isClose) {
          if (groupStateStack.pop()) {
            ctx.restore();
          }
        } else if (!selfClose) {
          const cpAttr = parseAttr(attrs, 'clip-path');
          const opAttr = parseAttr(attrs, 'opacity');
          let pushed = false;
          if (cpAttr || opAttr) {
            ctx.save();
            pushed = true;
            if (opAttr) {
              const op = parseFloat(opAttr);
              if (Number.isFinite(op)) ctx.globalAlpha *= Math.max(0, Math.min(1, op));
            }
            if (cpAttr) {
              const cid = cpAttr.match(/url\(#([^)]+)\)/)?.[1];
              const clipDef = cid ? clips.get(cid) : undefined;
              if (clipDef) {
                const cp2d = new Path2D(clipDef.d);
                ctx.clip(cp2d, clipDef.evenOdd ? 'evenodd' : 'nonzero');
              }
            }
          }
          groupStateStack.push(pushed);
        }
        continue;
      }

      if (tagName === 'path' && !isClose) {
        const d = parseAttr(attrs, 'd');
        if (!d) continue;
        const fill = parseAttr(attrs, 'fill') ?? '#000000';
        const stroke = parseAttr(attrs, 'stroke') ?? 'none';
        const hasFill = fill.toLowerCase() !== 'none';
        const hasStroke = stroke.toLowerCase() !== 'none';
        if (!hasFill && !hasStroke) continue;

        const baseOpacityRaw = parseAttr(attrs, 'opacity');
        const baseOpacity =
          baseOpacityRaw !== null
            ? Math.max(0, Math.min(1, parseFloat(baseOpacityRaw)))
            : 1;
        const fillOpacityRaw = parseAttr(attrs, 'fill-opacity');
        const fillOpacity =
          fillOpacityRaw !== null
            ? Math.max(0, Math.min(1, parseFloat(fillOpacityRaw)))
            : 1;
        const fillRule: CanvasFillRule =
          parseAttr(attrs, 'fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero';

        const path2d = new Path2D(d);
        ctx.save();
        if (baseOpacity < 0.999) {
          ctx.globalAlpha *= baseOpacity;
        }

        if (hasFill) {
          ctx.save();
          if (fillOpacity < 0.999) {
            ctx.globalAlpha *= fillOpacity;
          }

          const urlId = fill.match(/^url\(#([^)]+)\)$/)?.[1];
          if (urlId) {
            const gDef = gradients.get(urlId);
            if (gDef && gDef.kind === 'linear') {
              const grad = ctx.createLinearGradient(gDef.x1, gDef.y1, gDef.x2, gDef.y2);
              for (const st of gDef.stops) grad.addColorStop(st.offset, st.rgba);
              ctx.fillStyle = grad;
              ctx.fill(path2d, fillRule);
            } else if (gDef && gDef.kind === 'radial') {
              if (gDef.matrix) {
                ctx.clip(path2d, fillRule);
                const [ma, mb, mc, md, me, mf] = gDef.matrix;
                ctx.transform(ma, mb, mc, md, me, mf);
                const grad = ctx.createRadialGradient(
                  gDef.fx,
                  gDef.fy,
                  0,
                  gDef.cx,
                  gDef.cy,
                  gDef.r
                );
                for (const st of gDef.stops) grad.addColorStop(st.offset, st.rgba);
                ctx.fillStyle = grad;
                const padR = gDef.r * 3 + 2048;
                ctx.fillRect(gDef.cx - padR, gDef.cy - padR, padR * 2, padR * 2);
              } else {
                const grad = ctx.createRadialGradient(
                  gDef.fx,
                  gDef.fy,
                  0,
                  gDef.cx,
                  gDef.cy,
                  gDef.r
                );
                for (const st of gDef.stops) grad.addColorStop(st.offset, st.rgba);
                ctx.fillStyle = grad;
                ctx.fill(path2d, fillRule);
              }
            }
          } else {
            ctx.fillStyle = fill;
            ctx.fill(path2d, fillRule);
          }
          ctx.restore();
        }

        if (hasStroke) {
          const sw = parseFloat(parseAttr(attrs, 'stroke-width') ?? '1');
          if (Number.isFinite(sw) && sw > 0) {
            ctx.save();
            const strokeOpRaw = parseAttr(attrs, 'stroke-opacity');
            if (strokeOpRaw !== null) {
              const sOp = Math.max(0, Math.min(1, parseFloat(strokeOpRaw)));
              if (sOp < 0.999) ctx.globalAlpha *= sOp;
            }
            ctx.strokeStyle = stroke;
            ctx.lineWidth = sw;
            const lc = parseAttr(attrs, 'stroke-linecap');
            if (lc === 'round' || lc === 'square' || lc === 'butt') ctx.lineCap = lc;
            const lj = parseAttr(attrs, 'stroke-linejoin');
            if (lj === 'round' || lj === 'bevel' || lj === 'miter') ctx.lineJoin = lj;
            const ml = parseFloat(parseAttr(attrs, 'stroke-miterlimit') ?? '4');
            if (Number.isFinite(ml) && ml > 0) ctx.miterLimit = ml;
            const dashRaw = parseAttr(attrs, 'stroke-dasharray');
            if (dashRaw && dashRaw !== 'none') {
              const dNums = dashRaw.trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
              if (dNums.length > 0) ctx.setLineDash(dNums);
            }
            const dashOff = parseFloat(parseAttr(attrs, 'stroke-dashoffset') ?? '0');
            if (Number.isFinite(dashOff) && dashOff !== 0) ctx.lineDashOffset = dashOff;
            ctx.stroke(path2d);
            ctx.restore();
          }
        }

        ctx.restore();
      }
    }

    ctx.restore();
    const imgData = ctx.getImageData(0, 0, renderWidth, renderHeight);
    return {
      width: renderWidth,
      height: renderHeight,
      data: new Uint8Array(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength),
    };
  } catch {
    return null;
  }
}

/**
 * Renderiza o SVG com Supersampling real (`2×` ou `3×`) e integração de área pré-multiplicada
 * para inspeção de contornos, cores CIEDE2000 e ciclo de auto-reparo da Etapa 2.
 */
export async function renderSvgSupersampled(
  svgMarkup: string,
  targetWidth: number,
  targetHeight: number,
  options?: {
    opaqueBackgroundRgb?: [number, number, number];
    supersampleScale?: 1 | 2 | 3;
  }
): Promise<RawRgbaImage | null> {
  const maxDim = Math.max(targetWidth, targetHeight);
  const scale: 1 | 2 | 3 =
    options?.supersampleScale ?? (maxDim <= 420 ? 2 : maxDim <= 1100 ? 2 : 1);

  const rw = targetWidth * scale;
  const rh = targetHeight * scale;
  const bgRgb = options?.opaqueBackgroundRgb;

  if (isNodeRuntime()) {
    try {
      const resvgPkg = '@resvg/resvg-js';
      const { Resvg } = await import(/* @vite-ignore */ resvgPkg);
      const bgStr = bgRgb ? `rgb(${bgRgb[0]}, ${bgRgb[1]}, ${bgRgb[2]})` : undefined;
      const resvg = new Resvg(svgMarkup, {
        fitTo: { mode: 'width', value: rw },
        ...(bgStr ? { background: bgStr } : {}),
      });
      const rendered = resvg.render();
      const hiResPremul: RawRgbaImage = {
        width: rendered.width,
        height: rendered.height,
        data: new Uint8Array(
          rendered.pixels.buffer,
          rendered.pixels.byteOffset,
          rendered.pixels.byteLength
        ),
      };
      return downsampleNativePremultipliedBox(hiResPremul, targetWidth, targetHeight, scale);
    } catch {
      return null;
    }
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    try {
      const hiRes = await new Promise<RawRgbaImage>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = rw;
          canvas.height = rh;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Contexto 2D indisponível'));
            return;
          }
          if (bgRgb) {
            ctx.fillStyle = `rgb(${bgRgb[0]}, ${bgRgb[1]}, ${bgRgb[2]})`;
            ctx.fillRect(0, 0, rw, rh);
          }
          ctx.drawImage(img, 0, 0, rw, rh);
          const imgData = ctx.getImageData(0, 0, rw, rh);
          resolve({
            width: rw,
            height: rh,
            data: new Uint8Array(imgData.data.buffer),
          });
        };
        img.onerror = () => reject(new Error('Falha ao renderizar SVG supersampled'));
        img.src = url;
      });
      return downsamplePremultipliedBox(hiRes, targetWidth, targetHeight, scale);
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Fallback nativo dentro de Web Worker via OffscreenCanvas + Path2D supersampled!
  const workerHiRes = rasterizeSvgInWorkerOffscreenCanvas(svgMarkup, rw, rh, bgRgb);
  if (workerHiRes) {
    return downsamplePremultipliedBox(workerHiRes, targetWidth, targetHeight, scale);
  }

  return null;
}
