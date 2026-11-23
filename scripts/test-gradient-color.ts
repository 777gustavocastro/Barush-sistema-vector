import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { computeQualityComparisonFromBuffers } from '../src/engine/quality/qualityEvaluator';
import { runVectorizationOnRgba, type RawRgbaImage, type VectorizationParameters } from '../src/engine';

const params: VectorizationParameters = {
  profile: 'logo_illustration',
  engine: 'auto',
  autoTune: false,
  colorCount: 8,
  detailPrecision: 90,
  curveSmoothness: 42,
  pathSimplification: 6,
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

function render(svg: string, w: number, h: number): RawRgbaImage {
  writeFileSync('/tmp/gradient-scene.svg', svg);
  const run = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { readFileSync, writeFileSync } from 'node:fs';
       import { Resvg } from '@resvg/resvg-js';
       const svg = readFileSync('/tmp/gradient-scene.svg','utf8');
       const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: ${w} }, background: 'white' }).render();
       const out = Buffer.from(rendered.pixels.buffer, rendered.pixels.byteOffset, rendered.pixels.byteLength);
       for (let i = 0; i < out.length; i += 4) {
         const a = out[i + 3] || 1;
         out[i] = Math.round(out[i] * 255 / a);
         out[i + 1] = Math.round(out[i + 1] * 255 / a);
         out[i + 2] = Math.round(out[i + 2] * 255 / a);
       }
       writeFileSync('/tmp/gradient-scene.raw', out);
       writeFileSync('/tmp/gradient-scene.json', JSON.stringify({ width: rendered.width, height: rendered.height }));`,
    ],
    { cwd: '/workspace' }
  );
  if (run.status !== 0) throw new Error(run.stderr.toString() || 'raster do vetor falhou');
  const meta = JSON.parse(readFileSync('/tmp/gradient-scene.json', 'utf8')) as { width: number; height: number };
  const raw = readFileSync('/tmp/gradient-scene.raw');
  return {
    width: meta.width,
    height: meta.height,
    data: new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength),
    sourceFormat: 'png',
  };
}

async function main() {
  const w = 200;
  const h = 140;
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#f8fafc"/>
    <defs>
      <radialGradient id="ouro" cx="38%" cy="32%" r="68%">
        <stop offset="0%" stop-color="#fff6d0"/>
        <stop offset="26%" stop-color="#f6c445"/>
        <stop offset="64%" stop-color="#b8860b"/>
        <stop offset="100%" stop-color="#5a3908"/>
      </radialGradient>
      <linearGradient id="prata" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#374151"/>
        <stop offset="48%" stop-color="#f8fafc"/>
        <stop offset="100%" stop-color="#6b7280"/>
      </linearGradient>
    </defs>
    <ellipse cx="58" cy="46" rx="36" ry="30" fill="url(#ouro)"/>
    <rect x="112" y="22" width="72" height="26" fill="url(#prata)"/>
    <rect x="36" y="92" width="48" height="26" fill="#1e3a8a"/>
    <ellipse cx="60" cy="122" rx="30" ry="8" fill="#0f172a" fill-opacity="0.38"/>
  </svg>`;
  const image = await raster(source, w, h);
  const result = await runVectorizationOnRgba(image, params);
  const svg = result.svg;
  assert.equal(result.validation.hasEmbeddedRaster, false);
  assert.ok(!/<image\b|<feImage\b|data:image/i.test(svg));
  assert.ok(!/<filter\b/i.test(svg), 'filtro SVG no lugar de um preenchimento editável');
  assert.ok(/<linearGradient\b/i.test(svg), 'gradiente linear ausente');
  assert.ok(/<radialGradient\b/i.test(svg), 'gradiente radial ausente');
  const stops = svg.match(/<stop\b/gi)?.length ?? 0;
  assert.ok(stops >= 4, `stops insuficientes: ${stops}`);
  assert.ok(result.validation.pathCount <= 12, `cada tom virou objeto: ${result.validation.pathCount} caminhos`);
  assert.ok(/data-transicao="(?:linear|radial|reflexo|brilho|complexa)"/.test(svg), svg.slice(0, 400));
  assert.ok(/data-transicao="solida"/.test(svg), 'o bloco azul deixou de ser cor sólida');
  const rendered = render(svg, w, h);
  const shadow = (122 * rendered.width + 60) * 4;
  const square = (104 * rendered.width + 50) * 4;
  assert.ok(rendered.data[square + 2] > rendered.data[square] + 20, 'o bloco azul vazou');
  const shadowPx = [rendered.data[shadow], rendered.data[shadow + 1], rendered.data[shadow + 2]];
  const squarePx = [rendered.data[square], rendered.data[square + 1], rendered.data[square + 2]];
  const shadowLum = shadowPx[0] + shadowPx[1] + shadowPx[2];
  const squareLum = squarePx[0] + squarePx[1] + squarePx[2];
  assert.ok(shadowLum > squareLum + 40 && shadowLum < 620, `sombra ${shadowPx.join(',')}`);
  assert.ok(Math.abs(shadowPx[0] - shadowPx[1]) < 40, 'a sombra herdou o azul do bloco');
  const quality = computeQualityComparisonFromBuffers(image, rendered);
  assert.ok(quality.ssimPct >= 90, `SSIM ${quality.ssimPct}`);
  assert.ok((quality.meanDeltaE2000 ?? 99) <= 6, `ΔE00 ${quality.meanDeltaE2000}`);
  assert.ok((quality.gradientContinuityPct ?? 0) >= 70, `continuidade ${quality.gradientContinuityPct}`);

  console.log('gradientes: ok', {
    caminhos: result.validation.pathCount,
    stops,
    ssim: quality.ssimPct,
    deltaE: quality.meanDeltaE2000,
    continuidade: quality.gradientContinuityPct,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
