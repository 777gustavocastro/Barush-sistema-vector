import type { RawRgbaImage } from '../types';

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function isNodeRuntime(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    Boolean((globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node) &&
    typeof window === 'undefined' &&
    typeof OffscreenCanvas === 'undefined'
  );
}

/**
 * Codifica RawRgbaImage sem perdas em Data URL PNG (isomórfico: sharp em Node.js, OffscreenCanvas / Canvas no Navegador/Worker).
 */
export async function encodeRgbaToLosslessPngDataUrl(image: RawRgbaImage): Promise<string> {
  if (isNodeRuntime()) {
    const sharpPkg = 'sharp';
    const sharpMod = await import(/* @vite-ignore */ sharpPkg);
    const sharpFn = sharpMod.default ?? sharpMod;
    const pngBuf: Buffer = await sharpFn(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
      raw: { width: image.width, height: image.height, channels: 4 },
    })
      .png({ compressionLevel: 6 })
      .toBuffer();
    return `data:image/png;base64,${bytesToBase64(new Uint8Array(pngBuf.buffer, pngBuf.byteOffset, pngBuf.byteLength))}`;
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const clamped = new Uint8ClampedArray(image.data.length);
      clamped.set(image.data);
      ctx.putImageData(new ImageData(clamped, image.width, image.height), 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const ab = await blob.arrayBuffer();
      return `data:image/png;base64,${bytesToBase64(new Uint8Array(ab))}`;
    }
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const clamped = new Uint8ClampedArray(image.data.length);
      clamped.set(image.data);
      ctx.putImageData(new ImageData(clamped, image.width, image.height), 0, 0);
      return canvas.toDataURL('image/png');
    }
  }

  throw new Error('Codificador PNG indisponível neste ambiente.');
}

/**
 * Constrói o SVG Híbrido para o MODO 1 — FIDELIDADE VISUAL MÁXIMA:
 * Mantém a estrutura vetorial real (<g id="camada-vetorial-base">) e incorpora de forma
 * explicitamente identificada a imagem original sem perdas (<g id="camada-raster-original" data-raster-embedded="true">),
 * garantindo 100% de fidelidade visual sem jamais confundir com o Modo 2 (Vetor Editável).
 */
export async function buildHybridMaxFidelitySvg(
  pureVectorSvg: string,
  sourceImage: RawRgbaImage,
  viewBoxWidth: number,
  viewBoxHeight: number
): Promise<string> {
  const pngDataUrl = await encodeRgbaToLosslessPngDataUrl(sourceImage);

  const innerMatch = pureVectorSvg.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
  if (!innerMatch) {
    throw new Error('SVG vetorial base inválido ao montar o SVG híbrido.');
  }

  let rootAttrs = innerMatch[1];
  if (!/\bxmlns:xlink\s*=/i.test(rootAttrs)) {
    rootAttrs += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
  }

  const vectorBody = innerMatch[2].trim();

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n` +
    `<svg${rootAttrs} data-output-mode="max_visual_fidelity_hybrid">` +
    `<desc>MODO 1 — FIDELIDADE VISUAL MÁXIMA (SVG HÍBRIDO): Contém caminhos vetoriais estruturais e a imagem original rasterizada incorporada para preservação visual absoluta.</desc>` +
    `<g id="camada-vetorial-estrutural">${vectorBody}</g>` +
    `<g id="camada-raster-original" data-raster-embedded="true">` +
    `<image id="imagem-original-incorporada" x="0" y="0" width="${viewBoxWidth}" height="${viewBoxHeight}" preserveAspectRatio="none" href="${pngDataUrl}"/>` +
    `</g>` +
    `</svg>`
  );
}
