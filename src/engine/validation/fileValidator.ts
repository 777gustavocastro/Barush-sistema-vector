import type { SvgValidationReport, SupportedRasterFormat } from '../types';

export interface RasterValidationResult {
  valid: boolean;
  detectedFormat: SupportedRasterFormat | null;
  byteLength: number;
  error?: string;
}

export interface SvgValidationOptions {
  /** Quando verdadeiro (exclusivo para Modo 1 — Fidelidade Visual Máxima), permite camada raster embutida devidamente identificada. */
  allowHybridRaster?: boolean;
}

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB limite seguro local

/**
 * Valida assinatura binária real (magic bytes) para PNG, JPG/JPEG e WebP.
 */
export function validateRasterBytes(
  bytes: Uint8Array,
  fileNameHint?: string
): RasterValidationResult {
  if (!bytes || bytes.byteLength < 12) {
    return {
      valid: false,
      detectedFormat: null,
      byteLength: bytes?.byteLength ?? 0,
      error: 'Arquivo vazio ou truncado.',
    };
  }

  if (bytes.byteLength > MAX_FILE_BYTES) {
    return {
      valid: false,
      detectedFormat: null,
      byteLength: bytes.byteLength,
      error: 'O arquivo excede o limite máximo permitido de 25 MB.',
    };
  }

  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;

  if (isPng) {
    return { valid: true, detectedFormat: 'png', byteLength: bytes.byteLength };
  }

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (isJpeg) {
    const ext = fileNameHint?.split('.').pop()?.toLowerCase();
    return {
      valid: true,
      detectedFormat: ext === 'jpeg' ? 'jpeg' : 'jpg',
      byteLength: bytes.byteLength,
    };
  }

  const isWebp =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;

  if (isWebp) {
    return { valid: true, detectedFormat: 'webp', byteLength: bytes.byteLength };
  }

  return {
    valid: false,
    detectedFormat: null,
    byteLength: bytes.byteLength,
    error: 'Assinatura de formato inválida. Utilize apenas imagens PNG, JPG, JPEG ou WebP reais.',
  };
}

function parseNumericAttr(raw: string | undefined): number | null {
  if (!raw) return null;
  const num = Number.parseFloat(raw);
  return Number.isFinite(num) ? num : null;
}

/**
 * Valida se o conteúdo gerado é um documento SVG íntegro.
 * - No Modo Vetor Editável (padrão, allowHybridRaster=false): rejeita estritamente qualquer imagem raster embutida (<image>).
 * - No Modo Fidelidade Visual Máxima (allowHybridRaster=true): aceita SVG híbrido contendo contornos vetoriais + camada raster identificada.
 */
export function validateSvgStructure(
  svgContent: string,
  options: SvgValidationOptions = {}
): SvgValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const trimmed = svgContent.trim();
  const byteLength = new TextEncoder().encode(svgContent).byteLength;

  if (!trimmed) {
    return {
      valid: false,
      errors: ['Conteúdo SVG vazio.'],
      warnings,
      width: null,
      height: null,
      viewBox: null,
      pathCount: 0,
      gradientCount: 0,
      totalVectorElements: 0,
      hasEmbeddedRaster: false,
      byteLength: 0,
    };
  }

  const svgOpenMatch = trimmed.match(/<svg\b([^>]*)>/i);
  if (!svgOpenMatch) {
    errors.push('Elemento raiz <svg> não encontrado.');
  }

  if (!/<\/svg>\s*$/i.test(trimmed)) {
    errors.push('Tag de fechamento </svg> ausente ou malformada.');
  }

  const rootAttrs = svgOpenMatch?.[1] ?? '';
  if (!/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(rootAttrs)) {
    warnings.push('Namespace XML padrão do SVG (xmlns) ausente na tag raiz.');
  }

  const widthMatch = rootAttrs.match(/\bwidth\s*=\s*["']([^"']+)["']/i);
  const heightMatch = rootAttrs.match(/\bheight\s*=\s*["']([^"']+)["']/i);
  const viewBoxMatch = rootAttrs.match(/\bviewBox\s*=\s*["']([^"']+)["']/i);

  const width = parseNumericAttr(widthMatch?.[1]);
  const height = parseNumericAttr(heightMatch?.[1]);
  const viewBox = viewBoxMatch?.[1]?.trim() ?? null;

  if (!viewBox && (width === null || height === null)) {
    warnings.push('O SVG não define viewBox nem par explícito de width/height.');
  }

  const pathMatches = [...trimmed.matchAll(/<path\b[^>]*\bd\s*=\s*["']([^"']*)["'][^>]*\/?>/gi)];
  const nonEmptyPaths = pathMatches.filter((m) => /[MLHVCSQTAZmlhvcsqtaz]/.test(m[1]));
  const pathCount = nonEmptyPaths.length;

  const gradientCount = [
    ...trimmed.matchAll(/<(linearGradient|radialGradient)\b[^>]*>/gi),
  ].length;

  const otherPrimitives = [
    ...trimmed.matchAll(/<(polygon|polyline|rect|circle|ellipse|line|text)\b[^>]*\/?>/gi),
  ].length;
  const totalVectorElements = pathCount + otherPrimitives;

  if (totalVectorElements === 0) {
    errors.push('Nenhum caminho (<path>) ou primitiva geométrica vetorial válida encontrada no SVG.');
  }

  const hasEmbeddedRaster =
    /<image\b[^>]*>/i.test(trimmed) || /data:image\/(png|jpeg|webp|bmp)/i.test(trimmed);

  if (hasEmbeddedRaster) {
    if (options.allowHybridRaster) {
      warnings.push(
        'SVG Híbrido (Fidelidade Visual Máxima): contém a imagem original rasterizada incorporada junto à estrutura vetorial.'
      );
    } else {
      errors.push(
        'O arquivo contém imagem raster embutida (<image>), sendo inválido para o Modo Vetor Editável.'
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    width,
    height,
    viewBox,
    pathCount,
    gradientCount,
    totalVectorElements,
    hasEmbeddedRaster,
    byteLength,
  };
}
