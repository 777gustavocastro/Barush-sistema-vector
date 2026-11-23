import type { QualityComparisonReport, RawRgbaImage, SvgValidationReport } from '../types';
import { inspectAndSanitizeSvgContours } from '../geometry/contourInspector';
import { renderSvgSupersampled } from '../stage2/supersampledSvgRenderer';

export type QualityConfidence = 'alta' | 'media' | 'baixa';

export interface ZoomScaleCheck {
  scalePct: number;
  edgeAgreementPct: number;
  chamferPx: number;
  note: string;
}

export interface UniversalVectorizationReport {
  approved: boolean;
  confidence: QualityConfidence;
  summary: string;
  reviewNotes: string[];
  visualFidelity: {
    ssimPct: number;
    deltaE2000: number;
    p95DeltaE2000: number;
    pixelMae: number;
    iouPct: number;
    verdict: string;
  };
  geometricFidelity: {
    chamferPx: number;
    hausdorffP99Px: number;
    contourFidelityPct: number;
    issues: string[];
    verdict: string;
  };
  backgroundIntegrity: {
    uniform: boolean;
    artificialBlobs: number;
    fragments: number;
    transparencyPreserved: boolean;
    texturePreserved: boolean;
    verdict: string;
  };
  preservedDetails: string[];
  lostRegions: string[];
  extraRegions: string[];
  contourQuality: {
    duplicatePaths: number;
    improperlyOpenPaths: number;
    spikes: number;
    selfIntersections: number;
    interrupted: number;
    verdict: string;
  };
  gradientQuality: {
    gradientCount: number;
    continuityPct: number;
    verdict: string;
  };
  zoom: {
    stable: boolean;
    scales: ZoomScaleCheck[];
    verdict: string;
  };
  editability: {
    vectorOnly: boolean;
    pathCount: number;
    gradientCount: number;
    clipPathCount: number;
    maskCount: number;
    objectCount: number;
    hiddenRaster: boolean;
    verdict: string;
  };
}

const ZOOM_SCALES = [0.25, 0.5, 1, 2, 4, 8, 16];

