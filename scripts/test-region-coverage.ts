import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import {
  measureStrokeCoverage,
  runVectorizationOnRgba,
  strokeCoversMask,
  type RawRgbaImage,
  type UniformContourStroke,
  type VectorizationParameters,
} from '../src/engine';
import { runVectorizationOnRgbaInternal } from '../src/engine/vectorizers/pipelineOrchestrator';

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
  writeFileSync('/tmp/coverage-zoom.svg', svg);
  const rendered = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { readFileSync, writeFileSync } from 'node:fs';
       import { Resvg } from '@resvg/resvg-js';
       const svg = readFileSync('/tmp/coverage-zoom.svg','utf8');
       const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: ${width} } }).render();
       const out = Buffer.from(rendered.pixels.buffer, rendered.pixels.byteOffset, rendered.pixels.byteLength);
       for (let i = 0; i < out.length; i += 4) {
         const a = out[i + 3] || 1;
         out[i] = Math.round((out[i] * 255) / a);
         out[i + 1] = Math.round((out[i + 1] * 255) / a);
         out[i + 2] = Math.round((out[i + 2] * 255) / a);
       }
       writeFileSync('/tmp/coverage-zoom.raw', out);
       writeFileSync('/tmp/coverage-zoom.json', JSON.stringify({ width: rendered.width, height: rendered.height }));`,
    ],
    { cwd: '/workspace' }
  );
  if (rendered.status !== 0) throw new Error(rendered.stderr.toString() || 'falha ao rasterizar');
  const meta = JSON.parse(readFileSync('/tmp/coverage-zoom.json', 'utf8')) as { width: number; height: number };
  const raw = readFileSync('/tmp/coverage-zoom.raw');
  return { data: new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength), width: meta.width, height: meta.height };
}

function dark(data: Uint8Array, w: number, x: number, y: number): boolean {
  if (x < 0 || y < 0) return false;
  const i = (y * w + x) * 4;
  return data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80;
}

function iouDark(orig: Uint8Array, next: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < orig.length; i += 4) {
    const a = orig[i] < 80 && orig[i + 1] < 80 && orig[i + 2] < 80;
    const b = next[i] < 80 && next[i + 1] < 80 && next[i + 2] < 80;
    if (a || b) union++;
    if (a && b) inter++;
  }
  return union === 0 ? 1 : inter / union;
}

function assertVector(svg: string, name: string): void {
  assert.equal(/<image\b|feImage|data:image/i.test(svg), false, `${name} contém raster`);
}

async function opencvSvg(image: RawRgbaImage): Promise<string> {
  const out = await runVectorizationOnRgbaInternal(image, params);
  const opencv = out.candidates.find((row) => row.engineKind === 'opencv_bezier_gradients');
  assert.ok(opencv, 'candidato OpenCV ausente');
  assertVector(opencv.svg, 'opencv');
  assertVector(out.result.svg, 'escolhido');
  return opencv.svg;
}

function syntheticGate(): void {
  const width = 40;
  const height = 30;
  const labels = new Int32Array(width * height);
  for (let y = 4; y < 24; y++) {
    for (let x = 16; x < 22; x++) labels[y * width + x] = 1;
  }
  for (let y = 20; y < 24; y++) {
    for (let x = 8; x < 30; x++) labels[y * width + x] = 1;
  }
  const broken: UniformContourStroke = {
    d: 'M 28 22 C 22 22 18 21 14 20 M 19 4 L 19 22 L 8 22',
    strokeWidth: 10,
    linecap: 'round',
    linejoin: 'round',
    miterlimit: 4,
  };
  const brokenCoverage = measureStrokeCoverage(labels, 1, width, height, broken);
  assert.equal(strokeCoversMask(brokenCoverage, broken.strokeWidth), false, `traço quebrado foi aceito ${JSON.stringify(brokenCoverage)}`);
  const bar = new Int32Array(width * height);
  for (let x = 4; x < 36; x++) {
    for (let y = 10; y < 14; y++) bar[y * width + x] = 2;
  }
  const uniform: UniformContourStroke = {
    d: 'M 4 12 L 36 12',
    strokeWidth: 4,
    linecap: 'butt',
    linejoin: 'miter',
    miterlimit: 4,
  };
  const uniformCoverage = measureStrokeCoverage(bar, 2, width, height, uniform);
  assert.equal(strokeCoversMask(uniformCoverage, uniform.strokeWidth), true, `traço uniforme recusado ${JSON.stringify(uniformCoverage)}`);
}

async function main() {
  syntheticGate();

  const letterSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#ffffff"/><path d="M52 16 h10 v40 h-10 z M40 56 h34 v6 h-34 z" fill="#111111"/></svg>`;
  const letter = await raster(letterSvg, 120, 90);
  const letterOut = await opencvSvg(letter);
  const letterView = render(letterOut, 120);
  const letterIou = iouDark(letter.data, letterView.data);
  assert.ok(letterIou >= 0.96, `letra com serifa IoU ${letterIou.toFixed(3)}`);
  assert.equal(/data-natureza="contorno"/.test(letterOut), false, 'a letra ainda foi substituída por traço');
  for (const scale of [4, 8, 16]) {
    const view = render(letterOut, 120 * scale);
    const sx = (x: number) => Math.round(x * scale);
    const sy = (y: number) => Math.round(y * scale);
    assert.equal(dark(view.data, view.width, sx(57), sy(30)), true, `haste sumiu em ${scale * 100}%`);
    assert.equal(dark(view.data, view.width, sx(70), sy(59)), true, `pé sumiu em ${scale * 100}%`);
    assert.equal(dark(view.data, view.width, sx(46), sy(30)), false, `concavidade preenchida em ${scale * 100}%`);
  }

  const sans = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"><rect width="80" height="100" fill="#fff"/><rect x="34" y="12" width="12" height="76" fill="#111"/></svg>`,
    80,
    100
  );
  const sansOut = await opencvSvg(sans);
  const sansIou = iouDark(sans.data, render(sansOut, 80).data);
  assert.ok(sansIou >= 0.96, `letra sem serifa IoU ${sansIou.toFixed(3)}`);

  const logo = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#fff"/><rect x="24" y="22" width="92" height="56" rx="8" fill="#111827"/></svg>`,
    140,
    100
  );
  const logoIou = iouDark(logo.data, render(await opencvSvg(logo), 140).data);
  assert.ok(logoIou >= 0.96, `logo IoU ${logoIou.toFixed(3)}`);

  const symbol = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100"><rect width="120" height="100" fill="#fff7ed"/><circle cx="60" cy="50" r="28" fill="none" stroke="#111" stroke-width="4"/><circle cx="60" cy="50" r="6" fill="#111"/></svg>`,
    120,
    100
  );
  const symbolOut = await opencvSvg(symbol);
  const symbolView = render(symbolOut, 120);
  assert.equal(dark(symbolView.data, symbolView.width, 60, 50), true, 'miolo do símbolo sumiu');
  assert.equal(dark(symbolView.data, symbolView.width, 60, 22), true, 'anel do símbolo sumiu');
  const zoomSymbol = render(symbolOut, 120 * 8);
  assert.equal(dark(zoomSymbol.data, zoomSymbol.width, 60 * 8, 50 * 8), true, 'miolo sumiu em 800%');

  const thin = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#fff"/><rect x="8" y="18" width="100" height="2" fill="#111"/></svg>`,
    120,
    40
  );
  const thinOut = await opencvSvg(thin);
  for (const scale of [4, 8, 16]) {
    const view = render(thinOut, 120 * scale);
    assert.equal(dark(view.data, view.width, Math.round(40 * scale), Math.round(19 * scale)), true, `linha fina sumiu em ${scale * 100}%`);
  }

  const dot = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><rect width="60" height="40" fill="#fff"/><rect x="28" y="18" width="4" height="4" fill="#111"/></svg>`,
    60,
    40
  );
  const dotView = render(await opencvSvg(dot), 60);
  let dotInk = 0;
  for (let i = 0; i < dotView.data.length; i += 4) {
    if (dotView.data[i] < 80) dotInk++;
  }
  assert.ok(dotInk >= 8, `ponto pequeno sumiu (${dotInk} px)`);

  const scene = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#ecfeff"/><circle cx="48" cy="50" r="26" fill="#0284c7"/><rect x="70" y="30" width="46" height="40" fill="#f59e0b"/><circle cx="92" cy="50" r="6" fill="#111"/></svg>`,
    140,
    100
  );
  const sceneView = render(await opencvSvg(scene), 140);
  assert.equal(dark(sceneView.data, sceneView.width, 92, 50), true, 'detalhe interno da ilustração sumiu');

  const transparent: RawRgbaImage = {
    width: 64,
    height: 48,
    data: new Uint8Array(64 * 48 * 4),
    sourceFormat: 'png',
  };
  for (let y = 16; y < 36; y++) {
    for (let x = 18; x < 42; x++) {
      const i = (y * 64 + x) * 4;
      transparent.data[i] = 20;
      transparent.data[i + 1] = 90;
      transparent.data[i + 2] = 200;
      transparent.data[i + 3] = 255;
    }
  }
  const transparentSvg = await opencvSvg(transparent);
  const transparentView = render(transparentSvg, 64);
  const corner = 2 * 64 * 4;
  const center = (26 * 64 + 30) * 4;
  assert.ok(transparentView.data[center + 2] > 140, 'bloco transparente não foi desenhado');
  assert.ok(transparentView.data[corner + 2] < 80, 'o vazio transparente foi pintado com a cor do bloco');

  const selected = await runVectorizationOnRgba(letter, params);
  assert.equal(selected.validation.hasEmbeddedRaster, false);
  console.log('cobertura: ok', { letra: Number(letterIou.toFixed(3)), sans: Number(sansIou.toFixed(3)), logo: Number(logoIou.toFixed(3)) });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
