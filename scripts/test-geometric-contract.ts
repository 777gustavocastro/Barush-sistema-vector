import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import {
  boundaryError,
  continuityOfPath,
  flattenPath,
  geometricAcceptance,
  meetsCircle,
  meetsLine,
  pathCensus,
  referenceError,
  sampleArc,
  sampleCircle,
  sampleEllipse,
  sampleLine,
  type ErrorStats,
} from '../src/engine/geometric/contract/geometricContract';
import { runVectorizationOnRgba, type RawRgbaImage, type VectorizationParameters } from '../src/engine';

const params: VectorizationParameters = {
  profile: 'logo_illustration',
  engine: 'auto',
  autoTune: false,
  colorCount: 12,
  detailPrecision: 88,
  curveSmoothness: 42,
  pathSimplification: 8,
  noiseRemoval: 0,
  contourSensitivity: 76,
  optimizeSvg: true,
  reconstructGradients: true,
  enhanceTypography: false,
  subpixelUpscale: false,
};

async function raster(svg: string, w: number, h: number, format: 'png' | 'jpeg' = 'png'): Promise<RawRgbaImage> {
  const png = await sharp(Buffer.from(svg)).resize(w, h).ensureAlpha().png().toBuffer();
  const encoded = format === 'jpeg' ? await sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality: 72 }).toBuffer() : png;
  const { data, info } = await sharp(encoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data), sourceFormat: format === 'jpeg' ? 'jpeg' : 'png' };
}

function chainsOf(svg: string) {
  return [...svg.matchAll(/\bd="([^"]+)"/g)].flatMap((match) => flattenPath(match[1]));
}

function joinD(svg: string): string {
  return [...svg.matchAll(/\bd="([^"]+)"/g)].map((match) => match[1]).join(' ');
}

function line(name: string, stats: ErrorStats, limit: number): string {
  const ok = stats.maxPx <= limit;
  return `${ok ? 'DENTRO' : 'FORA'} — ${name}: máx ${stats.maxPx} px, média ${stats.meanPx} px, limite ${limit} px`;
}

async function vector(svg: string, w: number, h: number, format: 'png' | 'jpeg' = 'png') {
  const started = performance.now();
  const result = await runVectorizationOnRgba(await raster(svg, w, h, format), params);
  return { result, ms: Math.round(performance.now() - started) };
}

function selfCheck(): void {
  const straight = referenceError(sampleLine(10, 10, 210, 10, 2), flattenPath('M 10 10 L 210 10'));
  assert.equal(meetsLine(straight), true, `reta perfeita reprovada ${JSON.stringify(straight)}`);
  const stair = flattenPath('M 10 10 L 20 10 L 20 11 L 30 11 L 30 10 L 40 10 L 40 11 L 50 11');
  const stairError = referenceError(sampleLine(10, 10, 50, 10, 1), stair);
  assert.equal(meetsLine(stairError), false, `degrau foi aceito como reta ${JSON.stringify(stairError)}`);
  const circle = referenceError(sampleCircle(50, 50, 28, 8), flattenPath(circleCubics(50, 50, 28)));
  assert.equal(meetsCircle(circle.maxPx, circle.hausdorffPx), true, `círculo analítico reprovado ${JSON.stringify(circle)}`);
  const kink = continuityOfPath('M 0 0 L 40 0 L 40 8');
  assert.ok(kink.corners >= 1, 'canto reto não foi contado');
}

function circleCubics(cx: number, cy: number, r: number): string {
  const k = 0.5522847498 * r;
  return `M ${cx - r} ${cy} C ${cx - r} ${cy + k} ${cx - k} ${cy + r} ${cx} ${cy + r} C ${cx + k} ${cy + r} ${cx + r} ${cy + k} ${cx + r} ${cy} C ${cx + r} ${cy - k} ${cx + k} ${cy - r} ${cx} ${cy - r} C ${cx - k} ${cy - r} ${cx - r} ${cy - k} ${cx - r} ${cy}`;
}

