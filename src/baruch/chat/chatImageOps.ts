import { VECTORIZER_PROFILES } from '../../constants/vectorizerConfig';
import { buildSvgExportArtifact, createSvgBlob } from '../../engine/export/svgExporter';
import { decodeImageBytesToRgba } from '../../engine/image-processing/imageCodec';
import type { VectorizationPipelineResult, VectorizationProgressEvent } from '../../engine/types';
import { executeVectorizationAsync } from '../../engine/worker/vectorizerClient';
import type { VectorizerProfileId } from '../../types/vectorizer';
import type { ProductRecord } from '../types';
import type { AspectRatioOption, OutputFormatOption, ResolutionPreset } from './chatTypes';

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

/**
 * Converte qualquer URL/dataURL de imagem em bytes PNG e executa o motor real de vetorização
 * existente em `src/engine/worker/vectorizerClient.ts` sem duplicar nenhuma lógica.
 */
export async function runRealVectorizationFromUrl(
  imageUrl: string,
  fileName: string,
  profileId: VectorizerProfileId,
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
  const rgbaImage = await decodeImageBytesToRgba(bytes, fileName.endsWith('.png') ? fileName : `${fileName}.png`);
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

export async function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível carregar a imagem selecionada.'));
    img.src = src;
  });
}

function getRatioDimensions(
  ratio: AspectRatioOption,
  product: ProductRecord | null,
  resolution: ResolutionPreset
): { width: number; height: number } {
  const longEdge = resolution === '4K' ? 2048 : resolution === 'HD' ? 1440 : 1024;

  let aspect = 4 / 3;
  if (ratio === 'product' && product) {
    const nums = product.dimensions.match(/\d+/g)?.map(Number);
    if (nums && nums.length >= 2 && nums[0] > 0 && nums[1] > 0) {
      aspect = Math.max(0.55, Math.min(2.2, nums[0] / nums[1]));
    }
  } else if (ratio === '1:1') {
    aspect = 1;
  } else if (ratio === '4:3') {
    aspect = 4 / 3;
  } else if (ratio === '16:9') {
    aspect = 16 / 9;
  } else if (ratio === '9:16') {
    aspect = 9 / 16;
  } else if (ratio === '3:2') {
    aspect = 3 / 2;
  } else if (ratio === 'A4') {
    aspect = 210 / 297;
  }

  if (aspect >= 1) {
    return { width: longEdge, height: Math.round(longEdge / aspect) };
  }
  return { width: Math.round(longEdge * aspect), height: longEdge };
}

/**
 * Gera uma arte gráfica limpa sob demanda no canvas respeitando produto, proporção e resolução.
 */
export function generateConceptArtwork(
  prompt: string,
  clientName: string,
  product: ProductRecord | null,
  ratio: AspectRatioOption,
  resolution: ResolutionPreset
): { dataUrl: string; width: number; height: number } {
  const { width, height } = getRatioDimensions(ratio, product, resolution);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Fundo institucional limpo (azul-marinho profundo + geometria minimalista dourada)
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#071A34');
  bg.addColorStop(1, '#102D56');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Detalhe geométrico sutil
  ctx.strokeStyle = 'rgba(212, 166, 67, 0.35)';
  ctx.lineWidth = Math.max(2, Math.round(width * 0.004));
  const inset = Math.round(Math.min(width, height) * 0.07);
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);

  // Emblema geométrico central (bom para testar vetorização real!)
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

  // Tipografia do cliente e especificação
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.font = `600 ${Math.round(Math.min(width, height) * 0.055)}px Inter, sans-serif`;
  ctx.fillText(clientName.toUpperCase(), cx, cy + r + Math.round(height * 0.11));

  ctx.fillStyle = '#E3C16F';
  ctx.font = `500 ${Math.round(Math.min(width, height) * 0.028)}px Inter, sans-serif`;
  const subtitle = (prompt.trim() || product?.name || 'Arte personalizada BARUCH').slice(0, 56);
  ctx.fillText(subtitle, cx, cy + r + Math.round(height * 0.17));

  if (product) {
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.font = `400 ${Math.round(Math.min(width, height) * 0.022)}px JetBrains Mono, monospace`;
    ctx.fillText(
      `${product.dimensions} · Área útil ${product.printArea}`,
      cx,
      height - inset * 1.45
    );
  }

  return { dataUrl: canvas.toDataURL('image/png'), width, height };
}

/**
 * Remove o fundo uniforme conectado às bordas da imagem (chroma/edge flood fill real).
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

  // Amostra cor média dos 4 cantos
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
    d[p + 3] = dist < threshold * 0.65 ? 0 : Math.round(((dist - threshold * 0.65) / (threshold * 0.35)) * 255);

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
 * Aplica melhoria de nitidez/contraste ou ajuste cromático balanceado no canvas.
 */
