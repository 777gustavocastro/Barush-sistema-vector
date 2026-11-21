export interface ExportedSvgArtifact {
  fileName: string;
  mimeType: 'image/svg+xml;charset=utf-8';
  svgText: string;
  utf8Bytes: Uint8Array;
  byteLength: number;
}

/**
 * Normaliza nome de arquivo e empacota o conteúdo SVG validado para exportação/download local.
 */
export function buildSvgExportArtifact(
  svgContent: string,
  originalFileName = 'vetorizado.png'
): ExportedSvgArtifact {
  const baseName = originalFileName
    .replace(/\.(png|jpg|jpeg|webp|svg)$/i, '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-');

  const safeFileName = `${baseName || 'vetorizado'}.svg`;
  let normalizedSvg = svgContent.trim();

  if (!normalizedSvg.startsWith('<?xml')) {
    normalizedSvg = `<?xml version="1.0" encoding="UTF-8"?>\n${normalizedSvg}`;
  }

  const utf8Bytes = new TextEncoder().encode(normalizedSvg);

  return {
    fileName: safeFileName,
    mimeType: 'image/svg+xml;charset=utf-8',
    svgText: normalizedSvg,
    utf8Bytes,
    byteLength: utf8Bytes.byteLength,
  };
}

export function createSvgBlob(artifact: ExportedSvgArtifact): Blob {
  return new Blob([artifact.svgText], { type: artifact.mimeType });
}