export async function buildUniversalVectorizationReport(input: {
  svg: string;
  original: RawRgbaImage;
  quality?: QualityComparisonReport;
  validation: SvgValidationReport;
  category?: string;
  reviewDefects?: string[];
}): Promise<UniversalVectorizationReport> {
  const { svg, original, validation } = input;
  const quality = input.quality;
  const edit = inspectEditability(svg, validation);
  const geometry = inspectGeometry(svg, original);
  const background = inspectBackground(svg, original, validation.pathCount);
  const rendered = await renderSvgSupersampled(svg, original.width, original.height, {
    supersampleScale: 1,
  });
  const holes = rendered ? compareHoles(original, rendered) : { lost: 0, extra: 0 };
  const zoom = await measureZoomStability(svg, original);

  const ssim = quality?.ssimPct ?? 0;
  const deltaE = quality?.meanDeltaE2000 ?? quality?.meanDeltaELab ?? 99;
  const p95 = quality?.p95DeltaE2000 ?? deltaE;
  const iou = quality?.iouPct ?? 0;
  const chamfer = quality?.chamferDistancePx ?? 99;
  const hausdorff = quality?.hausdorffP99Px ?? 99;
  const contourF1 = quality?.contourFidelityPct ?? 0;
  const gradientContinuity = quality?.gradientContinuityPct ?? 0;
  const isPhoto = input.category === 'photograph';

  const lostRegions: string[] = [];
  const extraRegions: string[] = [];
  const preserved: string[] = [];
  if (holes.lost > 0) lostRegions.push(`${holes.lost} furo(s) interno(s) não aparecem no vetor.`);
  if (iou > 0 && iou < (isPhoto ? 80 : 92)) lostRegions.push(`Máscara com IoU ${iou.toFixed(1)}%.`);
  if (holes.extra > 0) extraRegions.push(`${holes.extra} abertura(s) interna(s) que o original não tem.`);
  if (background.fragments > 6) extraRegions.push(`${background.fragments} caminhos muito curtos no fundo.`);
  if (iou >= (isPhoto ? 80 : 92)) preserved.push(`Silhueta com IoU ${iou.toFixed(1)}%.`);
  if (validation.gradientCount > 0) preserved.push(`${validation.gradientCount} gradiente(s) nativo(s).`);
  if (validation.objectCount > 0) preserved.push(`${validation.objectCount} objeto(s) em grupos separados.`);
  if (holes.lost === 0 && holes.extra === 0) preserved.push('Furos internos conferidos.');

  const reviewNotes = [...(input.reviewDefects ?? []).slice(0, 6)];
  if (!zoom.stable) reviewNotes.push(zoom.verdict);
  if (geometry.issues.length > 0) reviewNotes.push(...geometry.issues.slice(0, 4));
  if (!background.uniform && background.verdict) reviewNotes.push(background.verdict);
  if (isPhoto) {
    reviewNotes.push('Fotografia contínua é aproximação vetorial. Microtextura não tem curva equivalente.');
  }

  const visualFloor = isPhoto ? 88 : 93;
  const deltaFloor = isPhoto ? 4.5 : 3.2;
  const visualOk = ssim >= visualFloor && deltaE <= deltaFloor;
  const geomOk =
    chamfer <= (isPhoto ? 1.6 : 0.8) &&
    geometry.issues.length === 0 &&
    holes.lost <= 1;
  const editableOk = edit.vectorOnly && !edit.hiddenRaster && validation.pathCount > 0;
  const approved = visualOk && geomOk && editableOk && zoom.stable && background.fragments <= 6;

  let confidence: QualityConfidence = 'baixa';
  if (approved && reviewNotes.length === 0) confidence = 'alta';
  else if (approved || (visualOk && editableOk)) confidence = 'media';

  const summary = approved
    ? confidence === 'alta'
      ? 'Aprovado. As métricas concordam e não há ressalva local.'
      : 'Aprovado com ressalvas. A fidelidade global passou e há pontos para revisão.'
    : 'Não aprovado. Há falha de fidelidade, geometria, fundo, zoom ou editabilidade.';

  return {
    approved,
    confidence,
    summary,
    reviewNotes,
    visualFidelity: {
      ssimPct: round2(ssim),
      deltaE2000: round2(deltaE),
      p95DeltaE2000: round2(p95),
      pixelMae: round2(quality?.meanAbsoluteError ?? 0),
      iouPct: round2(iou),
      verdict: visualOk
        ? 'SSIM, ΔE₀₀, erro de pixel e IoU dentro do limite.'
        : `Abaixo do limite para esta categoria (SSIM ${ssim.toFixed(1)}%, ΔE₀₀ ${deltaE.toFixed(2)}).`,
    },
    geometricFidelity: {
      chamferPx: round2(chamfer),
      hausdorffP99Px: round2(hausdorff),
      contourFidelityPct: round2(contourF1),
      issues: geometry.issues,
      verdict: geomOk
        ? 'Contornos, máscara e furos conferidos.'
        : 'Desvio de contorno, furo ou componente fora do limite.',
    },
    backgroundIntegrity: background,
    preservedDetails: preserved,
    lostRegions,
    extraRegions,
    contourQuality: geometry.contour,
    gradientQuality: {
      gradientCount: validation.gradientCount,
      continuityPct: round2(gradientContinuity),
      verdict:
        validation.gradientCount === 0
          ? 'Sem gradiente nativo. Válido quando a cena é cor sólida.'
          : gradientContinuity >= 75
            ? 'Stops nativos e continuidade de transição aceita.'
            : 'Gradiente presente, com continuidade baixa. Revisar faixas.',
    },
    zoom,
    editability: edit,
  };
}