export async function processImageFilter(
  imageUrl: string,
  mode: 'enhance' | 'adjust'
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadHtmlImage(imageUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.filter =
    mode === 'enhance'
      ? 'contrast(1.1) saturate(1.08) brightness(1.02)'
      : 'brightness(1.05) contrast(1.05) saturate(1.12)';
  ctx.drawImage(img, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}

/**
 * Realiza upscale de resolução (2×, HD ou 4K).
 */
export async function upscaleImage(
  imageUrl: string,
  preset: ResolutionPreset
): Promise<{ dataUrl: string; width: number; height: number; resolutionLabel: string }> {
  const img = await loadHtmlImage(imageUrl);
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const targetLong = preset === '4K' ? 3840 : preset === 'HD' ? 1920 : Math.min(2560, Math.max(srcW, srcH) * 2);
  const scale = targetLong / Math.max(1, Math.max(srcW, srcH));
  const w = Math.max(srcW, Math.round(srcW * scale));
  const h = Math.max(srcH, Math.round(srcH * scale));

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
    resolutionLabel: `${w} × ${h} px (${preset === 'standard' ? '2×' : preset})`,
  };
}

/**
 * Gera um mockup realista apresentando a arte aplicada em um suporte físico da gráfica.
 */
export async function generateProductMockup(
  imageUrl: string,
  product: ProductRecord | null
): Promise<{ dataUrl: string; width: number; height: number }> {
  const art = await loadHtmlImage(imageUrl);
  const w = 1200;
  const h = 840;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Estúdio claro minimalista
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#F6F8FB');
  bg.addColorStop(1, '#E9EEF5');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Base do mockup com sombra suave
  ctx.save();
  ctx.shadowColor = 'rgba(7, 26, 52, 0.16)';
  ctx.shadowBlur = 42;
  ctx.shadowOffsetY = 24;
  ctx.fillStyle = '#FFFFFF';
  const cardW = 760;
  const cardH = 480;
  const cardX = (w - cardW) / 2;
  const cardY = (h - cardH) / 2 - 20;
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, 16);
  ctx.fill();
  ctx.restore();

  // Desenha a arte centralizada dentro da área útil
  const pad = 42;
  const availW = cardW - pad * 2;
  const availH = cardH - pad * 2;
  const scale = Math.min(availW / art.naturalWidth, availH / art.naturalHeight);
  const drawW = art.naturalWidth * scale;
  const drawH = art.naturalHeight * scale;
  ctx.drawImage(art, cardX + (cardW - drawW) / 2, cardY + (cardH - drawH) / 2, drawW, drawH);

  // Legenda técnica discreta
  ctx.fillStyle = '#071A34';
  ctx.font = '600 18px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    product ? `Mockup · ${product.name}` : 'Mockup de apresentação BARUCH',
    w / 2,
    h - 74
  );
  ctx.fillStyle = '#5A6B82';
  ctx.font = '400 14px JetBrains Mono, monospace';
  ctx.fillText(
    product ? `${product.dimensions} · Área de impressão ${product.printArea}` : 'Prévia visual em escala',
    w / 2,
    h - 46
  );

  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}

/**
 * Prepara a arte para fechamento de impressão com sangria, margem de segurança e marcas de corte.
 */
export async function prepareForPrintSheet(
  imageUrl: string,
  product: ProductRecord | null
): Promise<{ dataUrl: string; width: number; height: number }> {
  const art = await loadHtmlImage(imageUrl);
  const w = 1240;
  const h = 880;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);

  const margin = 96;
  const bleed = 22;
  const safe = 24;

  const trimX = margin;
  const trimY = margin;
  const trimW = w - margin * 2;
  const trimH = h - margin * 2 - 36;

  // Arte estendida até a sangria
  const bleedX = trimX - bleed;
  const bleedY = trimY - bleed;
  const bleedW = trimW + bleed * 2;
  const bleedH = trimH + bleed * 2;
  const scale = Math.min(bleedW / art.naturalWidth, bleedH / art.naturalHeight);
  const drawW = art.naturalWidth * scale;
  const drawH = art.naturalHeight * scale;
  ctx.drawImage(art, bleedX + (bleedW - drawW) / 2, bleedY + (bleedH - drawH) / 2, drawW, drawH);

  // Linha de sangria (magenta)
  ctx.strokeStyle = 'rgba(225, 43, 138, 0.7)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(bleedX, bleedY, bleedW, bleedH);

  // Linha de corte (azul-marinho)
  ctx.strokeStyle = '#071A34';
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(trimX, trimY, trimW, trimH);

  // Área de segurança (ciano)
  ctx.strokeStyle = 'rgba(14, 165, 233, 0.75)';
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(trimX + safe, trimY + safe, trimW - safe * 2, trimH - safe * 2);

  // Marcas de corte nos 4 cantos
  ctx.setLineDash([]);
  ctx.strokeStyle = '#071A34';
  ctx.lineWidth = 1.5;
  const mark = 26;
  const corners: Array<[number, number, number, number]> = [
    [trimX, trimY, -1, -1],
    [trimX + trimW, trimY, 1, -1],
    [trimX, trimY + trimH, -1, 1],
    [trimX + trimW, trimY + trimH, 1, 1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * (bleed + 6), cy);
    ctx.lineTo(cx + dx * (bleed + 6 + mark), cy);
    ctx.moveTo(cx, cy + dy * (bleed + 6));
    ctx.lineTo(cx, cy + dy * (bleed + 6 + mark));
    ctx.stroke();
  }

  // Rodapé técnico de fechamento
  ctx.fillStyle = '#071A34';
  ctx.font = '500 13px JetBrains Mono, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(
    `BARUCH PRÉ-IMPRESSÃO · ${product ? `${product.name} (${product.dimensions})` : 'Formato personalizado'} · Sangria 3 mm · CMYK 300 DPI`,
    trimX,
    h - 32
  );

  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}

/**
 * Gera um PDF 1.4 válido no navegador contendo a imagem em alta qualidade.
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

  // Escala para caber em folha A4/proporcional (72 pt/in)
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
  pushStr(`5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`);

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
 * Converte imagem para o formato de saída escolhido (PNG/JPG/WebP) e dispara o download.
 */
export async function exportMediaAsFormat(
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

  const img = await loadHtmlImage(imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  if (format === 'JPG') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);

  const mime =
    format === 'JPG' ? 'image/jpeg' : format === 'WebP' ? 'image/webp' : 'image/png';
  const ext = format === 'JPG' ? 'jpg' : format === 'WebP' ? 'webp' : 'png';
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Falha ao exportar imagem.'))),
      mime,
      0.94
    );
  });
  triggerDownload(blob, `${base}.${ext}`);
}
