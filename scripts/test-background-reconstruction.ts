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
  detailPrecision: 92,
  curveSmoothness: 50,
  pathSimplification: 8,
  noiseRemoval: 0,
  contourSensitivity: 70,
  optimizeSvg: true,
  reconstructGradients: true,
  enhanceTypography: false,
  subpixelUpscale: false,
};

async function fromSvg(svg: string, w: number, h: number): Promise<RawRgbaImage> {
  const png = await sharp(Buffer.from(svg)).resize(w, h).ensureAlpha().png().toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data), sourceFormat: 'png' };
}

function addNearBlackNoise(image: RawRgbaImage, amp: number): RawRgbaImage {
  const data = new Uint8Array(image.data);
  let s = 17;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 36 || data[i + 1] > 36 || data[i + 2] > 36) continue;
    for (let c = 0; c < 3; c++) {
      s = (s * 1103515245 + 12345) >>> 0;
      const n = ((s % (amp * 2 + 1)) - amp);
      data[i + c] = Math.max(0, Math.min(40, data[i + c] + n));
    }
  }
  return { ...image, data };
}

function sample(svg: string, w: number, h: number, x: number, y: number): [number, number, number, number] {
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render();
  const px = rendered.pixels;
  const sx = Math.min(rendered.width - 1, Math.max(0, Math.round((x / w) * rendered.width)));
  const sy = Math.min(rendered.height - 1, Math.max(0, Math.round((y / h) * rendered.height)));
  const i = (sy * rendered.width + sx) * 4;
  const a = px[i + 3] || 1;
  return [
    Math.round((px[i] * 255) / a),
    Math.round((px[i + 1] * 255) / a),
    Math.round((px[i + 2] * 255) / a),
    a,
  ];
}

async function runCase(name: string, image: RawRgbaImage) {
  const result = await runVectorizationOnRgba(image, params);
  assert.equal(result.validation.hasEmbeddedRaster, false, name);
  assert.equal(/<image\b|data:image\/|;base64,/i.test(result.svg), false, name);
  return result;
}

