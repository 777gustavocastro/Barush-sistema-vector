import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import {
  boundaryError,
  continuityOfPath,
  geometricAcceptance,
  maskIoU,
  sampleArc,
  sampleCircle,
} from '../src/engine/geometric/contract/geometricContract';
import { fitOrganicCurve, reconstructOrganic, sampleOrganic } from '../src/engine/geometric/curves';
import type { RawRgbaImage } from '../src/engine/types';

function cubic(p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, n: number) {
  const points = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    points.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return points;
}

async function rasterize(svg: string, width: number, height: number): Promise<RawRgbaImage> {
  const png = await sharp(Buffer.from(svg)).resize(width, height).ensureAlpha().png().toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data), sourceFormat: 'png' };
}

function render(svg: string, width: number, height: number): Uint8Array {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().pixels;
}

function foregroundIoU(reference: Uint8Array, candidate: Uint8Array, width: number, height: number) {
  const dark = (buf: Uint8Array, index: number) => buf[index * 4] < 245 || buf[index * 4 + 1] < 245 || buf[index * 4 + 2] < 245;
  return maskIoU(width, height, (x, y) => dark(reference, y * width + x), (x, y) => dark(candidate, y * width + x));
}

function zoomIoU(referenceSvg: string, candidateSvg: string, box: { x: number; y: number; w: number; h: number }, zoom: number) {
  const outW = Math.round(box.w * zoom);
  const outH = Math.round(box.h * zoom);
  const wrap = (svg: string) => {
    const inner = svg.replace(/^<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}">${inner}</svg>`;
  };
  return foregroundIoU(render(wrap(referenceSvg), outW, outH), render(wrap(candidateSvg), outW, outH), outW, outH);
}

