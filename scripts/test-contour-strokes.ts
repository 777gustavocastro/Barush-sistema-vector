import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { runVectorizationOnRgba, type RawRgbaImage, type VectorizationParameters } from '../src/engine';

const params: VectorizationParameters = {
  profile: 'logo_illustration',
  engine: 'auto',
  autoTune: false,
  colorCount: 8,
  detailPrecision: 92,
  curveSmoothness: 40,
  pathSimplification: 4,
  noiseRemoval: 0,
  contourSensitivity: 80,
  optimizeSvg: true,
  reconstructGradients: false,
  enhanceTypography: false,
  subpixelUpscale: false,
};

async function raster(svg: string, w: number, h: number): Promise<RawRgbaImage> {
  const png = await sharp(Buffer.from(svg)).resize(w, h).ensureAlpha().png().toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data), sourceFormat: 'png' };
}

function pixels(svg: string, scale: number, w: number): { data: Uint8Array; width: number; height: number } {
  const target = Math.round(w * scale);
  writeFileSync('/tmp/contour-zoom.svg', svg);
  const rendered = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { readFileSync, writeFileSync } from 'node:fs';
       import { Resvg } from '@resvg/resvg-js';
       const svg = readFileSync('/tmp/contour-zoom.svg','utf8');
       const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: ${target} } }).render();
       const out = Buffer.from(rendered.pixels.buffer, rendered.pixels.byteOffset, rendered.pixels.byteLength);
       for (let i = 0; i < out.length; i += 4) {
         const a = out[i + 3] || 1;
         out[i] = Math.round((out[i] * 255) / a);
         out[i + 1] = Math.round((out[i + 1] * 255) / a);
         out[i + 2] = Math.round((out[i + 2] * 255) / a);
       }
       writeFileSync('/tmp/contour-zoom.raw', out);
       writeFileSync('/tmp/contour-zoom.json', JSON.stringify({ width: rendered.width, height: rendered.height }));`,
    ],
    { cwd: '/workspace' }
  );
  if (rendered.status !== 0) {
    throw new Error(rendered.stderr.toString() || 'falha ao rasterizar o zoom');
  }
  const meta = JSON.parse(readFileSync('/tmp/contour-zoom.json', 'utf8')) as { width: number; height: number };
  const raw = readFileSync('/tmp/contour-zoom.raw');
  return { data: new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength), width: meta.width, height: meta.height };
}

function darkRun(buf: Uint8Array, w: number, h: number, x: number, y: number, vertical: boolean): number {
  const dark = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= w || py >= h) return false;
    const i = (py * w + px) * 4;
    return buf[i] < 80 && buf[i + 1] < 80 && buf[i + 2] < 80;
  };
  if (!dark(x, y)) return 0;
  let n = 1;
  for (let step = 1; step < 40; step++) {
    const px = vertical ? x : x - step;
    const py = vertical ? y - step : y;
    if (!dark(px, py)) break;
    n++;
  }
  for (let step = 1; step < 40; step++) {
    const px = vertical ? x : x + step;
    const py = vertical ? y + step : y;
    if (!dark(px, py)) break;
    n++;
  }
  return n;
}

async function main() {
  const w = 240;
  const h = 190;
  const image = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" fill="#ffffff"/>
      <rect x="16" y="24" width="70" height="4" fill="#111111"/>
      <circle cx="120" cy="46" r="24" fill="none" stroke="#111111" stroke-width="4"/>
      <circle cx="120" cy="108" r="18" fill="none" stroke="#111111" stroke-width="3"/>
      <circle cx="120" cy="108" r="10" fill="none" stroke="#111111" stroke-width="3"/>
      <rect x="20" y="70" width="36" height="36" fill="#111827"/>
      <path d="M16 132 V164 H44" fill="none" stroke="#111111" stroke-width="4" stroke-linecap="butt" stroke-linejoin="miter"/>
      <path d="M58 150 H80 M69 139 V161" fill="none" stroke="#111111" stroke-width="3" stroke-linecap="butt"/>
      <path d="M150 140 H176 L158 168" fill="none" stroke="#111111" stroke-width="3" stroke-linejoin="miter" stroke-linecap="butt"/>
      <path d="M196 132 H220 M216 132 L196 164" fill="none" stroke="#111111" stroke-width="3" stroke-linecap="butt"/>
    </svg>`,
    w,
    h
  );
  const result = await runVectorizationOnRgba(image, params);
  assert.equal(result.validation.hasEmbeddedRaster, false);
  const strokes = result.svg.match(/stroke-width="/g)?.length ?? 0;
  assert.ok(strokes >= 4, `traços contínuos insuficientes: ${strokes}`);
  assert.ok(!/non-scaling-stroke/.test(result.svg));
  assert.ok(result.validation.pathCount <= 20, `fragmentos ${result.validation.pathCount}`);
  const ds = [...result.svg.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]);
  const dupes = ds.length - new Set(ds).size;
  assert.equal(dupes, 0, `caminhos duplicados ${dupes}`);

  const thicknesses: number[] = [];
  for (const scale of [4, 8]) {
    const view = pixels(result.svg, scale, w);
    const bar = darkRun(view.data, view.width, view.height, Math.round(40 * scale), Math.round(26 * scale), true);
    const barPx = bar / scale;
    thicknesses.push(barPx);
    assert.ok(barPx >= 2.2 && barPx <= 6.5, `espessura da barra em ${scale * 100}% = ${barPx.toFixed(2)}`);
    const ring = darkRun(view.data, view.width, view.height, Math.round(120 * scale), Math.round(22 * scale), true);
    const ringPx = ring / scale;
    assert.ok(ringPx >= 2 && ringPx <= 7, `espessura do círculo em ${scale * 100}% = ${ringPx.toFixed(2)}`);
    const letter = darkRun(view.data, view.width, view.height, Math.round(16 * scale), Math.round(148 * scale), false);
    const letterPx = letter / scale;
    assert.ok(letterPx >= 2 && letterPx <= 7, `espessura da letra em ${scale * 100}% = ${letterPx.toFixed(2)}`);
  }
  assert.ok(Math.abs(thicknesses[0] - thicknesses[1]) <= 0.45, `espessura mudou com o zoom ${thicknesses.join(' / ')}`);

  const square = pixels(result.svg, 4, w);
  const inside = (Math.round(88 * 4) * square.width + Math.round(38 * 4)) * 4;
  assert.ok(square.data[inside] < 40, `quadrado preenchido virou oco ${square.data[inside]}`);

  console.log('contornos: ok', {
    caminhos: result.validation.pathCount,
    strokes,
    espessuraBarra: thicknesses.map((v) => Number(v.toFixed(2))),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