async function main() {
  const w = 220;
  const h = 160;

  const black = addNearBlackNoise(
    await fromSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
        <rect width="${w}" height="${h}" fill="#050505"/>
        <circle cx="70" cy="80" r="36" fill="#ffffff"/>
        <circle cx="168" cy="48" r="5" fill="#eab308"/>
      </svg>`,
      w,
      h
    ),
    7
  );
  const blackRes = await runCase('preto', black);
  assert.ok(blackRes.validation.pathCount <= 8, `preto fragmentou: ${blackRes.validation.pathCount}`);
  assert.match(blackRes.svg, /caminho-fundo-1/);
  const blackPx = sample(blackRes.svg, w * 4, h * 4, 20, 20);
  assert.ok(Math.max(...blackPx.slice(0, 3)) <= 30, `fundo preto sujo ${blackPx}`);
  assert.match(blackRes.svg, /#fff|#ffffff/i);
  assert.match(blackRes.svg, /#eab|#facc|#fbbf|#eab308/i);

  const white = await fromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#ffffff"/><rect x="40" y="40" width="70" height="40" fill="#111111"/></svg>`,
    w,
    h
  );
  const whiteRes = await runCase('branco', white);
  assert.ok(whiteRes.validation.pathCount <= 4, `branco ${whiteRes.validation.pathCount}`);
  const whitePx = sample(whiteRes.svg, w * 4, h * 4, 8, 8);
  assert.ok(whitePx[0] >= 230 && whitePx[1] >= 230 && whitePx[2] >= 230, `branco ${whitePx}`);

  const gray = await fromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#8a8a8a"/><circle cx="110" cy="80" r="28" fill="#111827"/></svg>`,
    w,
    h
  );
  const grayRes = await runCase('cinza', gray);
  assert.ok(grayRes.validation.pathCount <= 4, `cinza ${grayRes.validation.pathCount}`);

  const gold = await fromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#c9a227"/><circle cx="110" cy="80" r="26" fill="#1e293b"/></svg>`,
    w,
    h
  );
  const goldRes = await runCase('dourado', gold);
  assert.ok(goldRes.validation.pathCount <= 4, `dourado ${goldRes.validation.pathCount}`);
  assert.match(goldRes.svg, /caminho-fundo-1/);

  const color = await fromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#1d4ed8"/><rect x="70" y="50" width="80" height="36" fill="#f8fafc"/></svg>`,
    w,
    h
  );
  const colorRes = await runCase('colorido', color);
  assert.ok(colorRes.validation.pathCount <= 4, `colorido ${colorRes.validation.pathCount}`);

  const gradient = await fromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0ea5e9"/><stop offset="1" stop-color="#1e1b4b"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
    w,
    h
  );
  const gradRes = await runCase('gradiente', gradient);
  assert.ok(gradRes.validation.pathCount <= 6, `gradiente fragmentou ${gradRes.validation.pathCount}`);
  assert.match(gradRes.svg, /linearGradient|radialGradient/i);

  const transparent = await fromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><circle cx="110" cy="80" r="40" fill="#22c55e"/></svg>`,
    w,
    h
  );
  const trRes = await runCase('transparente', transparent);
  assert.equal(/caminho-fundo-1/.test(trRes.svg), false);
  assert.ok(trRes.validation.pathCount <= 3, `transparente ${trRes.validation.pathCount}`);
  const hole = sample(trRes.svg, w, h, 8, 8);
  assert.ok(hole[3] < 20, `transparência preenchida ${hole}`);

  const texture = await fromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="100%" height="100%" fill="#111"/>
      ${Array.from({ length: 12 }, (_, row) =>
        Array.from({ length: 16 }, (_, col) =>
          (row + col) % 2 === 0
            ? `<rect x="${col * 14}" y="${row * 14}" width="14" height="14" fill="#e5e7eb"/>`
            : ''
        ).join('')
      ).join('')}
    </svg>`,
    w,
    h
  );
  const texRes = await runCase('textura', texture);
  const texDark = sample(texRes.svg, w, h, 4, 4);
  const texLight = sample(texRes.svg, w, h, 18, 4);
  const texGap = Math.abs(texDark[0] - texLight[0]) + Math.abs(texDark[1] - texLight[1]) + Math.abs(texDark[2] - texLight[2]);
  assert.ok(texGap >= 180, `textura achatada gap=${texGap} paths=${texRes.validation.pathCount}`);
  assert.ok(texRes.validation.pathCount <= 40, `textura fragmentada ${texRes.validation.pathCount}`);

  const shadow = await fromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="100%" height="100%" fill="#f4f4f5"/>
      <ellipse cx="124" cy="98" rx="48" ry="18" fill="#9ca3af"/>
      <circle cx="100" cy="70" r="28" fill="#ef4444"/>
    </svg>`,
    w,
    h
  );
  const shRes = await runCase('sombra', shadow);
  assert.ok(shRes.validation.pathCount <= 6, `sombra fragmentou ${shRes.validation.pathCount}`);
  assert.match(shRes.svg, /#9ca3af|#a1a1aa|#6b7280|#d4d4d8|#a3a3a3/i);

  const decor = await fromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="100%" height="100%" fill="#000000"/>
      <circle cx="40" cy="30" r="4" fill="#facc15"/>
      <circle cx="180" cy="120" r="3" fill="#38bdf8"/>
      <rect x="70" y="50" width="60" height="36" fill="#ffffff"/>
    </svg>`,
    w,
    h
  );
  const decRes = await runCase('decorativo', decor);
  assert.ok(decRes.validation.pathCount <= 8, `decorativo ${decRes.validation.pathCount}`);
  assert.match(decRes.svg, /#facc15|#eab308|#fde047/i);
  assert.match(decRes.svg, /#38bdf8|#0ea5e9|#7dd3fc/i);

  console.log('fundos: ok', {
    preto: blackRes.validation.pathCount,
    branco: whiteRes.validation.pathCount,
    cinza: grayRes.validation.pathCount,
    dourado: goldRes.validation.pathCount,
    colorido: colorRes.validation.pathCount,
    gradiente: gradRes.validation.pathCount,
    transparente: trRes.validation.pathCount,
    textura: texRes.validation.pathCount,
    sombra: shRes.validation.pathCount,
    decorativo: decRes.validation.pathCount,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