async function main() {
  const lines: string[] = ['# Etapa 4 — Curvas orgânicas com Bézier', ''];

  const s = [
    ...cubic({ x: 30, y: 80 }, { x: 55, y: 18 }, { x: 90, y: 18 }, { x: 112, y: 62 }, 48),
    ...cubic({ x: 112, y: 62 }, { x: 134, y: 104 }, { x: 168, y: 92 }, { x: 186, y: 36 }, 48).slice(1),
  ];
  const sFit = fitOrganicCurve(s, { closed: false });
  assert.ok(sFit.spans.length <= 8, `curva em S usou ${sFit.spans.length} segmentos`);
  assert.ok(sFit.spans.length < s.length / 8, 'a curva em S acompanhou a polilinha');
  assert.equal(continuityOfPath(sFit.path).unintendedG1Breaks, 0);
  assert.ok(sFit.error.maxPx <= geometricAcceptance.organic.maxPx);
  assert.ok(sFit.error.meanPx <= geometricAcceptance.organic.meanPx);
  assert.ok(sFit.g1BreakDeg <= geometricAcceptance.continuity.unintendedG1Deg);

  const stair = s.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }));
  const stairFit = fitOrganicCurve(stair, { closed: false });
  const stairError = boundaryError(s, [sampleOrganic(stairFit)]);
  assert.ok(stairFit.spans.length < stair.length / 4, `degrau virou ${stairFit.spans.length} segmentos`);
  assert.equal(continuityOfPath(stairFit.path).unintendedG1Breaks, 0, 'o degrau reapareceu como quebra suave');
  assert.ok(stairError.hausdorffPx <= geometricAcceptance.organic.hausdorffPx, `degrau Hausdorff ${stairError.hausdorffPx}`);

  const arc = sampleArc(80, 70, 50, 200, 340, 3);
  const arcFit = fitOrganicCurve(arc, { closed: false });
  assert.ok(arcFit.spans.length <= 4, `arco usou ${arcFit.spans.length} cúbicas`);
  assert.ok(arcFit.error.maxPx <= geometricAcceptance.arc.maxPx);
  assert.ok(Math.hypot(arcFit.spans[0].p0.x - arc[0].x, arcFit.spans[0].p0.y - arc[0].y) <= geometricAcceptance.arc.endpointPx);
  const arcEnd = arcFit.spans[arcFit.spans.length - 1].p3;
  assert.ok(Math.hypot(arcEnd.x - arc[arc.length - 1].x, arcEnd.y - arc[arc.length - 1].y) <= geometricAcceptance.arc.endpointPx);

  const circleFit = fitOrganicCurve(sampleCircle(60, 60, 40, 3), { closed: true });
  assert.equal(circleFit.corners.length, 0, 'círculo ganhou cantos');
  assert.ok(circleFit.spans.length <= 8);
  assert.ok(circleFit.g1BreakDeg <= geometricAcceptance.continuity.unintendedG1Deg);
  assert.ok(circleFit.error.maxPx <= geometricAcceptance.organic.maxPx);
  assert.ok(circleFit.g2Ratio < 0.45, `G2 do círculo ${circleFit.g2Ratio}`);

  const dense: { x: number; y: number }[] = [];
  const rect = [
    { x: 20, y: 20 },
    { x: 90, y: 20 },
    { x: 90, y: 70 },
    { x: 20, y: 70 },
  ];
  for (let i = 0; i < 4; i++) {
    const a = rect[i];
    const b = rect[(i + 1) % 4];
    for (let t = 0; t < 1; t += 0.03) dense.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  const rectFit = fitOrganicCurve(dense, { closed: true });
  assert.equal(rectFit.corners.length, 4);
  assert.equal(rectFit.straight.filter(Boolean).length, 4);
  assert.ok(rectFit.error.maxPx <= geometricAcceptance.line.maxPx);
  assert.ok(continuityOfPath(rectFit.path).corners >= 4);

  const notch: { x: number; y: number }[] = [];
  const notchPoly = [
    { x: 16, y: 30 },
    { x: 70, y: 30 },
    { x: 70, y: 42 },
    { x: 78, y: 36 },
    { x: 86, y: 42 },
    { x: 86, y: 30 },
    { x: 150, y: 30 },
    { x: 150, y: 48 },
    { x: 16, y: 48 },
  ];
  for (let i = 0; i < notchPoly.length; i++) {
    const a = notchPoly[i];
    const b = notchPoly[(i + 1) % notchPoly.length];
    for (let t = 0; t < 1; t += 0.04) notch.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  const notchFit = fitOrganicCurve(notch, { closed: true });
  assert.ok(notchFit.corners.length >= 6, `a serifa/entalhe perdeu cantos: ${notchFit.corners.length}`);
  const notchError = boundaryError([...notchPoly, notchPoly[0]], [sampleOrganic(notchFit)]);
  assert.ok(notchError.maxPx <= geometricAcceptance.organic.maxPx, `entalhe ${notchError.maxPx} px`);

  lines.push('## Ajuste direto');
  lines.push('');
  lines.push(`- Curva em S: ${sFit.spans.length} cúbicas, erro máx ${sFit.error.maxPx} px, G1 ${sFit.g1BreakDeg}°.`);
  lines.push(`- Degrau da mesma curva: ${stair.length} pontos viraram ${stairFit.spans.length} segmentos, Hausdorff ${stairError.hausdorffPx} px, sem quebra G1.`);
  lines.push(`- Arco: ${arcFit.spans.length} cúbicas, erro máx ${arcFit.error.maxPx} px, extremos preservados.`);
  lines.push(`- Círculo fechado: ${circleFit.spans.length} cúbicas, G1 ${circleFit.g1BreakDeg}°, razão G2 ${circleFit.g2Ratio}.`);
  lines.push(`- Retângulo: ${rectFit.corners.length} cantos e ${rectFit.straight.filter(Boolean).length} retas.`);
  lines.push(`- Entalhe de serifa: ${notchFit.corners.length} cantos, erro máx ${notchError.maxPx} px.`);
  lines.push('');

  const sRibbon = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="120"><rect width="220" height="120" fill="#fff"/><path d="M30 78 C 58 18, 96 18, 118 64 C 140 108, 176 96, 196 34" fill="none" stroke="#111" stroke-width="8" stroke-linecap="round"/></svg>`;
  const wave = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="90"><rect width="220" height="90" fill="#fff"/><path d="M16 46 C 36 18, 56 18, 76 46 C 96 74, 116 74, 136 46 C 156 18, 176 18, 196 46" fill="none" stroke="#111" stroke-width="7" stroke-linecap="butt"/></svg>`;
  const lobe = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#fff"/><path d="${lobePath(80, 80)}" fill="#111"/></svg>`;
  const serif = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100"><rect width="120" height="100" fill="#fff"/><path d="M48 16 H72 V58 H88 V70 H72 V84 H48 V70 H32 V58 H48 Z" fill="#111"/></svg>`;
  const frame = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="130"><rect width="180" height="130" fill="#fff"/><rect x="22" y="18" width="136" height="94" fill="#111"/><rect x="38" y="34" width="104" height="62" fill="#fff"/></svg>`;
  const shared = sharedSvg();

  const cases = [
    ['curva em S', sRibbon, 220, 120, { x: 70, y: 20, w: 28, h: 24 }],
    ['onda', wave, 220, 90, { x: 90, y: 28, w: 24, h: 20 }],
    ['forma com concavidades', lobe, 160, 160, { x: 70, y: 28, w: 24, h: 24 }],
    ['letra com serifa', serif, 120, 100, { x: 28, y: 54, w: 20, h: 18 }],
    ['contorno preto', frame, 180, 130, { x: 18, y: 50, w: 16, h: 16 }],
    ['fronteira compartilhada', shared, 180, 110, { x: 78, y: 40, w: 20, h: 24 }],
  ] as const;

  lines.push('## Cenas rasterizadas');
  lines.push('');
  lines.push('| Caso | Primitiva | Cúbicas | Retas | Cantos | Furos | Erro máx | G1 | IoU |');
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|');

  const zoomRows: string[] = [];
  for (const [name, svg, width, height, box] of cases) {
    const image = await rasterize(svg, width, height);
    const result = reconstructOrganic(image);
    assert.equal(/<image\b|feImage|data:image/i.test(result.svg), false, `${name} contém raster`);
    const coverage = foregroundIoU(render(svg, width, height), render(result.svg, width, height), width, height);
    assert.ok(coverage.iou >= 0.96, `${name} IoU ${coverage.iou}`);
    const element = result.elements[0];
    assert.ok(element, `${name} não gerou geometria`);
    if (name === 'curva em S' || name === 'onda') {
      assert.ok(element.cubicCount >= 1 && element.cubicCount <= 48, `${name} cúbicas ${element.cubicCount}`);
      assert.ok(element.g1BreakDeg <= geometricAcceptance.continuity.unintendedG1Deg, `${name} G1 ${element.g1BreakDeg}`);
    }
    if (name === 'forma com concavidades') {
      assert.ok(element.cubicCount >= 3 && element.cubicCount <= 24, `concavidades em ${element.cubicCount} cúbicas`);
      assert.equal(element.holeCount, 0);
    }
    if (name === 'letra com serifa') {
      assert.ok(element.cornerCount >= 8, `serifa com ${element.cornerCount} cantos`);
      assert.ok(element.lineCount >= 8, 'as hastes da serifa foram curvadas');
    }
    if (name === 'contorno preto') {
      assert.ok(element.holeCount >= 1, 'o contorno fechou o vão interno');
      assert.ok(element.primitive !== null || element.lineCount >= 4, 'o contorno preto virou curva orgânica');
      assert.ok(element.cubicCount <= 4, `contorno com ${element.cubicCount} cúbicas`);
    }
    if (name === 'fronteira compartilhada') {
      assert.ok(result.sharedCurves >= 1, 'cada lado recebeu uma curva própria');
      assert.ok(result.elements.length >= 2);
    }
    const zooms = [1, 4, 8, 16, 32].map((zoom) => zoomIoU(svg, result.svg, box, zoom).iou);
    zooms.forEach((iou, index) => {
      assert.ok(iou >= 0.95, `${name} a ${[100, 400, 800, 1600, 3200][index]}% ficou com IoU ${iou}`);
    });
    zoomRows.push(`| ${name} | ${zooms.map((iou) => `${(iou * 100).toFixed(2)}%`).join(' | ')} |`);
    const summary = result.elements
      .map((item) => `${item.primitive ?? 'bezier'} / ${item.cubicCount} cúbicas`)
      .join('; ');
    lines.push(
      `| ${name} | ${summary} | ${element.cubicCount} | ${element.lineCount} | ${element.cornerCount} | ${element.holeCount} | ${element.errorMaxPx} | ${element.g1BreakDeg}° | ${(coverage.iou * 100).toFixed(2)}% |`
    );
  }

  lines.push('');
  lines.push('## Ampliação');
  lines.push('');
  lines.push('| Caso | 100% | 400% | 800% | 1600% | 3200% |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  lines.push(...zoomRows);
  lines.push('');
  lines.push('Cantos e serifas permaneceram âncoras. Degraus de pixel não voltaram como segmentos. O processador tipográfico e o pipeline antigo não foram alterados.');

  const report = lines.join('\n');
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  writeFileSync('/opt/cursor/artifacts/curvas-etapa04.md', report);
  console.log(report);
}

function lobePath(cx: number, cy: number): string {
  const points: string[] = [];
  for (let deg = 0; deg < 360; deg += 4) {
    const angle = (deg * Math.PI) / 180;
    const radius = 46 + 16 * Math.cos(3 * angle);
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M ${points[0]} L ${points.slice(1).join(' L ')} Z`;
}

function sharedSvg(): string {
  const left: string[] = ['12 18', '12 92'];
  const right: string[] = ['168 18', '168 92'];
  const waveDown: string[] = [];
  const waveUp: string[] = [];
  for (let y = 18; y <= 92; y += 2) {
    const x = 90 + 12 * Math.sin(((y - 18) / 74) * Math.PI * 2);
    waveDown.push(`${x.toFixed(2)} ${y}`);
    waveUp.push(`${x.toFixed(2)} ${y}`);
  }
  const leftPath = `M ${left[0]} L ${left[1]} L ${[...waveDown].reverse().join(' L ')} Z`;
  const rightPath = `M ${waveUp[0]} L ${waveUp.slice(1).join(' L ')} L ${right[1]} L ${right[0]} Z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="110"><rect width="180" height="110" fill="#fff"/><path d="${leftPath}" fill="#ea580c"/><path d="${rightPath}" fill="#1d4ed8"/></svg>`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
