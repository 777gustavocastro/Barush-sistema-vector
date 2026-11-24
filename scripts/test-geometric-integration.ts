import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import {
  continuityOfPath,
  maskIoU,
} from '../src/engine/geometric/contract/geometricContract';
import {
  runVectorizationOnRgbaInternal,
  validateSvgStructure,
  type RawRgbaImage,
  type VectorizationParameters,
} from '../src/engine';

const baseParams: VectorizationParameters = {
  profile: 'logo_illustration',
  engine: 'auto',
  autoTune: false,
  colorCount: 16,
  detailPrecision: 88,
  curveSmoothness: 42,
  pathSimplification: 8,
  noiseRemoval: 0,
  contourSensitivity: 76,
  optimizeSvg: true,
  reconstructGradients: true,
  enhanceTypography: false,
  subpixelUpscale: false,
  enableGeometricCandidate: true,
};

async function rasterizeSvg(
  svg: string,
  width: number,
  height: number,
  format: 'png' | 'jpeg' = 'png'
): Promise<RawRgbaImage> {
  const png = await sharp(Buffer.from(svg)).resize(width, height).ensureAlpha().png().toBuffer();
  const encoded =
    format === 'jpeg'
      ? await sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality: 72 }).toBuffer()
      : png;
  const { data, info } = await sharp(encoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data),
    sourceFormat: format,
  };
}

function makeSyntheticPhoto(width: number, height: number): RawRgbaImage {
  const data = new Uint8Array(width * height * 4);
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const nx = x / width;
      const ny = y / height;
      const grain = (rand() - 0.5) * 34;
      const sky = ny < 0.55;
      const r = sky ? 70 + nx * 95 + grain : 45 + Math.sin(x * 0.14) * 35 + Math.cos(y * 0.19) * 28 + grain;
      const g = sky ? 130 + ny * 90 + grain : 95 + Math.sin(x * 0.11 + y * 0.08) * 40 + grain;
      const b = sky ? 210 - ny * 40 + grain : 50 + Math.cos(x * 0.17 - y * 0.13) * 30 + grain;
      data[i] = Math.max(0, Math.min(255, Math.round(r)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
      data[i + 3] = 255;
    }
  }
  return { width, height, data, sourceFormat: 'jpeg' };
}

function renderSvgPixels(svg: string, width: number, height: number): Uint8Array {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().pixels;
}

function auditSvgHygiene(svg: string): { ok: boolean; issues: string[]; g1Breaks: number } {
  const issues: string[] = [];
  const struct = validateSvgStructure(svg);
  if (!struct.valid) issues.push(...struct.errors);
  if (struct.hasEmbeddedRaster) issues.push('raster embutido');
  if (/<image\b|<feImage\b|data:image/i.test(svg)) issues.push('tag ou data-URI raster');
  if (/vector-effect="non-scaling-stroke"/i.test(svg)) issues.push('non-scaling-stroke');

  // Verifica caminhos duplicados involuntários (mesma geometria d E mesmo fill no corpo visível)
  const visibleBody = svg.replace(/<defs\b[^>]*>[\s\S]*?<\/defs>/gi, '');
  const pathTags = [...visibleBody.matchAll(/<path\b([^>]*)\/?>/gi)];
  const pathDs: string[] = [];
  const seen = new Set<string>();
  let dupes = 0;
  for (const m of pathTags) {
    const attrs = m[1];
    const d = attrs.match(/\bd="([^"]+)"/i)?.[1] ?? '';
    const fill = attrs.match(/\bfill="([^"]+)"/i)?.[1] ?? '';
    if (!d) continue;
    pathDs.push(d);
    const key = `${d}::${fill}`;
    if (d.length > 24 && seen.has(key)) dupes++;
    seen.add(key);
  }
  if (dupes > 0) issues.push(`${dupes} caminho(s) duplicado(s)`);

  const g1 = pathDs.length > 0 ? continuityOfPath(pathDs.join(' ')).unintendedG1Breaks : 0;
  return { ok: issues.length === 0, issues, g1Breaks: g1 };
}