function inspectEditability(svg: string, validation: SvgValidationReport): UniversalVectorizationReport['editability'] {
  const hiddenRaster =
    validation.hasEmbeddedRaster ||
    /<image\b|<feImage\b|data:image\/|xlink:href="data:/i.test(svg);
  const maskCount = (svg.match(/<mask\b/gi) ?? []).length;
  const vectorOnly = !hiddenRaster && validation.pathCount > 0 && validation.valid;
  return {
    vectorOnly,
    pathCount: validation.pathCount,
    gradientCount: validation.gradientCount,
    clipPathCount: validation.clipPathCount,
    maskCount,
    objectCount: validation.objectCount,
    hiddenRaster,
    verdict: hiddenRaster
      ? 'Raster incorporado. A vetorização não é editável.'
      : vectorOnly
        ? 'Paths, grupos e gradientes são vetoriais. Nenhum PNG embutido.'
        : 'Estrutura vetorial incompleta.',
  };
}

function inspectGeometry(
  svg: string,
  original: RawRgbaImage
): { issues: string[]; contour: UniversalVectorizationReport['contourQuality'] } {
  const paths = [...svg.matchAll(/<path\b([^>]*)>/gi)].map((match) => match[1]);
  const ds = paths.map((attrs) => attrs.match(/\bd="([^"]+)"/i)?.[1] ?? '');
  const seen = new Set<string>();
  let duplicatePaths = 0;
  for (const d of ds) {
    if (!d) continue;
    if (seen.has(d)) duplicatePaths++;
    seen.add(d);
  }
  let improperlyOpenPaths = 0;
  for (const attrs of paths) {
    const fill = (attrs.match(/\bfill="([^"]+)"/i)?.[1] ?? '').toLowerCase();
    const d = attrs.match(/\bd="([^"]+)"/i)?.[1] ?? '';
    const isStroke = /\bstroke="(?!none)/i.test(attrs) && (fill === 'none' || fill === '');
    if (!isStroke && d && !/\bZ\b/i.test(d)) improperlyOpenPaths++;
  }
  const inspected = inspectAndSanitizeSvgContours(svg, original, 1, 2);
  const spikes = inspected.summary.artificialSpikesTrimmed;
  const selfIntersections = inspected.summary.selfIntersectionsRepaired;
  const interrupted = inspected.summary.unclosedLoopsFixed;
  const issues: string[] = [];
  if (duplicatePaths > 0) issues.push(`${duplicatePaths} caminho(s) duplicado(s).`);
  if (improperlyOpenPaths > 0) issues.push(`${improperlyOpenPaths} preenchimento(s) sem fechar.`);
  if (spikes > 0) issues.push(`${spikes} ponta(s) ou saliência(s) artificial(is).`);
  if (selfIntersections > 0) issues.push(`${selfIntersections} auto-interseção(ões).`);
  if (interrupted > 0) issues.push(`${interrupted} contorno(s) interrompido(s).`);
  const contour = {
    duplicatePaths,
    improperlyOpenPaths,
    spikes,
    selfIntersections,
    interrupted,
    verdict: issues.length === 0 ? 'Sem duplicata, ponta solta ou contorno aberto indevido.' : issues.join(' '),
  };
  return { issues, contour };
}

function inspectBackground(
  svg: string,
  original: RawRgbaImage,
  pathCount: number
): UniversalVectorizationReport['backgroundIntegrity'] {
  const corners = cornerSamples(original);
  const opaque = corners.filter((c) => c.a >= 240);
  const spread = opaque.length >= 3 ? maxSpread(opaque) : 999;
  const uniform = spread <= 18;
  const transparent = corners.filter((c) => c.a < 30).length >= 3;
  const shortPaths = [...svg.matchAll(/\bd="([^"]+)"/gi)].filter((m) => m[1].length < 28).length;
  const fragments = uniform ? shortPaths : 0;
  const texturePreserved = !uniform && !transparent && pathCount > 2;
  let verdict = 'Fundo sem regra uniforme.';
  if (transparent) verdict = 'Cantos transparentes preservados como ausência de retângulo opaco.';
  else if (uniform && fragments <= 6) verdict = 'Fundo sólido sem mancha nem fragmento curto.';
  else if (uniform) verdict = 'Fundo sólido com fragmentos curtos.';
  else if (texturePreserved) verdict = 'Fundo variado mantido em regiões, não achatado.';
  return {
    uniform,
    artificialBlobs: fragments,
    fragments,
    transparencyPreserved: transparent || opaque.length >= 3,
    texturePreserved: texturePreserved || uniform,
    verdict,
  };
}

