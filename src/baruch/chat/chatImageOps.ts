import { VECTORIZER_PROFILES } from '../../constants/vectorizerConfig';
import { buildSvgExportArtifact, createSvgBlob } from '../../engine/export/svgExporter';
import { decodeImageBytesToRgba } from '../../engine/image-processing/imageCodec';
import type { VectorizationPipelineResult, VectorizationProgressEvent } from '../../engine/types';
import { executeVectorizationAsync } from '../../engine/worker/vectorizerClient';
import {
  mapVectorizeModeToProfile,
  type AspectRatioOption,
  type MockupCategoryOption,
  type OutputFormatOption,
  type QualityOption,
  type UpscaleFactorOption,
  type VectorizeModeOption,
} from './chatTypes';

export const MOCKUP_LABELS: Record<MockupCategoryOption, string> = {
  copos: 'Copos',
  camisetas: 'Camisetas',
  uniformes: 'Uniformes',
  banners: 'Banners',
  cartao_visitas: 'Cartão de visitas',
  impressoes: 'Impressões',
};

export const VECTORIZE_MODE_LABELS: Record<VectorizeModeOption, string> = {
  auto: 'Automático',
  high_fidelity: 'Alta fidelidade',
  logo: 'Logo',
  illustration: 'Ilustração',
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function triggerDownload(blobOrUrl: Blob | string, fileName: string): void {
  const isBlob = blobOrUrl instanceof Blob;
  const url = isBlob ? URL.createObjectURL(blobOrUrl) : blobOrUrl;
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (isBlob) {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

export function downloadVectorSvg(svgMarkup: string, baseFileName: string): void {
  const artifact = buildSvgExportArtifact(svgMarkup, baseFileName);
  const blob = createSvgBlob(artifact);
  triggerDownload(blob, artifact.fileName);
}

export async function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível carregar a imagem selecionada.'));
    img.src = src;
  });
}

/**
 * Executa o motor real de vetorização já existente em `src/engine/worker/vectorizerClient.ts`.
 */
export async function runRealVectorizationFromUrl(
  imageUrl: string,
  fileName: string,
  mode: VectorizeModeOption,
  onProgress?: (ev: VectorizationProgressEvent) => void
): Promise<VectorizationPipelineResult> {
  const img = await loadHtmlImage(imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || 512;
  canvas.height = img.naturalHeight || 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Contexto 2D indisponível para vetorização.');
  ctx.drawImage(img, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Falha ao preparar imagem para vetorização.'))),
      'image/png'
    );
  });

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const rgbaImage = await decodeImageBytesToRgba(
    bytes,
    fileName.endsWith('.png') ? fileName : `${fileName}.png`
  );
  const profileId = mapVectorizeModeToProfile(mode);
  const profile = VECTORIZER_PROFILES.find((p) => p.id === profileId) ?? VECTORIZER_PROFILES[0];

  return executeVectorizationAsync(
    rgbaImage,
    {
      profile: profile.id,
      ...profile.defaults,
      optimizeSvg: true,
    },
    { onProgress }
  );
}

export function getRatioDimensions(
  ratio: AspectRatioOption,
  quality: QualityOption
): { width: number; height: number } {
  const longEdge = quality === '4K' ? 1600 : 1080;
  const aspectMap: Record<AspectRatioOption, number> = {
    '1:1': 1,
    '3:4': 3 / 4,
    '4:3': 4 / 3,
    '9:16': 9 / 16,
    '16:9': 16 / 9,
    '3:2': 3 / 2,
    '2:3': 2 / 3,
    '4:5': 4 / 5,
    '21:9': 21 / 9,
    A4: 210 / 297,
  };
  const aspect = aspectMap[ratio] ?? 4 / 3;
  if (aspect >= 1) {
    return { width: longEdge, height: Math.round(longEdge / aspect) };
  }
  return { width: Math.round(longEdge * aspect), height: longEdge };
}

/**
 * Gera uma arte gráfica limpa sob demanda respeitando proporção e qualidade.
 */