function zoomIoU(
  refSvg: string,
  candSvg: string,
  box: { x: number; y: number; w: number; h: number },
  zoom: number
): number {
  const outW = Math.round(box.w * zoom);
  const outH = Math.round(box.h * zoom);
  const wrap = (svg: string) => {
    const inner = svg
      .replace(/^[\s\S]*?<svg[^>]*>/i, '')
      .replace(/<\/svg>\s*$/i, '');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}">${inner}</svg>`;
  };
  const refPix = renderSvgPixels(wrap(refSvg), outW, outH);
  const candPix = renderSvgPixels(wrap(candSvg), outW, outH);
  const dark = (buf: Uint8Array, i: number) =>
    buf[i * 4 + 3] > 20 && (buf[i * 4] < 240 || buf[i * 4 + 1] < 240 || buf[i * 4 + 2] < 240);
  return maskIoU(outW, outH, (x, y) => dark(refPix, y * outW + x), (x, y) => dark(candPix, y * outW + x)).iou;
}

async function saveSideBySidePng(
  filePath: string,
  origImage: RawRgbaImage,
  legacySvg: string,
  geoSvg: string | null
): Promise<void> {
  const w = Math.min(360, origImage.width);
  const h = Math.round((origImage.height / origImage.width) * w);
  const origPng = await sharp(Buffer.from(origImage.data), {
    raw: { width: origImage.width, height: origImage.height, channels: 4 },
  })
    .resize(w, h)
    .flatten({ background: '#f1f5f9' })
    .png()
    .toBuffer();

  const legPng = await sharp(Buffer.from(legacySvg))
    .resize(w, h)
    .flatten({ background: '#f1f5f9' })
    .png()
    .toBuffer();

  const geoPng = await sharp(Buffer.from(geoSvg ?? legacySvg))
    .resize(w, h)
    .flatten({ background: '#f1f5f9' })
    .png()
    .toBuffer();

  const gap = 8;
  await sharp({
    create: {
      width: w * 3 + gap * 2,
      height: h,
      channels: 4,
      background: { r: 226, g: 232, b: 240, alpha: 1 },
    },
  })
    .composite([
      { input: origPng, left: 0, top: 0 },
      { input: legPng, left: w + gap, top: 0 },
      { input: geoPng, left: (w + gap) * 2, top: 0 },
    ])
    .png()
    .toFile(filePath);
}

interface IntegrationCase {
  id: string;
  name: string;
  w: number;
  h: number;
  svg?: string;
  format?: 'png' | 'jpeg';
  customImage?: () => RawRgbaImage;
  saveVisual?: boolean;
  zoomBox?: { x: number; y: number; w: number; h: number };
}

