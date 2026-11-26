import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
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

async function raster(svg: string, w: number, h: number): Promise<RawRgbaImage> {
  const png = await sharp(Buffer.from(svg)).resize(w, h).ensureAlpha().png().toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data), sourceFormat: 'png' };
}

function sample(svg: string, w: number, x: number, y: number): [number, number, number] {
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render();
  const sx = Math.min(rendered.width - 1, x);
  const sy = Math.min(rendered.height - 1, y);
  const i = (sy * rendered.width + sx) * 4;
  const a = rendered.pixels[i + 3] || 1;
  return [
    Math.round((rendered.pixels[i] * 255) / a),
    Math.round((rendered.pixels[i + 1] * 255) / a),
    Math.round((rendered.pixels[i + 2] * 255) / a),
  ];
}

function luma(rgb: [number, number, number]): number {
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

async function main() {
  const steep = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="80"><rect width="140" height="80" fill="#ffffff"/><defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#0f172a"/><stop offset="100%" stop-color="#e2e8f0"/></linearGradient></defs><rect x="16" y="18" width="108" height="44" fill="url(#s)"/></svg>`,
    140,
    80
  );
  const steepResult = await runVectorizationOnRgba(steep, params);
  assert.equal(steepResult.validation.hasEmbeddedRaster, false);
  const steepRegions = steepResult.pipelineAudit?.segmentation.find((row) => row.stage === 'D-consolidacao')?.regions ?? 99;
  assert.ok(steepRegions <= 2, `rampa íngreme em ${steepRegions} regiões`);
  assert.match(steepResult.svg, /linearGradient/);
  assert.ok(steepResult.qualityReport && steepResult.qualityReport.ssimPct >= 97, `SSIM rampa ${steepResult.qualityReport?.ssimPct}`);
  const dark = luma(sample(steepResult.svg, 140, 24, 40));
  const mid = luma(sample(steepResult.svg, 140, 70, 40));
  const light = luma(sample(steepResult.svg, 140, 112, 40));
  assert.ok(dark < mid && mid < light, `rampa não é contínua ${dark} ${mid} ${light}`);

  const gold = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#f8fafc"/><defs><radialGradient id="g" cx="36%" cy="32%" r="70%"><stop offset="0%" stop-color="#fff4c4"/><stop offset="50%" stop-color="#d4a017"/><stop offset="100%" stop-color="#5c3b09"/></radialGradient></defs><ellipse cx="70" cy="50" rx="40" ry="28" fill="url(#g)"/></svg>`,
    140,
    100
  );
  const goldResult = await runVectorizationOnRgba(gold, params);
  const goldRegions = goldResult.pipelineAudit?.segmentation.find((row) => row.stage === 'D-consolidacao')?.regions ?? 99;
  assert.ok(goldRegions <= 2, `ouro em ${goldRegions} regiões`);
  assert.match(goldResult.svg, /radialGradient|linearGradient/);
  assert.equal(/<image\b|feImage|data:image/i.test(goldResult.svg), false);
  const shine = luma(sample(goldResult.svg, 140, 58, 40));
  const rim = luma(sample(goldResult.svg, 140, 96, 62));
  assert.ok(shine > rim + 25, `brilho do ouro deslocado ${shine} ${rim}`);

  const flats = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="60" height="60" fill="#ef4444"/><rect x="60" width="60" height="60" fill="#2563eb"/></svg>`,
    120,
    60
  );
  const flatsResult = await runVectorizationOnRgba(flats, params);
  const left = sample(flatsResult.svg, 120, 20, 30);
  const right = sample(flatsResult.svg, 120, 90, 30);
  assert.ok(left[0] > 180 && left[2] < 120, `vermelho fundido ${left}`);
  assert.ok(right[2] > 160 && right[0] < 120, `azul fundido ${right}`);

  const shadow = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#f8fafc"/><rect x="28" y="28" width="48" height="32" fill="#94a3b8"/><rect x="18" y="16" width="48" height="32" fill="#2563eb"/></svg>`,
    120,
    80
  );
  const shadowResult = await runVectorizationOnRgba(shadow, params);
  const body = sample(shadowResult.svg, 120, 36, 30);
  const shade = sample(shadowResult.svg, 120, 62, 50);
  assert.ok(body[2] > shade[2] + 30, `sombra colada no objeto ${body} ${shade}`);

  console.log('tons: ok', {
    rampa: steepRegions,
    ssim: steepResult.qualityReport?.ssimPct,
    ouro: goldRegions,
    brilho: Math.round(shine),
    borda: Math.round(rim),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
