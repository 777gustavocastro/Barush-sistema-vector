import type { RawRgbaImage, SupportedRasterFormat } from '../types';
import { validateRasterBytes } from '../validation/fileValidator';

function isNodeRuntime(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    Boolean((globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node) &&
    typeof window === 'undefined'
  );
}

/**
 * Decodifica qualquer imagem suportada (PNG, JPG, JPEG, WebP) em buffer RGBA8 puro,
 * operando localmente tanto no Navegador (Canvas/ImageBitmap) quanto em Node.js (Sharp).
 */
export async function decodeImageBytesToRgba(
  bytes: Uint8Array,
  fileNameHint?: string
): Promise<RawRgbaImage> {
  const check = validateRasterBytes(bytes, fileNameHint);
  if (!check.valid || !check.detectedFormat) {
    throw new Error(check.error ?? 'Formato de imagem inválido.');
  }

  if (isNodeRuntime()) {
    const sharpPkg = 'sharp';
    const sharpModule = await import(/* @vite-ignore */ sharpPkg);
    const sharp = sharpModule.default;
    const { data, info } = await sharp(bytes)
      .rotate() // Respeita orientação EXIF automaticamente
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return {
      data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      width: info.width,
      height: info.height,
      sourceFormat: check.detectedFormat,
    };
  }

  // Ambiente Navegador / Web Worker
  const mimeMap: Record<SupportedRasterFormat, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  };
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeMap[check.detectedFormat] });

  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Contexto 2D OffscreenCanvas indisponível.');
      }
      ctx.drawImage(bitmap, 0, 0);
      const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      return {
        data: new Uint8Array(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength),
        width: bitmap.width,
        height: bitmap.height,
        sourceFormat: check.detectedFormat,
      };
    } finally {
      bitmap.close();
    }
  }

  // Fallback HTMLCanvasElement
  return await new Promise<RawRgbaImage>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Contexto 2D de Canvas indisponível.');
        }
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve({
          data: new Uint8Array(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength),
          width: canvas.width,
          height: canvas.height,
          sourceFormat: check.detectedFormat!,
        });
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Falha ao decodificar os pixels da imagem no navegador.'));
    };
    img.src = url;
  });
}

/**
 * Converte um buffer RGBA8 entre formatos raster suportados localmente (PNG, JPEG, WebP).
 */
export async function convertRgbaToFormatBytes(
  image: RawRgbaImage,
  targetFormat: SupportedRasterFormat,
  quality = 92
): Promise<Uint8Array> {
  if (isNodeRuntime()) {
    const sharpPkg = 'sharp';
    const sharpModule = await import(/* @vite-ignore */ sharpPkg);
    const sharp = sharpModule.default;
    const pipeline = sharp(image.data, {
      raw: { width: image.width, height: image.height, channels: 4 },
    });

    let outBuffer: Buffer;
    if (targetFormat === 'png') {
      outBuffer = await pipeline.png().toBuffer();
    } else if (targetFormat === 'webp') {
      outBuffer = await pipeline.webp({ quality }).toBuffer();
    } else {
      outBuffer = await pipeline
        .flatten({ background: '#ffffff' })
        .jpeg({ quality })
        .toBuffer();
    }

    return new Uint8Array(outBuffer.buffer, outBuffer.byteOffset, outBuffer.byteLength);
  }

  const mime =
    targetFormat === 'png'
      ? 'image/png'
      : targetFormat === 'webp'
        ? 'image/webp'
        : 'image/jpeg';

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2D indisponível.');
    const clamped = new Uint8ClampedArray(image.data);
    ctx.putImageData(new ImageData(clamped, image.width, image.height), 0, 0);
    const blob = await canvas.convertToBlob({ type: mime, quality: quality / 100 });
    return new Uint8Array(await blob.arrayBuffer());
  }

  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível.');
  const clamped = new Uint8ClampedArray(image.data);
  ctx.putImageData(new ImageData(clamped, image.width, image.height), 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Falha ao converter formato no Canvas.'))),
      mime,
      quality / 100
    );
  });
  return new Uint8Array(await blob.arrayBuffer());
}