async function main() {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });

  const birdSource = readFileSync(new URL('./test-winged-logo-fidelity.ts', import.meta.url), 'utf8');
  const birdSvg = birdSource.match(/return `([\s\S]*?)`;/)?.[1];
  assert.ok(birdSvg, 'logo histórico do pássaro não encontrado');

  const cases: IntegrationCase[] = [
    {
      id: 'logo-solido',
      name: 'Logo sólido (contorno preto espesso + miolo)',
      w: 200,
      h: 150,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="#fff"/><rect x="24" y="20" width="152" height="110" fill="#111"/><rect x="42" y="38" width="116" height="74" fill="#1d4ed8"/></svg>`,
      saveVisual: true,
      zoomBox: { x: 20, y: 44, w: 24, h: 24 },
    },
    {
      id: 'logo-gradiente',
      name: 'Logo com gradiente linear',
      w: 200,
      h: 120,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#fff"/><defs><linearGradient id="lg" gradientUnits="userSpaceOnUse" x1="20" y1="60" x2="180" y2="60"><stop offset="0%" stop-color="#0f172a"/><stop offset="50%" stop-color="#2563eb"/><stop offset="100%" stop-color="#93c5fd"/></linearGradient></defs><rect x="20" y="20" width="160" height="80" rx="16" fill="url(#lg)"/></svg>`,
      saveVisual: true,
      zoomBox: { x: 18, y: 18, w: 28, h: 28 },
    },
    {
      id: 'letra-serifa',
      name: 'Letra com serifa',
      w: 140,
      h: 110,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="110"><rect width="140" height="110" fill="#fff"/><path d="M56 16 H84 V64 H102 V78 H84 V94 H56 V78 H38 V64 H56 Z" fill="#111"/></svg>`,
      zoomBox: { x: 34, y: 60, w: 24, h: 24 },
    },
    {
      id: 'letra-sem-serifa',
      name: 'Letra sem serifa com contraforma (O)',
      w: 160,
      h: 140,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="140"><rect width="160" height="140" fill="#fff"/><circle cx="80" cy="70" r="48" fill="#111"/><circle cx="80" cy="70" r="30" fill="#fff"/></svg>`,
      zoomBox: { x: 68, y: 18, w: 24, h: 24 },
    },
    {
      id: 'tipografia-fina',
      name: 'Tipografia / traços finos (2 px)',
      w: 160,
      h: 60,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60"><rect width="160" height="60" fill="#fff"/><rect x="16" y="18" width="128" height="2" fill="#111"/><rect x="16" y="36" width="128" height="2" fill="#111"/></svg>`,
      zoomBox: { x: 40, y: 14, w: 24, h: 12 },
    },
    {
      id: 'simbolo-vazado',
      name: 'Símbolo com furo fechado e recorte aberto',
      w: 160,
      h: 120,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#fff"/><polygon points="16,16 140,16 140,36 108,36 108,84 140,84 140,104 16,104" fill="#111"/><rect x="36" y="48" width="22" height="22" fill="#fff"/></svg>`,
      zoomBox: { x: 32, y: 44, w: 30, h: 30 },
    },
    {
      id: 'icone-whatsapp',
      name: 'Ícone (disco verde com 3 contraformas)',
      w: 180,
      h: 180,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="#fff"/><circle cx="90" cy="90" r="68" fill="#25D366"/><circle cx="74" cy="84" r="12" fill="#fff"/><circle cx="108" cy="84" r="12" fill="#fff"/><circle cx="91" cy="112" r="9" fill="#fff"/></svg>`,
      saveVisual: true,
    },
    {
      id: 'ilustracao',
      name: 'Ilustração (formas orgânicas + cores)',
      w: 220,
      h: 140,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="140"><rect width="220" height="140" fill="#fff"/><path d="M24 110 C 48 24, 118 24, 140 110 Z" fill="#0ea5e9"/><circle cx="164" cy="48" r="24" fill="#f59e0b"/><path d="M26 112 C 74 90, 146 90, 196 112 L 196 126 L 26 126 Z" fill="#16a34a"/></svg>`,
    },
    {
      id: 'geometria-simples',
      name: 'Geometria simples (diagonal + círculo)',
      w: 220,
      h: 140,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="140"><rect width="220" height="140" fill="#fff"/><polygon points="16,118 112,22 112,118" fill="#111"/><circle cx="168" cy="70" r="36" fill="#2563eb"/></svg>`,
      zoomBox: { x: 48, y: 54, w: 28, h: 28 },
    },
    {
      id: 'preto-solido',
      name: 'Preto sólido (moldura espessa)',
      w: 180,
      h: 120,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect width="180" height="120" fill="#fff"/><rect x="24" y="18" width="132" height="84" fill="none" stroke="#111" stroke-width="10"/></svg>`,
    },
    {
      id: 'ouro',
      name: 'Ouro (gradiente metálico linear)',
      w: 180,
      h: 120,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect width="180" height="120" fill="#fff"/><defs><linearGradient id="au" gradientUnits="userSpaceOnUse" x1="30" y1="60" x2="150" y2="60"><stop offset="0%" stop-color="#5c3b09"/><stop offset="50%" stop-color="#d4a017"/><stop offset="100%" stop-color="#fff4c4"/></linearGradient></defs><ellipse cx="90" cy="60" rx="60" ry="36" fill="url(#au)"/></svg>`,
      zoomBox: { x: 76, y: 20, w: 28, h: 20 },
    },
    {
      id: 'prata',
      name: 'Prata (gradiente metálico radial)',
      w: 160,
      h: 160,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#fff"/><defs><radialGradient id="ag" gradientUnits="userSpaceOnUse" cx="80" cy="80" r="58"><stop offset="0%" stop-color="#f8fafc"/><stop offset="55%" stop-color="#94a3b8"/><stop offset="100%" stop-color="#334155"/></radialGradient></defs><circle cx="80" cy="80" r="58" fill="url(#ag)"/></svg>`,
    },
    {
      id: 'reflexos',
      name: 'Reflexos (esfera com brilho recortado)',
      w: 140,
      h: 140,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140"><rect width="140" height="140" fill="#fff"/><circle cx="70" cy="70" r="48" fill="#1d4ed8"/><circle cx="52" cy="52" r="14" fill="#ffffff" opacity="0.85"/></svg>`,
    },
    {
      id: 'transparencia',
      name: 'Transparência (fundo alfa transparente)',
      w: 140,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect x="20" y="18" width="100" height="64" rx="12" fill="#2563eb" opacity="0.7"/></svg>`,
    },
    {
      id: 'jpeg',
      name: 'JPEG (compressão Q=72)',
      w: 180,
      h: 120,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect width="180" height="120" fill="#fff"/><circle cx="62" cy="60" r="36" fill="#dc2626"/><rect x="112" y="26" width="46" height="68" fill="#111"/></svg>`,
      format: 'jpeg',
    },
    {
      id: 'antialiasing',
      name: 'Antialiasing (arco + curva suave)',
      w: 220,
      h: 120,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="120"><rect width="220" height="120" fill="#fff"/><path d="M30 82 A 64 64 0 0 1 158 82" fill="none" stroke="#111" stroke-width="8"/></svg>`,
      zoomBox: { x: 80, y: 12, w: 28, h: 20 },
    },
    {
      id: 'detalhes-pequenos',
      name: 'Detalhes pequenos (estrelas + pontos)',
      w: 160,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#fff"/><rect x="16" y="16" width="128" height="68" fill="#0f172a"/><circle cx="44" cy="50" r="6" fill="#facc15"/><circle cx="80" cy="50" r="4" fill="#facc15"/><circle cx="116" cy="50" r="8" fill="#facc15"/></svg>`,
    },
    {
      id: 'alta-resolucao',
      name: 'Alta resolução (1024×768)',
      w: 1024,
      h: 768,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768"><rect width="1024" height="768" fill="#fff"/><circle cx="340" cy="384" r="220" fill="#1d4ed8"/><rect x="610" y="180" width="300" height="408" rx="36" fill="#111"/></svg>`,
    },
    {
      id: 'fotografia',
      name: 'Fotografia contínua (textura estocástica)',
      w: 220,
      h: 160,
      customImage: () => makeSyntheticPhoto(220, 160),
    },
    {
      id: 'logo-passaro-original',
      name: 'Logo histórico original do pássaro (600×480)',
      w: 600,
      h: 480,
      svg: birdSvg,
      saveVisual: true,
    },
  ];

  const report: string[] = [
    '# Etapa 6 — Integração Controlada e Validação Final do Geometric Reconstruction Engine',
    '',
    'Comparativo entre **OpenCV atual**, **VTracer atual** e **Geometric Reconstruction Engine** avaliados independentemente pelo mesmo seletor com limites eliminatórios.',
    '',
    '## Resultados numéricos por categoria (20 casos)',
    '',
    '| Categoria | OpenCV (Score / IoU / G1) | VTracer (Score / IoU / G1) | Geométrico (Score / IoU / G1) | Vencedor | Higiene SVG |',
    '|---|---|---|---|---|---|',
  ];

  const approvedCategories: string[] = [];
  const legacyRetainedCategories: string[] = [];
  const zoomTable: string[] = [];
  const visualFiles: string[] = [];

  const filter = process.env.ONLY_CASE;
  const activeCases = filter ? cases.filter((c) => c.id === filter) : cases;
  for (const c of activeCases) {
    process.stderr.write(`[Etapa 6] Executando: ${c.name}...\n`);
    const img = c.customImage
      ? c.customImage()
      : await rasterizeSvg(c.svg!, c.w, c.h, c.format ?? 'png');

    const { result, candidates } = await runVectorizationOnRgbaInternal(
      img,
      {
        ...baseParams,
        enableGeometricCandidate: process.env.NO_GEO ? false : true,
      },
      (ev) => {
        if (filter) process.stderr.write(`  [stage] ${ev.stageId}: ${ev.stageLabel}\n`);
      }
    );
    process.stderr.write(`[Etapa 6] Pipeline ok: ${result.engineUsed} (${candidates.length} cands)\n`);
    const evals = result.qualityReport?.evaluatedCandidates ?? [];

    const fmtCand = (idPrefix: string) => {
      const m = evals.find((e) => e.candidateId.startsWith(idPrefix));
      if (!m) return '— (não aplicável)';
      const status = m.rejected ? 'REJ' : `${m.compositeScore}`;
      return `${status} / ${(m.iouPct ?? 0).toFixed(1)}% / G1:${m.unintendedG1Breaks ?? 0}`;
    };

    const hygiene = auditSvgHygiene(result.svg);
    assert.equal(hygiene.ok, true, `${c.name}: falha de higiene SVG: ${hygiene.issues.join(', ')}`);

    const geoCand = candidates.find((cand) => cand.engineKind === 'geometric_reconstruction');
    const legacyCand =
      candidates.find((cand) => cand.engineKind === 'opencv_bezier_gradients') ??
      candidates.find((cand) => cand.engineKind === 'vtracer_rek_gradients') ??
      candidates[0];

    if (c.saveVisual && legacyCand) {
      const outPath = `/opt/cursor/artifacts/comparativo-etapa06-${c.id}.png`;
      await saveSideBySidePng(outPath, img, legacyCand.svg, geoCand?.svg ?? null);
      visualFiles.push(outPath);
    }

    const winnerIsGeo = result.engineUsed === 'geometric_reconstruction';
    if (winnerIsGeo) approvedCategories.push(c.name);
    else legacyRetainedCategories.push(`${c.name} (${result.engineUsed})`);

    report.push(
      `| ${c.name} | ${fmtCand('opencv')} | ${fmtCand('vtracer')} | ${fmtCand('geometric')} | **${result.engineUsed}** | ${hygiene.ok ? 'OK (0 raster)' : hygiene.issues.join('; ')} |`
    );

    if (c.zoomBox && c.svg && geoCand) {
      const zs = [1, 2, 4, 8, 16, 32].map((z) => zoomIoU(c.svg!, geoCand.svg, c.zoomBox!, z));
      zoomTable.push(
        `| ${c.name} | ${zs.map((v) => `${(v * 100).toFixed(2)}%`).join(' | ')} |`
      );
    }
  }

  report.push('');
  report.push('## Teste de zoom do novo motor (100% a 3200%)');
  report.push('');
  report.push('| Categoria | 100% | 200% | 400% | 800% | 1600% | 3200% |');
  report.push('|---|---:|---:|---:|---:|---:|---:|');
  report.push(...zoomTable);

  report.push('');
  report.push('## Categorias vencidas pelo Geometric Reconstruction Engine');
  for (const name of approvedCategories) report.push(`- ${name}`);

  report.push('');
  report.push('## Categorias mantidas no pipeline anterior (sem forçar promoção)');
  for (const name of legacyRetainedCategories) report.push(`- ${name}`);

  report.push('');
  report.push('## Comparações visuais geradas (Original | Antigo | Novo)');
  for (const f of visualFiles) report.push(`- \`${f}\``);

  const md = report.join('\n');
  writeFileSync('/opt/cursor/artifacts/integracao-etapa06.md', md);
  console.log(md);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
