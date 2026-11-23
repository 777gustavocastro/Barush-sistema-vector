import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import { runVectorizationOnRgba, type RawRgbaImage, type VectorizationParameters } from '../src/engine';

const params: VectorizationParameters = {
  profile: 'logo_illustration',
  engine: 'auto',
  autoTune: false,
  colorCount: 32,
  detailPrecision: 94,
  curveSmoothness: 45,
  pathSimplification: 4,
  noiseRemoval: 0,
  contourSensitivity: 78,
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

function sample(svg: string, scale: number, w: number, h: number, x: number, y: number) {
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: Math.round(w * scale) } }).render();
  const sx = Math.min(rendered.width - 1, Math.round(x * scale));
  const sy = Math.min(rendered.height - 1, Math.round(y * scale));
  const i = (sy * rendered.width + sx) * 4;
  const a = rendered.pixels[i + 3] || 1;
  return [
    Math.round((rendered.pixels[i] * 255) / a),
    Math.round((rendered.pixels[i + 1] * 255) / a),
    Math.round((rendered.pixels[i + 2] * 255) / a),
    rendered.pixels[i + 3],
  ] as const;
}

function near(px: readonly number[], rgb: [number, number, number], tol: number) {
  return Math.max(Math.abs(px[0] - rgb[0]), Math.abs(px[1] - rgb[1]), Math.abs(px[2] - rgb[2])) <= tol;
}

async function main() {
  const w = 180;
  const h = 120;
  const bg: [number, number, number] = [15, 23, 42];
  const red: [number, number, number] = [239, 68, 68];
  const blue: [number, number, number] = [37, 99, 235];
  const gold: [number, number, number] = [234, 179, 8];
  const white: [number, number, number] = [248, 250, 252];
  const black: [number, number, number] = [2, 6, 23];

  const image = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" fill="#0f172a"/>
      <rect x="0" y="0" width="90" height="${h}" fill="#ef4444"/>
      <rect x="90" y="0" width="90" height="${h}" fill="#2563eb"/>
      <circle cx="46" cy="36" r="16" fill="#020617"/>
      <circle cx="46" cy="36" r="22" fill="#f8fafc"/>
      <circle cx="46" cy="36" r="16" fill="#020617"/>
      <circle cx="46" cy="36" r="7" fill="#0f172a"/>
      <circle cx="136" cy="78" r="16" fill="#020617"/>
      <circle cx="136" cy="78" r="9" fill="#eab308"/>
      <circle cx="120" cy="28" r="14" fill="#22c55e" fill-opacity="0.5"/>
    </svg>`,
    w,
    h
  );

  const result = await runVectorizationOnRgba(image, params);
  assert.equal(result.validation.hasEmbeddedRaster, false);
  assert.ok(result.validation.pathCount <= 14, `regiões demais ${result.validation.pathCount}`);
  assert.match(result.svg, /M 90 0 L 180 0 L 180 120 L 90 120 Z/);
  assert.match(result.svg, /M 90 0 L 90 120 L 0 120 L 0 0 Z/);
  const relations = result.sceneGraph?.regionRelations ?? [];
  assert.ok(relations.some((node) => node.role === 'background'));
  assert.ok(relations.filter((node) => node.touchesBackground).length >= 2);
  assert.ok((result.sceneGraph?.topologySummary.sharedCanonicalBoundaries ?? 0) > 0);

  const probes: Array<[number, number, [number, number, number]]> = [
    [24, 96, red],
    [150, 96, blue],
    [46, 36, bg],
    [136, 78, gold],
    [136, 66, black],
    [28, 36, white],
  ];

  for (const scale of [4, 8, 16]) {
    for (const [x, y, rgb] of probes) {
      const px = sample(result.svg, scale, w, h, x, y);
      assert.ok(near(px, rgb, 28), `zoom ${scale * 100}% (${x},${y}) ${px} != ${rgb}`);
    }
    const overlap = sample(result.svg, scale, w, h, 120, 28);
    assert.ok(overlap[1] > blue[1] + 20, `transparência perdida no zoom ${scale * 100}% ${overlap}`);
  }

  console.log('fronteiras: ok', {
    caminhos: result.validation.pathCount,
    fronteiras: result.sceneGraph?.topologySummary.sharedCanonicalBoundaries,
    furos: result.sceneGraph?.topologySummary.interiorHolesPreserved,
    regioes: relations.length,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