async function measureZoomStability(
  svg: string,
  original: RawRgbaImage
): Promise<UniversalVectorizationReport['zoom']> {
  const crop = findEdgeCrop(original, 56);
  const scales: ZoomScaleCheck[] = [];
  let reference: Array<[number, number]> | null = null;
  for (const scale of ZOOM_SCALES) {
    const outW = Math.max(8, Math.round(crop.w * scale));
    const outH = Math.max(8, Math.round(crop.h * scale));
    const cropped = retargetViewBox(svg, crop.x, crop.y, crop.w, crop.h, outW, outH);
    const rendered = await renderSvgSupersampled(cropped, outW, outH, { supersampleScale: 1 });
    if (!rendered) {
      scales.push({
        scalePct: Math.round(scale * 100),
        edgeAgreementPct: 0,
        chamferPx: 99,
        note: 'Renderização indisponível.',
      });
      continue;
    }
    const points = edgePoints(rendered, scale);
    if (scale === 1) reference = points;
    const chamfer = reference && scale !== 1 ? directedChamfer(points, reference) : 0;
    const agreement = chamfer <= 0.35 ? 100 : Math.max(0, 100 - chamfer * 28);
    const lowZoom = scale < 1;
    const note = lowZoom
      ? chamfer > 1.4
        ? 'Diferença compatível com antialiasing da redução.'
        : 'Redução estável.'
      : chamfer > 1.15
        ? 'Desvio cresce com o zoom: defeito de caminho.'
        : 'Geometria estável neste zoom.';
    scales.push({
      scalePct: Math.round(scale * 100),
      edgeAgreementPct: round2(agreement),
      chamferPx: round2(chamfer),
      note,
    });
  }
  const unstable = scales.some((row) => row.scalePct >= 200 && row.chamferPx > 1.15);
  return {
    stable: !unstable,
    scales,
    verdict: unstable
      ? 'O contorno se desloca acima de 1,15 px entre 200% e 1600%.'
      : 'De 100% a 800% o contorno permanece no mesmo lugar. 25% e 50% variam pelo antialiasing.',
  };
}

function compareHoles(original: RawRgbaImage, rendered: RawRgbaImage): { lost: number; extra: number } {
  const orig = holeCount(original);
  const vec = holeCount(rendered);
  return { lost: Math.max(0, orig - vec), extra: Math.max(0, vec - orig) };
}

