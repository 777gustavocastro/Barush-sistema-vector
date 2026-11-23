import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { fitClosedConic, fitSchneiderOpenCurve } from '../src/engine/geometry/schneiderCurveFitter';
import { runVectorizationOnRgba, type RawRgbaImage, type VectorizationParameters } from '../src/engine';

const params: VectorizationParameters = {
  profile: 'logo_illustration',
  engine: 'auto',
  autoTune: false,
  colorCount: 8,
  detailPrecision: 92,
  curveSmoothness: 45,
  pathSimplification: 4,
  noiseRemoval: 0,
  contourSensitivity: 80,
  optimizeSvg: true,
  reconstructGradients: false,
  enhanceTypography: true,
  subpixelUpscale: false,
};

function semicircle(samples = 48): { x: number; y: number }[] {
  const pts: Point2D[] = [];
  for (let i = 0; i <= samples; i++) {
    const a = Math.PI - (i / samples) * Math.PI;
    pts.push({ x: 40 + 22 * Math.cos(a), y: 30 + 22 * Math.sin(a) });
  }
  return pts;
}

async function raster(svg: string, w: number, h: number): Promise<RawRgbaImage> {
  const png = await sharp(Buffer.from(svg)).resize(w, h).ensureAlpha().png().toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data), sourceFormat: 'png' };
}

function render(svg: string, w: number): { data: Uint8Array; width: number; height: number } {
  writeFileSync('/tmp/geom-precision.svg', svg);
  const run = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { readFileSync, writeFileSync } from 'node:fs';
       import { Resvg } from '@resvg/resvg-js';
       const svg = readFileSync('/tmp/geom-precision.svg','utf8');
       const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: ${w} }, background: 'white' }).render();
       const out = Buffer.from(rendered.pixels.buffer, rendered.pixels.byteOffset, rendered.pixels.byteLength);
       for (let i = 0; i < out.length; i += 4) {
         const a = out[i + 3] || 1;
         out[i] = Math.round(out[i] * 255 / a);
         out[i + 1] = Math.round(out[i + 1] * 255 / a);
         out[i + 2] = Math.round(out[i + 2] * 255 / a);
       }
       writeFileSync('/tmp/geom-precision.raw', out);
       writeFileSync('/tmp/geom-precision.json', JSON.stringify({ width: rendered.width, height: rendered.height }));`,
    ],
    { cwd: '/workspace' }
  );
  if (run.status !== 0) throw new Error(run.stderr.toString() || 'raster do zoom falhou');
  const meta = JSON.parse(readFileSync('/tmp/geom-precision.json', 'utf8')) as { width: number; height: number };
  const raw = readFileSync('/tmp/geom-precision.raw');
  return { data: new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength), width: meta.width, height: meta.height };
}

function rgbAt(view: { data: Uint8Array; width: number }, x: number, y: number): [number, number, number] {
  const i = (y * view.width + x) * 4;
  return [view.data[i], view.data[i + 1], view.data[i + 2]];
}

async function main() {
  const arcPts = semicircle();
  const arc = fitSchneiderOpenCurve(arcPts, { maxErrorPx: 0.35, precision: 3 });
  const arcCurves = (arc.match(/\bC\s/g) ?? []).length;
  const arcLines = (arc.match(/\bL\s/g) ?? []).length;
  assert.ok(arcCurves >= 1 && arcCurves <= 4, `arco virou polilinha C=${arcCurves} L=${arcLines} ${arc}`);
  assert.equal(arcLines, 0);
  assert.ok(arc.includes('18') && arc.includes('62'), `extremidades do arco sumiram ${arc}`);

  const parabola: { x: number; y: number }[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const mt = 1 - t;
    const p0 = { x: 4, y: 30 };
    const p1 = { x: 24, y: 4 };
    const p2 = { x: 44, y: 30 };
    parabola.push({
      x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
      y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    });
  }
  const quad = fitSchneiderOpenCurve(parabola, { maxErrorPx: 0.2, precision: 3 });
  assert.ok((quad.match(/\bQ\s/g) ?? []).length === 1, `parábola não ficou quadrática: ${quad}`);
  assert.equal((quad.match(/\bL\s/g) ?? []).length, 0);

  const ellipse: { x: number; y: number }[] = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    ellipse.push({ x: 50 + 28 * Math.cos(a), y: 40 + 14 * Math.sin(a) });
  }
  const conic = fitClosedConic(ellipse, 3);
  assert.ok(conic && (conic.match(/\bC\s/g) ?? []).length === 4, `elipse não é cônica: ${conic}`);
  assert.ok(conic && !/\bL\s/.test(conic));

  const w = 180;
  const h = 150;
  const image = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" fill="#ffffff"/>
      <rect x="18" y="28" width="78" height="36" fill="#1d4ed8"/>
      <circle cx="84" cy="46" r="16" fill="#b91c1c"/>
      <circle cx="132" cy="40" r="18" fill="none" stroke="#111111" stroke-width="4"/>
      <path d="M24 92 h8 v22 h-8 z M20 114 h16 v4 h-16 z" fill="#111111"/>
      <rect x="48" y="96" width="2" height="22" fill="#111111"/>
      <rect x="62" y="96" width="2" height="22" fill="#111111"/>
      <path d="M100 110 C 112 86 128 86 140 110" fill="none" stroke="#0f766e" stroke-width="3"/>
    </svg>`,
    w,
    h
  );
  const result = await runVectorizationOnRgba(image, params);
  assert.equal(result.validation.hasEmbeddedRaster, false);
  assert.ok(!/font-family\s*=/.test(result.svg), 'a tipografia foi substituída por uma fonte');
  const paths = [...result.svg.matchAll(/<path\b([^>]*)>/g)].map((m) => m[1]);
  const circleLike = paths.filter((attrs) => (attrs.match(/\bC\s/g) ?? []).length >= 4 && (attrs.match(/\bL\s/g) ?? []).length <= 2);
  assert.ok(circleLike.length >= 1, 'círculo reconstruído como polígono');

  const view = render(result.svg, w * 4);
  const blue = rgbAt(view, 30 * 4, 46 * 4);
  const red = rgbAt(view, 84 * 4, 46 * 4);
  const under = rgbAt(view, 96 * 4, 30 * 4);
  assert.ok(blue[2] > blue[0] + 30, `retângulo de trás sumiu ${blue}`);
  assert.ok(red[0] > red[2] + 30, `círculo da frente não cobre o centro ${red}`);
  assert.ok(blue[2] > 80 || under[2] > under[0], `parte oculta do retângulo não foi preservada ${under}`);

  const stem = rgbAt(view, 28 * 4, 104 * 4);
  const foot = rgbAt(view, 22 * 4, 116 * 4);
  assert.ok(stem[0] < 80 && foot[0] < 80, `serifa ou haste perdida stem=${stem} foot=${foot}`);

  const gap = rgbAt(view, 55 * 4, 106 * 4);
  const leftThin = rgbAt(view, 49 * 4, 106 * 4);
  const rightThin = rgbAt(view, 63 * 4, 106 * 4);
  assert.ok(leftThin[0] < 90 && rightThin[0] < 90 && gap[0] > 180, `letras finas foram unidas ou engrossadas ${leftThin} ${gap} ${rightThin}`);

  console.log('geometria: ok', {
    caminhos: result.validation.pathCount,
    arcos: arcCurves,
    conicas: circleLike.length,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