async function main() {
  selfCheck();
  const rows: string[] = [
    '# Contrato geométrico — linha de base do pipeline atual',
    '',
    `Limite de reta: máx ${geometricAcceptance.line.maxPx} px, média ${geometricAcceptance.line.meanPx} px.`,
    `Limite de círculo: raio ${geometricAcceptance.circle.maxRadiusPx} px. Elipse: ${geometricAcceptance.ellipse.maxRadialPx} px. Arco: ${geometricAcceptance.arc.maxPx} px.`,
    `Orgânico: máx ${geometricAcceptance.organic.maxPx} px. Canto: ${geometricAcceptance.corner.positionPx} px. G0: ${geometricAcceptance.continuity.g0Px} px. G1 involuntário: ${geometricAcceptance.continuity.unintendedG1Deg}°.`,
    `Cobertura sólida: IoU ${geometricAcceptance.coverage.iouSolid}. Detalhe fino: recall ${geometricAcceptance.coverage.recallDetail}, Hausdorff ${geometricAcceptance.coverage.hausdorffDetailPx} px.`,
    'SSIM e ΔE₀₀ aparecem como aparência. Não aprovam a geometria.',
    '',
  ];

  const specs: Array<{ name: string; w: number; h: number; format?: 'png' | 'jpeg'; svg: string; probe: (svg: string) => string }> = [
    {
      name: 'reta horizontal 720 px',
      w: 720,
      h: 80,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="80"><rect width="720" height="80" fill="#fff"/><rect x="40" y="36" width="640" height="8" fill="#111"/></svg>`,
      probe: (svg) => line('borda superior', referenceError(sampleLine(40, 36, 680, 36, 4), chainsOf(svg)), geometricAcceptance.line.maxPx),
    },
    {
      name: 'reta vertical',
      w: 80,
      h: 200,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="200"><rect width="80" height="200" fill="#fff"/><rect x="36" y="20" width="8" height="160" fill="#111"/></svg>`,
      probe: (svg) => line('borda esquerda', referenceError(sampleLine(36, 20, 36, 180, 4), chainsOf(svg)), geometricAcceptance.line.maxPx),
    },
    {
      name: 'reta diagonal',
      w: 160,
      h: 120,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#fff"/><polygon points="20,100 140,20 140,100" fill="#111"/></svg>`,
      probe: (svg) => line('hipotenusa', referenceError(sampleLine(20, 100, 140, 20, 3), chainsOf(svg)), geometricAcceptance.line.maxPx),
    },
    {
      name: 'círculo 480 px',
      w: 480,
      h: 480,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><rect width="480" height="480" fill="#fff"/><circle cx="240" cy="240" r="150" fill="#111"/></svg>`,
      probe: (svg) => {
        const stats = referenceError(sampleCircle(240, 240, 150, 6), chainsOf(svg));
        return `${meetsCircle(stats.maxPx, stats.hausdorffPx) ? 'DENTRO' : 'FORA'} — círculo: máx ${stats.maxPx} px, limite ${geometricAcceptance.circle.maxRadiusPx} px`;
      },
    },
    {
      name: 'elipse',
      w: 200,
      h: 120,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#fff"/><ellipse cx="100" cy="60" rx="70" ry="36" fill="#111"/></svg>`,
      probe: (svg) => {
        const stats = referenceError(sampleEllipse(100, 60, 70, 36, 6), chainsOf(svg));
        const ok = stats.maxPx <= geometricAcceptance.ellipse.maxRadialPx;
        return `${ok ? 'DENTRO' : 'FORA'} — elipse: máx ${stats.maxPx} px, limite ${geometricAcceptance.ellipse.maxRadialPx} px`;
      },
    },
    {
      name: 'arco',
      w: 160,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#fff"/><path d="M30 70 A 50 50 0 0 1 130 70" fill="none" stroke="#111" stroke-width="6"/></svg>`,
      probe: (svg) => {
        const stats = referenceError(sampleArc(80, 70, 50, 180, 0, 5), chainsOf(svg));
        const ok = stats.maxPx <= geometricAcceptance.arc.maxPx;
        return `${ok ? 'DENTRO' : 'FORA'} — arco: máx ${stats.maxPx} px, limite ${geometricAcceptance.arc.maxPx} px`;
      },
    },
    {
      name: 'retângulo de cantos retos',
      w: 160,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#fff"/><rect x="30" y="24" width="100" height="52" fill="#111"/></svg>`,
      probe: (svg) => {
        const reconstructed = chainsOf(svg);
        const corners = [
          { x: 30, y: 24 },
          { x: 130, y: 24 },
          { x: 130, y: 76 },
          { x: 30, y: 76 },
        ];
        const stats = referenceError(corners, reconstructed);
        const ok = stats.maxPx <= geometricAcceptance.corner.positionPx;
        return `${ok ? 'DENTRO' : 'FORA'} — cantos: máx ${stats.maxPx} px, limite ${geometricAcceptance.corner.positionPx} px`;
      },
    },
    {
      name: 'retângulo arredondado',
      w: 160,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#fff"/><rect x="24" y="22" width="112" height="56" rx="12" fill="#111"/></svg>`,
      probe: (svg) => {
        const census = pathCensus(svg);
        return `medido — caminhos ${census.pathCount}, comandos ${census.commandCount}, laços ${census.closedLoops}`;
      },
    },
    {
      name: 'curva orgânica',
      w: 200,
      h: 120,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#fff"/><path d="M30 80 C 50 20, 90 20, 110 60 C 130 100, 160 90, 180 40" fill="none" stroke="#111" stroke-width="5"/></svg>`,
      probe: (svg) => {
        const continuity = continuityOfPath(joinD(svg));
        const ok = continuity.unintendedG1Breaks === 0;
        return `${ok ? 'DENTRO' : 'FORA'} — G1 involuntário ${continuity.unintendedG1Breaks}, maior quina suave ${continuity.maxSmoothTurnDeg}°, limite ${geometricAcceptance.continuity.unintendedG1Deg}°`;
      },
    },
    {
      name: 'letra com serifa',
      w: 120,
      h: 90,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#fff"/><path d="M52 16 h10 v40 h-10 z M40 56 h34 v6 h-34 z" fill="#111"/></svg>`,
      probe: (svg) => `aparência — caminhos ${pathCensus(svg).pathCount}. A cobertura desta letra no contrato anterior é IoU 1 no OpenCV; a escolha pode ser o outro candidato.`,
    },
    {
      name: 'letra sem serifa',
      w: 80,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"><rect width="80" height="100" fill="#fff"/><rect x="34" y="12" width="12" height="76" fill="#111"/></svg>`,
      probe: (svg) => line('haste', referenceError(sampleLine(34, 12, 34, 88, 4), chainsOf(svg)), geometricAcceptance.line.maxPx),
    },
    {
      name: 'traço 1 px',
      w: 160,
      h: 40,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"><rect width="160" height="40" fill="#fff"/><rect x="10" y="20" width="140" height="1" fill="#111"/></svg>`,
      probe: (svg) => line('eixo', referenceError(sampleLine(10, 20.5, 150, 20.5, 4), chainsOf(svg)), geometricAcceptance.coverage.hausdorffDetailPx),
    },
    {
      name: 'traço 2 px',
      w: 160,
      h: 40,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"><rect width="160" height="40" fill="#fff"/><rect x="10" y="19" width="140" height="2" fill="#111"/></svg>`,
      probe: (svg) => line('eixo', referenceError(sampleLine(10, 20, 150, 20, 4), chainsOf(svg)), geometricAcceptance.coverage.hausdorffDetailPx),
    },
    {
      name: 'traço 3 px',
      w: 160,
      h: 40,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"><rect width="160" height="40" fill="#fff"/><rect x="10" y="18" width="140" height="3" fill="#111"/></svg>`,
      probe: (svg) => line('borda superior', referenceError(sampleLine(10, 18, 150, 18, 4), chainsOf(svg)), geometricAcceptance.line.maxPx),
    },
    {
      name: 'furo',
      w: 140,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#fff"/><path d="M30 78 L70 16 L110 78 Z" fill="#2563eb"/><circle cx="70" cy="52" r="10" fill="#fff"/></svg>`,
      probe: (svg) => {
        const holes = (svg.match(/fill-rule="evenodd"/g) ?? []).length;
        const ok = holes >= 1;
        return `${ok ? 'DENTRO' : 'FORA'} — evenodd ${holes}, o contrato exige o furo no caminho`;
      },
    },
    {
      name: 'contorno preto espesso',
      w: 160,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#fff"/><rect x="28" y="22" width="104" height="56" fill="none" stroke="#111" stroke-width="8"/></svg>`,
      probe: (svg) => {
        const census = pathCensus(svg);
        return `medido — caminhos ${census.pathCount}, comandos ${census.commandCount}, abertos ${census.openSubpaths}`;
      },
    },
    {
      name: 'degradê',
      w: 180,
      h: 80,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80"><rect width="180" height="80" fill="#fff"/><defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#0f172a"/><stop offset="100%" stop-color="#e2e8f0"/></linearGradient></defs><rect x="16" y="18" width="148" height="44" fill="url(#s)"/></svg>`,
      probe: (svg) => `${/<linearGradient/.test(svg) ? 'DENTRO' : 'FORA'} — linearGradient. A aparência não substitui a reta da borda.`,
    },
    {
      name: 'ouro',
      w: 180,
      h: 120,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect width="180" height="120" fill="#f8fafc"/><defs><radialGradient id="g" cx="36%" cy="32%" r="70%"><stop offset="0%" stop-color="#fff4c4"/><stop offset="50%" stop-color="#d4a017"/><stop offset="100%" stop-color="#5c3b09"/></radialGradient></defs><ellipse cx="90" cy="60" rx="52" ry="34" fill="url(#g)"/></svg>`,
      probe: (svg) => {
        const stats = referenceError(sampleEllipse(90, 60, 52, 34, 8), chainsOf(svg));
        const ok = stats.maxPx <= geometricAcceptance.ellipse.maxRadialPx;
        return `${ok ? 'DENTRO' : 'FORA'} — elipse do ouro: máx ${stats.maxPx} px. Gradiente ${/<radialGradient|<linearGradient/.test(svg) ? 'presente' : 'ausente'}.`;
      },
    },
    {
      name: 'prata',
      w: 180,
      h: 80,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80"><rect width="180" height="80" fill="#fff"/><defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#374151"/><stop offset="48%" stop-color="#f8fafc"/><stop offset="100%" stop-color="#6b7280"/></linearGradient></defs><rect x="20" y="18" width="140" height="44" fill="url(#p)"/></svg>`,
      probe: (svg) => line('tampa', referenceError(sampleLine(20, 18, 160, 18, 4), chainsOf(svg)), geometricAcceptance.line.maxPx),
    },
  ];

  for (const spec of specs) {
    const { result, ms } = await vector(spec.svg, spec.w, spec.h, spec.format);
    const q = result.qualityReport;
    const geometry = spec.probe(result.svg);
    const rasterFree = !/<image\b|feImage|data:image/i.test(result.svg);
    rows.push(`## ${spec.name}`);
    rows.push(`- Geometria: ${geometry}`);
    rows.push(`- Aparência: SSIM ${q?.ssimPct ?? '—'}, ΔE₀₀ ${q?.meanDeltaE2000 ?? q?.meanDeltaELab ?? '—'}, IoU ${q?.iouPct ?? '—'}, contorno ${q?.contourFidelityPct ?? '—'}.`);
    rows.push(`- Caminhos ${result.validation.pathCount}, ${ms} ms, ${result.engineUsed}, raster ${rasterFree ? 'ausente' : 'presente'}.`);
    rows.push('');
  }

  const birdSource = readFileSync(new URL('./test-winged-logo-fidelity.ts', import.meta.url), 'utf8');
  const birdSvg = birdSource.match(/return `([\s\S]*?)`;/)?.[1];
  assert.ok(birdSvg, 'logo do pássaro não encontrado');
  const bird = await vector(birdSvg, 600, 480);
  const birdContinuity = continuityOfPath(joinD(bird.result.svg));
  rows.push('## logo histórico do pássaro, 600×480');
  rows.push(`- Geometria: G1 involuntário ${birdContinuity.unintendedG1Breaks}, cantos ${birdContinuity.corners}, comandos ${pathCensus(bird.result.svg).commandCount}.`);
  rows.push(`- Aparência: SSIM ${bird.result.qualityReport?.ssimPct ?? '—'}, ΔE₀₀ ${bird.result.qualityReport?.meanDeltaE2000 ?? '—'}, IoU ${bird.result.qualityReport?.iouPct ?? '—'}.`);
  rows.push(`- ${bird.ms} ms, ${bird.result.engineUsed}, caminhos ${bird.result.validation.pathCount}.`);
  rows.push('');
  rows.push('O pipeline atual foi medido contra o contrato. Esta etapa não o declara aprovado.');

  const report = rows.join('\n');
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  writeFileSync('/opt/cursor/artifacts/contrato-geometrico.md', report);
  console.log(report);
  assert.ok(report.includes('reta horizontal 720 px'));
  assert.ok(report.includes('logo histórico do pássaro'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
