import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import {
  runVectorizationOnRgba,
  type RawRgbaImage,
  type VectorizationParameters,
} from '../src/engine';

const params: VectorizationParameters = {
  profile: 'logo_illustration',
  engine: 'auto',
  autoTune: false,
  colorCount: 32,
  detailPrecision: 94,
  curveSmoothness: 40,
  pathSimplification: 4,
  noiseRemoval: 0,
  contourSensitivity: 80,
  optimizeSvg: true,
  reconstructGradients: true,
  enhanceTypography: false,
  subpixelUpscale: false,
};

async function fromSvg(svg: string, w: number, h: number, format: 'png' | 'jpeg' = 'png'): Promise<RawRgbaImage> {
  const pipeline = sharp(Buffer.from(svg)).resize(w, h).ensureAlpha();
  const png = await pipeline.png().toBuffer();
  const encoded =
    format === 'jpeg'
      ? await sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality: 60 }).toBuffer()
      : png;
  const { data, info } = await sharp(encoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data),
    sourceFormat: format === 'jpeg' ? 'jpeg' : 'png',
  };
}

function sample(svg: string, w: number, h: number, x: number, y: number): [number, number, number, number] {
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render();
  const px = rendered.pixels;
  const sx = Math.min(rendered.width - 1, Math.round(x));
  const sy = Math.min(rendered.height - 1, Math.round(y));
  const i = (sy * rendered.width + sx) * 4;
  const a = px[i + 3] || 1;
  return [
    Math.round((px[i] * 255) / a),
    Math.round((px[i + 1] * 255) / a),
    Math.round((px[i + 2] * 255) / a),
    px[i + 3],
  ];
}

async function main() {
  const w = 200;
  const h = 140;

  const noisy = await fromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="100%" height="100%" fill="#101010"/>
      <circle cx="70" cy="70" r="28" fill="#ffffff"/>
      <rect x="150" y="40" width="3" height="28" fill="#f8fafc"/>
      <circle cx="160" cy="100" r="3" fill="#eab308"/>
    </svg>`,
    w,
    h,
    'jpeg'
  );
  const noisyRes = await runVectorizationOnRgba(noisy, params);
  assert.equal(noisyRes.validation.hasEmbeddedRaster, false);
  assert.ok(noisyRes.validation.pathCount <= 12, `ruído virou objeto: ${noisyRes.validation.pathCount}`);
  const stroke = sample(noisyRes.svg, w, h, 151, 52);
  assert.ok(stroke[0] > 180, `traço fino removido ${stroke}`);
  const dot = sample(noisyRes.svg, w, h, 160, 100);
  assert.ok(dot[0] > 140 && dot[1] > 90, `símbolo pequeno removido ${dot}`);

  const ring = await fromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="100%" height="100%" fill="#ffffff"/>
      <circle cx="100" cy="70" r="40" fill="#111111"/>
      <circle cx="100" cy="70" r="16" fill="#ffffff"/>
    </svg>`,
    w,
    h
  );
  const ringRes = await runVectorizationOnRgba(ring, params);
  const hole = sample(ringRes.svg, w, h, 100, 70);
  assert.ok(hole[0] > 200 && hole[1] > 200, `abertura da letra fechada ${hole}`);
  assert.ok(ringRes.validation.pathCount <= 4, `anel fragmentado ${ringRes.validation.pathCount}`);

  const serif = await fromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="100%" height="100%" fill="#f8fafc"/>
      <rect x="40" y="40" width="16" height="70" fill="#1e293b"/>
      <rect x="28" y="40" width="40" height="3" fill="#1e293b"/>
      <rect x="28" y="107" width="40" height="3" fill="#1e293b"/>
    </svg>`,
    w,
    h
  );
  const serifRes = await runVectorizationOnRgba(serif, params);
  const serifPx = sample(serifRes.svg, w, h, 30, 41);
  assert.ok(serifPx[0] < 80, `serifa removida ${serifPx}`);

  const gradient = await fromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#312e81"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
    w,
    h
  );
  const gradRes = await runVectorizationOnRgba(gradient, params);
  assert.ok(gradRes.validation.pathCount <= 6, `gradiente fragmentado ${gradRes.validation.pathCount}`);

  const transparent = await fromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><circle cx="80" cy="70" r="24" fill="#22c55e"/></svg>`,
    w,
    h
  );
  const tr = await runVectorizationOnRgba(transparent, params);
  const empty = sample(tr.svg, w, h, 8, 8);
  assert.ok(empty[3] < 30, `transparência preenchida ${empty}`);

  const texture = await fromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      ${Array.from({ length: 10 }, (_, row) =>
        Array.from({ length: 14 }, (_, col) =>
          `<rect x="${col * 16}" y="${row * 16}" width="16" height="16" fill="${(row + col) % 2 ? '#111827' : '#e5e7eb'}"/>`
        ).join('')
      ).join('')}
    </svg>`,
    w,
    h
  );
  const tex = await runVectorizationOnRgba(texture, params);
  const a = sample(tex.svg, w, h, 4, 4);
  const b = sample(tex.svg, w, h, 20, 4);
  const gap = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  assert.ok(gap > 160, `textura apagada ${gap}`);

  console.log('ruido: ok', {
    jpeg: noisyRes.validation.pathCount,
    anel: ringRes.validation.pathCount,
    serifa: serifRes.validation.pathCount,
    gradiente: gradRes.validation.pathCount,
    transparente: tr.validation.pathCount,
    textura: tex.validation.pathCount,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