export function generateConceptArtwork(
  prompt: string,
  companyName: string,
  ratio: AspectRatioOption,
  quality: QualityOption
): { dataUrl: string; width: number; height: number } {
  const { width, height } = getRatioDimensions(ratio, quality);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#071A34');
  bg.addColorStop(1, '#102D56');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(212, 166, 67, 0.35)';
  ctx.lineWidth = Math.max(2, Math.round(Math.min(width, height) * 0.004));
  const inset = Math.round(Math.min(width, height) * 0.075);
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);

  const cx = width / 2;
  const cy = height * 0.43;
  const r = Math.min(width, height) * 0.16;

  ctx.fillStyle = '#D4A643';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#071A34';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.64, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#F6F8FB';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.32, cy + r * 0.25);
  ctx.lineTo(cx, cy - r * 0.36);
  ctx.lineTo(cx + r * 0.32, cy + r * 0.25);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.font = `600 ${Math.round(Math.min(width, height) * 0.055)}px Inter, sans-serif`;
  ctx.fillText(companyName.toUpperCase(), cx, cy + r + Math.round(height * 0.11));

  ctx.fillStyle = '#E3C16F';
  ctx.font = `500 ${Math.round(Math.min(width, height) * 0.03)}px Inter, sans-serif`;
  const subtitle = (prompt.trim() || 'Arte personalizada BARUCH').slice(0, 52);
  ctx.fillText(subtitle, cx, cy + r + Math.round(height * 0.17));

  ctx.fillStyle = 'rgba(255,255,255,0.58)';
  ctx.font = `400 ${Math.round(Math.min(width, height) * 0.022)}px JetBrains Mono, monospace`;
  ctx.fillText(`${ratio} · ${quality} (${width} × ${height} px)`, cx, height - inset * 1.45);

  return { dataUrl: canvas.toDataURL('image/png'), width, height };
}

/**
 * Remove o fundo uniforme conectado às bordas da imagem com suavização.
 */
