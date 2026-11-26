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

function render(svg: string, width: number): { data: Uint8Array; width: number; height: number } {
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render();
  const src = rendered.pixels;
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const alpha = src[i + 3];
    out[i + 3] = alpha;
    if (alpha === 0) continue;
    out[i] = Math.min(255, Math.round((src[i] * 255) / alpha));
    out[i + 1] = Math.min(255, Math.round((src[i + 1] * 255) / alpha));
    out[i + 2] = Math.min(255, Math.round((src[i + 2] * 255) / alpha));
  }
  return { data: out, width: rendered.width, height: rendered.height };
}

function px(view: { data: Uint8Array; width: number }, x: number, y: number): [number, number, number, number] {
  const i = (y * view.width + x) * 4;
  return [view.data[i], view.data[i + 1], view.data[i + 2], view.data[i + 3]];
}

function isBlue(rgb: [number, number, number, number]): boolean {
  return rgb[2] > 160 && rgb[2] > rgb[0] + 40 && rgb[1] < 160;
}

function isWhite(rgb: [number, number, number, number]): boolean {
  return rgb[0] > 220 && rgb[1] > 220 && rgb[2] > 220;
}

function isBlack(rgb: [number, number, number, number]): boolean {
  return rgb[0] < 50 && rgb[1] < 50 && rgb[2] < 50;
}

function assertVector(svg: string): void {
  assert.equal(/<image\b|feImage|data:image/i.test(svg), false);
}