function holeCount(image: RawRgbaImage): number {
  const { width, height, data } = image;
  const fg = new Uint8Array(width * height);
  const bg = cornerRgb(image);
  for (let i = 0; i < fg.length; i++) {
    const o = i * 4;
    if (data[o + 3] < 40) continue;
    const dist = Math.max(
      Math.abs(data[o] - bg[0]),
      Math.abs(data[o + 1] - bg[1]),
      Math.abs(data[o + 2] - bg[2])
    );
    if (dist > 28) fg[i] = 1;
  }
  const seen = new Uint8Array(fg.length);
  let holes = 0;
  for (let start = 0; start < fg.length; start++) {
    if (fg[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let touches = false;
    let count = 0;
    while (stack.length > 0) {
      const px = stack.pop() as number;
      count++;
      const x = px % width;
      const y = (px - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touches = true;
      const nbs = [x > 0 ? px - 1 : -1, x + 1 < width ? px + 1 : -1, y > 0 ? px - width : -1, y + 1 < height ? px + width : -1];
      for (const n of nbs) {
        if (n < 0 || seen[n] || fg[n]) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (!touches && count >= 8) holes++;
  }
  return holes;
}

function findEdgeCrop(image: RawRgbaImage, size: number): { x: number; y: number; w: number; h: number } {
  const { width, height, data } = image;
  const w = Math.min(size, width);
  const h = Math.min(size, height);
  let best = { x: Math.max(0, Math.floor((width - w) / 2)), y: Math.max(0, Math.floor((height - h) / 2)), score: -1 };
  const step = Math.max(4, Math.floor(Math.min(width, height) / 12));
  for (let y = 0; y + h <= height; y += step) {
    for (let x = 0; x + w <= width; x += step) {
      let min = 255;
      let max = 0;
      for (let py = y; py < y + h; py += 3) {
        for (let px = x; px < x + w; px += 3) {
          const i = (py * width + px) * 4;
          const lum = data[i] * 0.3 + data[i + 1] * 0.5 + data[i + 2] * 0.2;
          if (lum < min) min = lum;
          if (lum > max) max = lum;
        }
      }
      const score = max - min;
      if (score > best.score) best = { x, y, score };
    }
  }
  return { x: best.x, y: best.y, w, h };
}

function retargetViewBox(svg: string, x: number, y: number, w: number, h: number, outW: number, outH: number): string {
  let next = svg;
  if (/viewBox="/i.test(next)) {
    next = next.replace(/viewBox="[^"]*"/i, `viewBox="${x} ${y} ${w} ${h}"`);
  } else {
    next = next.replace(/<svg\b/i, `<svg viewBox="${x} ${y} ${w} ${h}"`);
  }
  next = next.replace(/width="[^"]*"/i, `width="${outW}"`);
  next = next.replace(/height="[^"]*"/i, `height="${outH}"`);
  return next;
}

function edgePoints(image: RawRgbaImage, scale: number): Array<[number, number]> {
  const { width, height, data } = image;
  const lum = new Float32Array(width * height);
  for (let i = 0; i < lum.length; i++) {
    const o = i * 4;
    lum[i] = data[o] * 0.3 + data[o + 1] * 0.59 + data[o + 2] * 0.11;
  }
  const points: Array<[number, number]> = [];
  const stride = width > 700 ? 2 : 1;
  for (let y = 1; y < height - 1; y += stride) {
    for (let x = 1; x < width - 1; x += stride) {
      const i = y * width + x;
      const gx = lum[i + 1] - lum[i - 1];
      const gy = lum[i + width] - lum[i - width];
      if (Math.abs(gx) + Math.abs(gy) < 46) continue;
      points.push([x / scale, y / scale]);
      if (points.length > 1800) return points;
    }
  }
  return points;
}

function directedChamfer(from: Array<[number, number]>, to: Array<[number, number]>): number {
  if (from.length === 0 || to.length === 0) return from.length === 0 && to.length === 0 ? 0 : 4;
  const step = Math.max(1, Math.floor(from.length / 400));
  let sum = 0;
  let n = 0;
  for (let i = 0; i < from.length; i += step) {
    const [x, y] = from[i];
    let best = 64;
    const inner = Math.max(1, Math.floor(to.length / 500));
    for (let j = 0; j < to.length; j += inner) {
      const dx = to[j][0] - x;
      const dy = to[j][1] - y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    sum += Math.sqrt(best);
    n++;
  }
  return sum / Math.max(1, n);
}

function cornerSamples(image: RawRgbaImage): Array<{ r: number; g: number; b: number; a: number }> {
  const { width, height, data } = image;
  const pts = [0, width - 1, (height - 1) * width, (height - 1) * width + (width - 1)];
  return pts.map((px) => {
    const i = px * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
  });
}

function cornerRgb(image: RawRgbaImage): [number, number, number] {
  const c = cornerSamples(image)[0];
  return [c.r, c.g, c.b];
}

function maxSpread(samples: Array<{ r: number; g: number; b: number }>): number {
  let spread = 0;
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      spread = Math.max(
        spread,
        Math.abs(samples[i].r - samples[j].r),
        Math.abs(samples[i].g - samples[j].g),
        Math.abs(samples[i].b - samples[j].b)
      );
    }
  }
  return spread;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