export async function removeBackgroundFromImage(
  imageUrl: string
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadHtmlImage(imageUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, (h * w - 1) * 4];
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  for (const idx of corners) {
    bgR += d[idx];
    bgG += d[idx + 1];
    bgB += d[idx + 2];
  }
  bgR /= 4;
  bgG /= 4;
  bgB /= 4;

  const threshold = 48;
  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  const pushIfBg = (x: number, y: number) => {
    const pos = y * w + x;
    if (visited[pos]) return;
    const p = pos * 4;
    const dist = Math.hypot(d[p] - bgR, d[p + 1] - bgG, d[p + 2] - bgB);
    if (dist <= threshold) {
      visited[pos] = 1;
      queue[tail++] = pos;
    }
  };

  for (let x = 0; x < w; x++) {
    pushIfBg(x, 0);
    pushIfBg(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    pushIfBg(0, y);
    pushIfBg(w - 1, y);
  }

  while (head < tail) {
    const pos = queue[head++];
    const p = pos * 4;
    const dist = Math.hypot(d[p] - bgR, d[p + 1] - bgG, d[p + 2] - bgB);
    d[p + 3] =
      dist < threshold * 0.65
        ? 0
        : Math.round(((dist - threshold * 0.65) / (threshold * 0.35)) * 255);

    const x = pos % w;
    const y = (pos - x) / w;
    if (x > 0) pushIfBg(x - 1, y);
    if (x < w - 1) pushIfBg(x + 1, y);
    if (y > 0) pushIfBg(x, y - 1);
    if (y < h - 1) pushIfBg(x, y + 1);
  }

  ctx.putImageData(imgData, 0, 0);
  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}

/**
 * Melhora nitidez e contraste da imagem.
 */
export async function enhanceImageQuality(
  imageUrl: string
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadHtmlImage(imageUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.filter = 'contrast(1.1) saturate(1.08) brightness(1.02)';
  ctx.drawImage(img, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}

/**
 * Amplia a resolução da imagem (2x ou 4x).
 */
export async function upscaleImageByFactor(
  imageUrl: string,
  factor: UpscaleFactorOption
): Promise<{ dataUrl: string; width: number; height: number; qualityLabel: string }> {
  const img = await loadHtmlImage(imageUrl);
  const mult = factor === '4x' ? 4 : 2;
  const maxEdge = 3840;
  const rawW = img.naturalWidth * mult;
  const rawH = img.naturalHeight * mult;
  const clampScale = Math.min(1, maxEdge / Math.max(rawW, rawH));
  const w = Math.max(img.naturalWidth, Math.round(rawW * clampScale));
  const h = Math.max(img.naturalHeight, Math.round(rawH * clampScale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = 'contrast(1.04)';
  ctx.drawImage(img, 0, 0, w, h);

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: w,
    height: h,
    qualityLabel: `${w} × ${h} px (${factor})`,
  };
}

/**
 * Redimensiona/enquadra a imagem para a proporção escolhida.
 */
export async function resizeImageToRatio(
  imageUrl: string,
  ratio: AspectRatioOption,
  quality: QualityOption
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadHtmlImage(imageUrl);
  const { width, height } = getRatioDimensions(ratio, quality);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);

  return { dataUrl: canvas.toDataURL('image/png'), width, height };
}

/**
 * Gera mockup limpo para o suporte selecionado (copos, camisetas, uniformes, banners, cartão de visitas, impressões).
 */
export async function generateTypedMockup(
  imageUrl: string,
  mockupType: MockupCategoryOption
): Promise<{ dataUrl: string; width: number; height: number }> {
  const art = await loadHtmlImage(imageUrl);
  const w = 1120;
  const h = 760;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#F6F8FB');
  bg.addColorStop(1, '#E8EEF5');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.shadowColor = 'rgba(7, 26, 52, 0.14)';
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 20;
  ctx.fillStyle = '#FFFFFF';

  const cardW = mockupType === 'banners' ? 420 : mockupType === 'cartao_visitas' ? 680 : 620;
  const cardH = mockupType === 'banners' ? 560 : mockupType === 'cartao_visitas' ? 390 : 460;
  const cardX = (w - cardW) / 2;
  const cardY = (h - cardH) / 2 - 22;

  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, mockupType === 'copos' ? 42 : 16);
  ctx.fill();
  ctx.restore();

  const pad = 42;
  const availW = cardW - pad * 2;
  const availH = cardH - pad * 2;
  const scale = Math.min(availW / art.naturalWidth, availH / art.naturalHeight);
  const drawW = art.naturalWidth * scale;
  const drawH = art.naturalHeight * scale;
  ctx.drawImage(art, cardX + (cardW - drawW) / 2, cardY + (cardH - drawH) / 2, drawW, drawH);

  ctx.fillStyle = '#071A34';
  ctx.font = '600 17px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Mockup · ${MOCKUP_LABELS[mockupType]}`, w / 2, h - 56);

  ctx.fillStyle = '#5A6B82';
  ctx.font = '400 13px JetBrains Mono, monospace';
  ctx.fillText('Prévia de aplicação BARUCH', w / 2, h - 32);

  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}

/**
 * Gera PDF 1.4 válido contendo a imagem.
 */
export async function buildPdfBlobFromImage(imageUrl: string): Promise<Blob> {
  const img = await loadHtmlImage(imageUrl);
  const w = img.naturalWidth || 1000;
  const h = img.naturalHeight || 700;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const jpegBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Falha ao codificar JPEG para PDF.'))),
      'image/jpeg',
      0.92
    );
  });
  const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());

  const pageW = 595;
  const pageH = Math.max(300, Math.round((h / w) * pageW));

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let bytePos = 0;

  const pushStr = (str: string) => {
    const b = encoder.encode(str);
    chunks.push(b);
    bytePos += b.length;
  };
  const pushBytes = (b: Uint8Array) => {
    chunks.push(b);
    bytePos += b.length;
  };

  pushStr('%PDF-1.4\n');
  offsets.push(bytePos);
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  offsets.push(bytePos);
  pushStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  offsets.push(bytePos);
  pushStr(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  );

  offsets.push(bytePos);
  pushStr(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
  );
  pushBytes(jpegBytes);
  pushStr('\nendstream\nendobj\n');

  const contentStream = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
  offsets.push(bytePos);
  pushStr(
    `5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`
  );

  const xrefPos = bytePos;
  pushStr(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let i = 1; i < offsets.length; i++) {
    pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);

  const merged = new Uint8Array(bytePos);
  let cursor = 0;
  for (const chunk of chunks) {
    merged.set(chunk, cursor);
    cursor += chunk.length;
  }

  return new Blob([merged], { type: 'application/pdf' });
}

/**
 * Salva/exporta a imagem no formato selecionado (PNG, PDF ou SVG).
 */
export async function saveMediaInFormat(
  imageUrl: string,
  fileName: string,
  format: OutputFormatOption,
  svgMarkup?: string
): Promise<void> {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '') || 'baruch-arte';

  if (format === 'SVG' && svgMarkup) {
    downloadVectorSvg(svgMarkup, base);
    return;
  }

  if (format === 'PDF') {
    const pdfBlob = await buildPdfBlobFromImage(imageUrl);
    triggerDownload(pdfBlob, `${base}.pdf`);
    return;
  }

  triggerDownload(imageUrl, `${base}.png`);
}
