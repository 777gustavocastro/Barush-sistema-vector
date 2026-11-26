import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { runVectorizationOnRgba, type RawRgbaImage, type VectorizationParameters } from '../src/engine';

const params: VectorizationParameters = {
  profile: 'logo_illustration',
  engine: 'auto',
  autoTune: false,
  colorCount: 8,
  detailPrecision: 88,
  curveSmoothness: 42,
  pathSimplification: 8,
  noiseRemoval: 0,
  contourSensitivity: 76,
  optimizeSvg: true,
  reconstructGradients: false,
  enhanceTypography: false,
  subpixelUpscale: false,
};

const scales = [1, 2, 4, 8, 16, 32];

async function raster(svg: string, w: number, h: number): Promise<RawRgbaImage> {
  const png = await sharp(Buffer.from(svg)).resize(w, h).ensureAlpha().png().toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data), sourceFormat: 'png' };
}

function render(svg: string, width: number) {
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render();
  return { pixels: rendered.pixels, width: rendered.width, height: rendered.height };
}

function dark(view: { pixels: Uint8Array; width: number }, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= view.width) return false;
  const i = (y * view.width + x) * 4;
  const a = view.pixels[i + 3] || 1;
  const r = (view.pixels[i] * 255) / a;
  const g = (view.pixels[i + 1] * 255) / a;
  const b = (view.pixels[i + 2] * 255) / a;
  return r < 80 && g < 80 && b < 80;
}

function edgeY(view: { pixels: Uint8Array; width: number; height: number }, x: number): number | null {
  for (let y = 1; y < view.height; y++) {
    if (dark(view, x, y) !== dark(view, x, y - 1)) return y - 0.5;
  }
  return null;
}

async function main() {
  const diagonal = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100"><rect width="120" height="100" fill="#fff"/><polygon points="20,80 100,20 100,80" fill="#111"/></svg>`,
    120,
    100
  );
  const diagonalSvg = (await runVectorizationOnRgba(diagonal, params)).svg;
  assert.equal(/<image\b|feImage|data:image/i.test(diagonalSvg), false);
  const diagonalError: number[] = [];
  for (const scale of scales) {
    const view = render(diagonalSvg, 120 * scale);
    let worst = 0;
    for (let x = 30; x <= 90; x += 5) {
      const ideal = 80 - (x - 20) * 0.75;
      const found = edgeY(view, Math.round(x * scale));
      assert.ok(found !== null, `diagonal sem borda em ${scale * 100}%`);
      worst = Math.max(worst, Math.abs(found / scale - ideal));
    }
    diagonalError.push(Number(worst.toFixed(3)));
    const limit = scale >= 4 ? 0.2 : 1.05;
    assert.ok(worst <= limit, `diagonal ${scale * 100}% desvio ${worst.toFixed(3)} px`);
  }
  const fine = diagonalError.slice(2);
  const fineSpread = Math.max(...fine) - Math.min(...fine);
  assert.ok(fineSpread <= 0.12, `o zoom revelou a diagonal ${diagonalError.join(' / ')}`);

  const box = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#fff"/><rect x="30" y="20" width="60" height="40" fill="#111"/></svg>`,
    120,
    80
  );
  const boxSvg = (await runVectorizationOnRgba(box, params)).svg;
  const zoom = render(boxSvg, 120 * 32);
  assert.equal(dark(zoom, Math.round(31 * 32), Math.round(21 * 32)), true, 'canto interno sumiu em 3200%');
  assert.equal(dark(zoom, Math.round(28.5 * 32), Math.round(18.5 * 32)), false, 'canto arredondado em 3200%');
  const top = edgeY(zoom, Math.round(60 * 32));
  assert.ok(top !== null && Math.abs(top / 32 - 20) <= 0.75, `topo deslocado ${top}`);

  const circle = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#fff"/><circle cx="50" cy="50" r="28" fill="#111"/></svg>`,
    100,
    100
  );
  const circleSvg = (await runVectorizationOnRgba(circle, params)).svg;
  const circleView = render(circleSvg, 100 * 16);
  let radiusError = 0;
  for (let step = 0; step < 8; step++) {
    const angle = (step / 8) * Math.PI * 2;
    const sx = Math.round((50 + Math.cos(angle) * 10) * 16);
    const sy = Math.round((50 + Math.sin(angle) * 10) * 16);
    let radius = 10;
    while (radius < 40 && !dark(circleView, Math.round((50 + Math.cos(angle) * radius) * 16), Math.round((50 + Math.sin(angle) * radius) * 16))) {
      radius += 0.25;
    }
    while (radius < 40 && dark(circleView, Math.round((50 + Math.cos(angle) * radius) * 16), Math.round((50 + Math.sin(angle) * radius) * 16))) {
      radius += 0.25;
    }
    radiusError = Math.max(radiusError, Math.abs(radius - 28));
    assert.equal(dark(circleView, sx, sy), true, 'miolo do círculo sumiu');
  }
  assert.ok(radiusError <= 0.85, `círculo desvio ${radiusError.toFixed(2)} px`);

  console.log('zoom: ok', { diagonal: diagonalError, circulo: Number(radiusError.toFixed(3)) });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
