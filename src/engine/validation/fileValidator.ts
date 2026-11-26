import type { SvgValidationReport, SupportedRasterFormat } from '../types';

export interface RasterValidationResult {
  valid: boolean;
  detectedFormat: SupportedRasterFormat | null;
  byteLength: number;
  error?: string;
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
 * Validação rigorosa de vetorização real (Seção 9 e Seção 11):
 * PROIBIÇÃO ABSOLUTA de elementos <image>, <feImage>, PNG/JPEG/WebP incorporados,
 * data:image/*, Base64 raster ou qualquer camada rasterizada oculta/sobreposta.
 * Contabiliza objetos (<g id="objeto-...">), grupos (<g>), caminhos (<path>),
 * gradientes (<linearGradient> / <radialGradient>) e dimensões do SVG.
 */
export function validateSvgStructure(svgContent: string): SvgValidationReport {
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
      objectCount: 0,
      groupCount: 0,
      pathCount: 0,
      gradientCount: 0,
      linearGradientCount: 0,
      radialGradientCount: 0,
      clipPathCount: 0,
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
    errors.push('O SVG deve definir viewBox e dimensões válidas.');
  }

  // Contagem de grupos e objetos independentes (<g id="objeto-...">)
  const groupMatches = [...trimmed.matchAll(/<g\b([^>]*)>/gi)];
  const groupCount = groupMatches.length;
  const explicitObjects = groupMatches.filter((m) =>
    /\bid\s*=\s*["']objeto-[^"']+["']/i.test(m[1])
  ).length;

  const pathMatches = [...trimmed.matchAll(/<path\b[^>]*\bd\s*=\s*["']([^"']*)["'][^>]*\/?>/gi)];
  const nonEmptyPaths = pathMatches.filter((m) => /[MLHVCSQTAZmlhvcsqtaz]/.test(m[1]));
  const pathCount = nonEmptyPaths.length;

  if (pathMatches.length > nonEmptyPaths.length) {
    warnings.push('Foram ignorados elementos <path> com atributo d vazio.');
  }

  const linearGradientCount = [...trimmed.matchAll(/<linearGradient\b[^>]*>/gi)].length;
  const radialGradientCount = [...trimmed.matchAll(/<radialGradient\b[^>]*>/gi)].length;
  const gradientCount = linearGradientCount + radialGradientCount;
  const clipPathCount = [...trimmed.matchAll(/<clipPath\b[^>]*>/gi)].length;

  const otherPrimitives = [
    ...trimmed.matchAll(/<(polygon|polyline|rect|circle|ellipse|line)\b[^>]*\/?>/gi),
  ].length;
  const totalVectorElements = pathCount + otherPrimitives;
  const objectCount = explicitObjects > 0 ? explicitObjects : Math.max(groupCount, pathCount > 0 ? 1 : 0);

  if (totalVectorElements === 0) {
    errors.push('Nenhum caminho (<path>) ou primitiva geométrica vetorial editável encontrada no SVG.');
  }

  // Verificação estrita anti-raster (Proibições Absolutas — Seção 9)
  const hasImageTag = /<(?:svg:)?image\b[^>]*>/i.test(trimmed) || /<feImage\b[^>]*>/i.test(trimmed);
  const hasDataUriRaster = /data:image\/(?:png|jpe?g|webp|bmp|gif|tiff|avif)/i.test(trimmed);
  const hasBase64Payload = /;base64,[A-Za-z0-9+/=]{16,}/i.test(trimmed);
  const hasExternalRasterHref =
    /\b(?:xlink:)?href\s*=\s*["'][^#"']+\.(?:png|jpe?g|webp|bmp|gif)(?:\?[^"']*)?["']/i.test(trimmed);

  const hasEmbeddedRaster =
    hasImageTag || hasDataUriRaster || hasBase64Payload || hasExternalRasterHref;

  if (hasImageTag) {
    errors.push('PROIBIDO: Elemento raster <image> ou <feImage> detectado no SVG.');
  }
  if (hasDataUriRaster || hasBase64Payload) {
    errors.push('PROIBIDO: Dados de imagem rasterizada (Data URI / Base64) detectados no SVG.');
  }
  if (hasExternalRasterHref) {
    errors.push('PROIBIDO: Referência externa a imagem rasterizada detectada no SVG.');
  }

  // Regra estrita da Seção 6: proíbe vector-effect="non-scaling-stroke" nos contornos da arte exportada
  if (/\bvector-effect\s*=\s*["']non-scaling-stroke["']/i.test(trimmed)) {
    errors.push(
      'PROIBIDO: Atributo vector-effect="non-scaling-stroke" detectado nos contornos do SVG exportado.'
    );
  }

  // Verifica se todos os url(#id) de gradientes referenciados em fill existem em <defs>
  const referencedGradIds = [...trimmed.matchAll(/\bfill\s*=\s*["']url\(#([^)"']+)["']\)/gi)].map(
    (m) => m[1]
  );
  for (const refId of referencedGradIds) {
    const escaped = refId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`<(?:linearGradient|radialGradient)\\b[^>]*\\bid=["']${escaped}["']`, 'i').test(trimmed)) {
      errors.push(`Gradiente referenciado #${refId} não está definido no SVG.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    width,
    height,
    viewBox,
    objectCount,
    groupCount,
    pathCount,
    gradientCount,
    linearGradientCount,
    radialGradientCount,
    clipPathCount,
    totalVectorElements,
    hasEmbeddedRaster,
    byteLength,
  };
}