async function main() {
  const closed = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#fff"/><path d="M30 78 L70 16 L110 78 Z" fill="#2563eb"/><circle cx="70" cy="52" r="10" fill="#fff"/></svg>`,
    140,
    100
  );
  const closedResult = await runVectorizationOnRgba(closed, params);
  assertVector(closedResult.svg);
  assert.match(closedResult.svg, /fill-rule="evenodd"/);
  assert.ok((closedResult.pipelineAudit?.topology.holes ?? 0) >= 1, 'furo formal ausente');
  const closedView = render(closedResult.svg, 140);
  assert.equal(isWhite(px(closedView, 70, 52)), true, 'furo circular foi preenchido');
  assert.equal(isBlue(px(closedView, 70, 30)), true, 'o triângulo perdeu tinta');
  for (const scale of [4, 8, 16]) {
    const view = render(closedResult.svg, 140 * scale);
    assert.equal(isWhite(px(view, 70 * scale, 52 * scale)), true, `furo sumiu em ${scale * 100}%`);
    assert.equal(isBlue(px(view, 48 * scale, 60 * scale)), true, `vazou azul em ${scale * 100}%`);
  }

  const many = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#fff"/><rect x="20" y="20" width="100" height="60" fill="#2563eb"/><circle cx="50" cy="50" r="8" fill="#fff"/><circle cx="90" cy="50" r="8" fill="#fff"/></svg>`,
    140,
    100
  );
  const manyResult = await runVectorizationOnRgba(many, params);
  assertVector(manyResult.svg);
  assert.ok((manyResult.pipelineAudit?.topology.holes ?? 0) >= 2, `furos múltiplos ${manyResult.pipelineAudit?.topology.holes}`);
  const manyView = render(manyResult.svg, 140);
  assert.equal(isWhite(px(manyView, 50, 50)), true, 'primeiro furo preenchido');
  assert.equal(isWhite(px(manyView, 90, 50)), true, 'segundo furo preenchido');
  assert.equal(isBlue(px(manyView, 70, 50)), true, 'a faixa entre os furos sumiu');

  const irregular = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#fff"/><rect x="24" y="18" width="92" height="64" fill="#111827"/><path d="M50 40 L70 34 L78 52 L60 64 L46 52 Z" fill="#fff"/></svg>`,
    140,
    100
  );
  const irregularResult = await runVectorizationOnRgba(irregular, params);
  assertVector(irregularResult.svg);
  const irregularView = render(irregularResult.svg, 140);
  assert.equal(isWhite(px(irregularView, 62, 48)), true, 'furo irregular preenchido');
  assert.equal(isBlack(px(irregularView, 30, 30)), true, 'o bloco ao redor do furo sumiu');

  const small = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="90"><rect width="140" height="90" fill="#fff"/><rect x="16" y="16" width="108" height="58" fill="#2563eb"/><circle cx="112" cy="28" r="5" fill="#fff"/></svg>`,
    140,
    90
  );
  const smallView = render((await runVectorizationOnRgba(small, params)).svg, 140);
  assert.equal(isWhite(px(smallView, 112, 28)), true, 'furo pequeno perto da borda foi fechado');
  assert.equal(isBlue(px(smallView, 100, 28)), true, 'a borda comeu o retângulo');

  const tangent = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#ffffff"/><path d="M30 70 L70 18 L110 70 Z" fill="#2563eb"/><circle cx="70" cy="58" r="12" fill="#ffffff"/></svg>`,
    140,
    100
  );
  const tangentResult = await runVectorizationOnRgba(tangent, params);
  assertVector(tangentResult.svg);
  const tangentView = render(tangentResult.svg, 140);
  assert.equal(isWhite(px(tangentView, 70, 54)), true, 'o recorte branco sumiu');
  assert.equal(isBlue(px(tangentView, 100, 66)), true, 'a base do triângulo vazou branco');
  assert.equal(isBlue(px(tangentView, 40, 66)), true, 'o outro lado da base vazou');

  const overlap = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#fff"/><rect x="16" y="16" width="70" height="48" fill="#2563eb"/><circle cx="78" cy="40" r="18" fill="#ef4444"/></svg>`,
    120,
    80
  );
  const overlapView = render((await runVectorizationOnRgba(overlap, params)).svg, 120);
  const red = px(overlapView, 78, 40);
  assert.ok(red[0] > 180 && red[2] < 120, `o círculo vermelho foi coberto ${red}`);
  assert.equal(isBlue(px(overlapView, 30, 30)), true, 'o retângulo azul sumiu sob o círculo');

  const adjacent = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="60" height="60" fill="#ef4444"/><rect x="60" y="0" width="60" height="60" fill="#2563eb"/></svg>`,
    120,
    60
  );
  const adjacentView = render((await runVectorizationOnRgba(adjacent, params)).svg, 120);
  const left = px(adjacentView, 50, 30);
  const right = px(adjacentView, 70, 30);
  assert.ok(left[0] > 180 && left[2] < 100, `vazou azul na esquerda ${left}`);
  assert.equal(isBlue(right), true, `vazou vermelho na direita ${right}`);

  const concave = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="#fff"/><path d="M20 16 h18 v28 h28 v16 h-46 z" fill="#111"/></svg>`,
    100,
    80
  );
  const concaveView = render((await runVectorizationOnRgba(concave, params)).svg, 100);
  assert.equal(isBlack(px(concaveView, 28, 30)), true, 'a haste da concavidade sumiu');
  assert.equal(isWhite(px(concaveView, 55, 30)), true, 'a concavidade foi preenchida');

  const parts = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="50"><rect width="120" height="50" fill="#fff"/><rect x="16" y="16" width="20" height="18" fill="#111"/><rect x="80" y="16" width="20" height="18" fill="#111"/></svg>`,
    120,
    50
  );
  const partsView = render((await runVectorizationOnRgba(parts, params)).svg, 120);
  assert.equal(isBlack(px(partsView, 26, 25)), true, 'o primeiro bloco sumiu');
  assert.equal(isBlack(px(partsView, 90, 25)), true, 'o segundo bloco sumiu');
  assert.equal(isWhite(px(partsView, 60, 25)), true, 'os blocos foram ligados');

  const transparent: RawRgbaImage = {
    width: 100,
    height: 70,
    data: new Uint8Array(100 * 70 * 4),
    sourceFormat: 'png',
  };
  for (let y = 14; y < 56; y++) {
    for (let x = 18; x < 82; x++) {
      const dx = x - 50;
      const dy = y - 35;
      if (dx * dx + dy * dy < 8 * 8) continue;
      const i = (y * 100 + x) * 4;
      transparent.data[i] = 37;
      transparent.data[i + 1] = 99;
      transparent.data[i + 2] = 235;
      transparent.data[i + 3] = 255;
    }
  }
  const transparentResult = await runVectorizationOnRgba(transparent, params);
  assertVector(transparentResult.svg);
  const transparentView = render(transparentResult.svg, 100);
  assert.equal(isBlue(px(transparentView, 24, 20)), true, 'o retângulo transparente perdeu tinta');
  assert.ok(px(transparentView, 50, 35)[3] < 40, `o furo transparente foi pintado ${px(transparentView, 50, 35)}`);

  console.log('furos: ok', {
    furosFechados: closedResult.pipelineAudit?.topology.holes,
    furosMultiplos: manyResult.pipelineAudit?.topology.holes,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
