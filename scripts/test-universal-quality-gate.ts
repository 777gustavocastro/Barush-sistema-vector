import assert from 'node:assert/strict';
import sharp from 'sharp';
import { runVectorizationOnRgba, type RawRgbaImage, type VectorizationParameters } from '../src/engine';

const params: VectorizationParameters = {
  profile: 'logo_illustration',
  engine: 'auto',
  autoTune: false,
  colorCount: 10,
  detailPrecision: 86,
  curveSmoothness: 40,
  pathSimplification: 8,
  noiseRemoval: 0,
  contourSensitivity: 74,
  optimizeSvg: true,
  reconstructGradients: true,
  enhanceTypography: false,
  subpixelUpscale: false,
};

async function raster(svg: string, w: number, h: number): Promise<RawRgbaImage> {
  const png = await sharp(Buffer.from(svg)).resize(w, h).ensureAlpha().png().toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data), sourceFormat: 'png' };
}

async function main() {
  const cases: Array<{ name: string; svg: string; w: number; h: number; minSsim: number }> = [
    {
      name: 'fundo-preto',
      w: 120,
      h: 90,
      minSsim: 96,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#050505"/><circle cx="60" cy="45" r="18" fill="#f8fafc"/></svg>`,
    },
    {
      name: 'fundo-branco',
      w: 120,
      h: 90,
      minSsim: 96,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#ffffff"/><rect x="28" y="30" width="64" height="8" fill="#111111"/></svg>`,
    },
    {
      name: 'fundo-colorido',
      w: 120,
      h: 90,
      minSsim: 94,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#1d4ed8"/><path d="M60 22 L78 58 H42 Z" fill="#f8fafc"/></svg>`,
    },
    {
      name: 'transparent',
      w: 100,
      h: 80,
      minSsim: 90,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><circle cx="50" cy="40" r="16" fill="#e11d48"/></svg>`,
    },
    {
      name: 'ouro',
      w: 120,
      h: 90,
      minSsim: 90,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#f8fafc"/><defs><radialGradient id="g" cx="38%" cy="34%" r="70%"><stop offset="0%" stop-color="#fff4c4"/><stop offset="55%" stop-color="#d4a017"/><stop offset="100%" stop-color="#5c3b09"/></radialGradient></defs><ellipse cx="60" cy="45" rx="28" ry="22" fill="url(#g)"/></svg>`,
    },
    {
      name: 'serif',
      w: 100,
      h: 80,
      minSsim: 94,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="#ffffff"/><path d="M46 16 h8 v36 h-8 z M38 52 h24 v5 h-24 z" fill="#111111"/></svg>`,
    },
    {
      name: 'simbolo',
      w: 110,
      h: 90,
      minSsim: 94,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="110" height="90"><rect width="110" height="90" fill="#fff7ed"/><circle cx="55" cy="45" r="24" fill="none" stroke="#9a3412" stroke-width="4"/><path d="M55 28 v34 M38 45 h34" stroke="#9a3412" stroke-width="3"/></svg>`,
    },
    {
      name: 'gradiente',
      w: 120,
      h: 80,
      minSsim: 90,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#ffffff"/><defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#1e293b"/><stop offset="50%" stop-color="#e2e8f0"/><stop offset="100%" stop-color="#334155"/></linearGradient></defs><rect x="16" y="22" width="88" height="36" fill="url(#s)"/></svg>`,
    },
  ];

  const rows: string[] = [];
  for (const item of cases) {
    const image = await raster(item.svg, item.w, item.h);
    const result = await runVectorizationOnRgba(image, params);
    const gate = result.qualityGate;
    assert.ok(gate, `${item.name} sem relatório`);
    assert.equal(result.validation.hasEmbeddedRaster, false, item.name);
    assert.equal(gate.editability.hiddenRaster, false, item.name);
    assert.equal(gate.zoom.scales.length, 7, `${item.name} zoom`);
    assert.ok(gate.visualFidelity.ssimPct >= item.minSsim, `${item.name} SSIM ${gate.visualFidelity.ssimPct}`);
    assert.ok(gate.summary.length > 10, item.name);
    rows.push(
      `${item.name}: ${gate.approved ? 'aprovado' : 'revisão'} ${gate.confidence} SSIM ${gate.visualFidelity.ssimPct} ΔE ${gate.visualFidelity.deltaE2000} zoom ${gate.zoom.stable ? 'estável' : 'instável'}`
    );
  }
  console.log(rows.join('\n'));
  console.log('qualidade: ok', cases.length);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
