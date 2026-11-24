import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { maskIoU } from '../src/engine/geometric/contract/geometricContract';
import {
  boundaryDistancePx,
  computeSignedDistanceField,
  reconstructStructure,
  type StructureReconstruction,
} from '../src/engine/geometric/structure';
import type { RawRgbaImage } from '../src/engine/types';

async function rasterize(svg: string, width: number, height: number): Promise<RawRgbaImage> {
  const png = await sharp(Buffer.from(svg)).resize(width, height).ensureAlpha().png().toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data), sourceFormat: 'png' };
}

function render(svg: string, width: number, height: number): Uint8Array {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().pixels;
}

function foregroundIoU(reference: Uint8Array, candidate: Uint8Array, width: number, height: number) {
  const dark = (buf: Uint8Array, index: number) => {
    const i4 = index * 4;
    return buf[i4] < 245 || buf[i4 + 1] < 245 || buf[i4 + 2] < 245;
  };
  return maskIoU(
    width,
    height,
    (x, y) => dark(reference, y * width + x),
    (x, y) => dark(candidate, y * width + x)
  );
}

function zoomIoU(
  referenceSvg: string,
  candidateSvg: string,
  box: { x: number; y: number; w: number; h: number },
  zoom: number
) {
  const outW = Math.round(box.w * zoom);
  const outH = Math.round(box.h * zoom);
  const wrap = (svg: string) => {
    const inner = svg.replace(/^<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}">${inner}</svg>`;
  };
  return foregroundIoU(render(wrap(referenceSvg), outW, outH), render(wrap(candidateSvg), outW, outH), outW, outH);
}

function paintOn(shapeSvg: string, width: number, height: number, page: string): Uint8Array {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${page}"/>${shapeSvg}</svg>`;
  return render(svg, width, height);
}

function isRed(pixels: Uint8Array, index: number): boolean {
  const i4 = index * 4;
  return pixels[i4] > 180 && pixels[i4 + 1] < 90 && pixels[i4 + 2] < 110;
}

async function runCase(name: string, svg: string, width: number, height: number) {
  const image = await rasterize(svg, width, height);
  const structure = reconstructStructure(image);
  assert.equal(/<image\b|feImage|data:image/i.test(structure.svg), false, `${name}: raster no SVG`);
  const reference = render(svg, width, height);
  const candidate = render(structure.svg, width, height);
  const coverage = foregroundIoU(reference, candidate, width, height);
  return { structure, coverage, reference, candidate };
}

function sdfSelfCheck(): string[] {
  const width = 40;
  const height = 30;
  const mask = new Uint8Array(width * height);
  for (let y = 10; y < 22; y++) {
    for (let x = 8; x < 28; x++) mask[y * width + x] = 1;
  }
  const sdf = computeSignedDistanceField(mask, width, height);
  const center = sdf.values[16 * width + 18];
  const outside = sdf.values[0];
  assert.ok(center < -4, `centro do SDF deveria ser negativo e profundo, veio ${center}`);
  assert.ok(outside > 4, `exterior do SDF deveria ser positivo, veio ${outside}`);
  const boundary = sdf.values[10 * width + 18];
  assert.ok(Math.abs(boundary) <= 0.6, `borda do SDF deveria cruzar perto de zero, veio ${boundary}`);

  const other = new Uint8Array(width * height);
  for (let y = 10; y < 22; y++) {
    for (let x = 34; x < 39; x++) other[y * width + x] = 1;
  }
  const gap = boundaryDistancePx(mask, other, width, height);
  assert.ok(Math.abs(gap - 6) <= 1, `vão geométrico de 6 px medido como ${gap}`);
  const touching = new Uint8Array(width * height);
  for (let y = 10; y < 22; y++) touching[y * width + 28] = 1;
  const contact = boundaryDistancePx(mask, touching, width, height);
  assert.ok(contact <= 0.25, `regiões que se tocam mediram distância ${contact}`);
  return [
    `SDF: interior ${center.toFixed(2)} px, exterior ${outside.toFixed(2)} px, borda ${boundary.toFixed(2)} px.`,
    `Distância entre regiões: vão de 6 px medido em ${gap.toFixed(2)} px; contato em ${contact.toFixed(2)} px.`,
  ];
}

async function main() {
  const lines: string[] = [
    '# Etapa 3 — Traços, espessura, furos e preenchimentos',
    '',
    'O campo de distância assinado mede espessura e separação. O SVG final é geometria reconstruída, com traço somente quando a cobertura permanece equivalente.',
    '',
    ...sdfSelfCheck(),
    '',
  ];

  const solid = await runCase(
    'retângulo sólido',
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#fff"/><rect x="30" y="24" width="100" height="52" fill="#111"/></svg>`,
    160,
    100
  );
  assert.equal(solid.structure.elements[0]?.representation, 'fill', 'retângulo sólido não pode virar traço');
  assert.ok(solid.coverage.iou >= 0.96, `retângulo sólido IoU ${solid.coverage.iou}`);

  const taper = await runCase(
    'espessura variável',
    `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect width="180" height="120" fill="#fff"/><polygon points="16,58 150,36 150,92 16,70" fill="#111"/></svg>`,
    180,
    120
  );
  const taperElement = taper.structure.elements[0];
  assert.ok(taperElement, 'faixa variável ausente');
  assert.equal(taperElement.representation, 'fill', 'espessura variável não pode virar traço de largura única');
  assert.ok(taperElement.thickness.maxPx - taperElement.thickness.minPx > 8, 'perfil de espessura não preservou a variação');
  assert.equal(taperElement.thickness.withinContract, false);
  assert.ok(taper.coverage.iou >= 0.96, `faixa variável IoU ${taper.coverage.iou}`);

  const bar = await runCase(
    'faixa reta de espessura constante',
    `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="40"><rect width="220" height="40" fill="#fff"/><rect x="16" y="16" width="188" height="8" fill="#111"/></svg>`,
    220,
    40
  );
  assert.equal(bar.structure.elements[0]?.representation, 'stroke', 'faixa constante deveria ter traço equivalente');
  assert.equal(bar.structure.elements[0]?.thickness.withinContract, true);
  assert.ok(Math.abs(bar.structure.elements[0].thickness.medianPx - 8) <= 0.6);
  assert.ok(bar.coverage.iou >= 0.96, `faixa constante IoU ${bar.coverage.iou}`);

  const roundCapSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80"><rect width="180" height="80" fill="#fff"/><line x1="40" y1="40" x2="140" y2="40" stroke="#111" stroke-width="14" stroke-linecap="round"/></svg>`;
  const roundCap = await runCase('ponta arredondada', roundCapSvg, 180, 80);
  const roundRef = render(roundCapSvg, 180, 80);
  const roundCand = render(roundCap.structure.svg, 180, 80);
  let capRef = 0;
  let capHit = 0;
  for (let y = 30; y <= 50; y++) {
    for (let x = 30; x <= 39; x++) {
      const i4 = (y * 180 + x) * 4;
      if (roundRef[i4] < 200) {
        capRef++;
        if (roundCand[i4] < 200) capHit++;
      }
    }
  }
  assert.ok(capRef > 8, 'a ponta arredondada de referência não foi rasterizada');
  assert.ok(capHit / capRef >= 0.85, `ponta comida: recall ${capHit / capRef}`);

  const nubSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80"><rect width="180" height="80" fill="#fff"/><rect x="20" y="40" width="130" height="10" fill="#111"/><rect x="74" y="26" width="8" height="14" fill="#111"/></svg>`;
  const nub = await runCase('parte pequena', nubSvg, 180, 80);
  const nubRef = render(nubSvg, 180, 80);
  const nubCand = render(nub.structure.svg, 180, 80);
  let nubRefCount = 0;
  let nubHit = 0;
  for (let y = 26; y <= 39; y++) {
    for (let x = 74; x <= 81; x++) {
      const i4 = (y * 180 + x) * 4;
      if (nubRef[i4] < 200) {
        nubRefCount++;
        if (nubCand[i4] < 200) nubHit++;
      }
    }
  }
  assert.ok(nubHit / Math.max(1, nubRefCount) >= 0.85, `parte pequena perdida: recall ${nubHit / nubRefCount}`);
  assert.equal(nub.structure.elements[0]?.representation, 'fill', 'junção com parte pequena não pode ser um traço único');

  const thin1 = await runCase(
    'linha de 1 px',
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="30"><rect width="160" height="30" fill="#fff"/><rect x="8" y="14" width="144" height="1" fill="#111"/></svg>`,
    160,
    30
  );
  assert.ok(thin1.structure.elements.length >= 1, 'linha de 1 px desapareceu');
  assert.ok(thin1.coverage.recall >= 0.85, `linha de 1 px recall ${thin1.coverage.recall}`);

  const thin2 = await runCase(
    'linha de 2 px',
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="30"><rect width="160" height="30" fill="#fff"/><rect x="8" y="14" width="144" height="2" fill="#111"/></svg>`,
    160,
    30
  );
  assert.ok(thin2.coverage.recall >= 0.85, `linha de 2 px recall ${thin2.coverage.recall}`);
  assert.ok(thin2.coverage.iou >= 0.9, `linha de 2 px IoU ${thin2.coverage.iou}`);

  const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="#fff"/><rect x="24" y="20" width="152" height="110" fill="#111"/><rect x="42" y="38" width="116" height="74" fill="#1d4ed8"/></svg>`;
  const logo = await runCase('logo com contorno preto espesso', logoSvg, 200, 150);
  const black = logo.structure.elements.find((element) => element.fillHex === '#000000' || element.fillHex === '#111111');
  const blue = logo.structure.elements.find((element) => element.fillHex !== black?.fillHex);
  assert.ok(black && blue, `cores do logo não separadas: ${logo.structure.elements.map((element) => element.fillHex).join(', ')}`);
  assert.ok(black.holeCount >= 1, 'o contorno preto fechou o interior');
  assert.equal(black.thickness.withinContract, true, `espessura do contorno fora do contrato (${black.thickness.stdRatio}, viés ${black.thickness.maxBiasPx})`);
  assert.ok(Math.abs(black.thickness.medianPx - 18) <= 0.6, `espessura ${black.thickness.medianPx} px`);
  assert.ok(logo.coverage.iou >= 0.96, `logo IoU ${logo.coverage.iou}`);
  assert.ok(logo.structure.sharedEdges.length >= 1, 'fronteira compartilhada do contorno não foi canonizada');

  const whatsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="#fff"/><circle cx="90" cy="90" r="68" fill="#25D366"/><circle cx="74" cy="84" r="12" fill="#fff"/><circle cx="108" cy="84" r="12" fill="#fff"/><circle cx="91" cy="112" r="9" fill="#fff"/></svg>`;
  const whats = await runCase('ícone do WhatsApp', whatsSvg, 180, 180);
  const green = whats.structure.elements[0];
  assert.equal(green.representation, 'fill', 'o disco do ícone não pode ser substituído por traço');
  assert.equal(green.holeCount, 3, `contraformas do ícone: ${green.holeCount}`);
  assert.match(green.svg, /fill-rule="evenodd"/);
  const whatsRed = paintOn(whats.structure.shapeSvg, 180, 180, '#ff0033');
  for (const point of [
    { x: 74, y: 84 },
    { x: 108, y: 84 },
    { x: 91, y: 112 },
  ]) {
    assert.ok(isRed(whatsRed, point.y * 180 + point.x), `furo do ícone fechado em ${point.x},${point.y}`);
  }
  assert.ok(whats.coverage.iou >= 0.96, `ícone IoU ${whats.coverage.iou}`);

  const letterO = await runCase(
    'letra O',
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="140"><rect width="160" height="140" fill="#fff"/><circle cx="80" cy="70" r="48" fill="#111"/><circle cx="80" cy="70" r="30" fill="#fff"/></svg>`,
    160,
    140
  );
  assert.equal(letterO.structure.elements[0]?.holeCount, 1);
  assert.equal(letterO.structure.elements[0]?.thickness.withinContract, true);
  const letterORed = paintOn(letterO.structure.shapeSvg, 160, 140, '#ff0033');
  assert.ok(isRed(letterORed, 70 * 160 + 80), 'contraforma da letra O foi preenchida');
  if (letterO.structure.elements[0].pathD) {
    const nonzero = letterO.structure.elements[0].svg.replace('evenodd', 'nonzero');
    const nonzeroRed = paintOn(nonzero, 160, 140, '#ff0033');
    assert.ok(isRed(nonzeroRed, 70 * 160 + 80), 'orientação do furo quebra a regra nonzero');
  }

  const letterA = await runCase(
    'letra A',
    `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect width="180" height="120" fill="#fff"/><polygon points="50,100 90,18 130,100" fill="#111"/><polygon points="78,78 90,52 102,78" fill="#fff"/></svg>`,
    180,
    120
  );
  assert.equal(letterA.structure.elements[0]?.holeCount, 1, 'contraforma da letra A perdida');
  assert.equal(letterA.structure.elements[0]?.openCavityCount, 0);
  const letterARed = paintOn(letterA.structure.shapeSvg, 180, 120, '#ff0033');
  assert.ok(isRed(letterARed, 68 * 180 + 90), 'contraforma triangular foi fechada');

  const letterB = await runCase(
    'letra B',
    `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="130"><rect width="140" height="130" fill="#fff"/><rect x="28" y="16" width="82" height="96" fill="#111"/><circle cx="78" cy="42" r="14" fill="#fff"/><circle cx="78" cy="82" r="14" fill="#fff"/></svg>`,
    140,
    130
  );
  assert.equal(letterB.structure.elements[0]?.holeCount, 2, `letra B com ${letterB.structure.elements[0]?.holeCount} furos`);
  const letterBRed = paintOn(letterB.structure.shapeSvg, 140, 130, '#ff0033');
  assert.ok(isRed(letterBRed, 42 * 140 + 78) && isRed(letterBRed, 82 * 140 + 78), 'um furo da letra B foi fechado');

  const openC = await runCase(
    'forma aberta em C',
    `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="120"><rect width="150" height="120" fill="#fff"/><polygon points="24,20 120,20 120,38 48,38 48,82 120,82 120,100 24,100" fill="#111"/></svg>`,
    150,
    120
  );
  assert.equal(openC.structure.elements[0]?.holeCount, 0, 'abertura do C foi tratada como furo fechado');
  assert.ok((openC.structure.elements[0]?.openCavityCount ?? 0) >= 1, 'cavidade aberta não detectada');
  const openRed = paintOn(openC.structure.shapeSvg, 150, 120, '#ff0033');
  assert.ok(isRed(openRed, 60 * 150 + 90), 'a boca do C foi tampada');

  const cutout = await runCase(
    'símbolo com recorte aberto e furo fechado',
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#fff"/><polygon points="16,16 140,16 140,36 108,36 108,84 140,84 140,104 16,104" fill="#111"/><rect x="36" y="48" width="22" height="22" fill="#fff"/></svg>`,
    160,
    120
  );
  assert.ok((cutout.structure.elements[0]?.holeCount ?? 0) >= 1, 'furo fechado do símbolo sumiu');
  assert.ok((cutout.structure.elements[0]?.openCavityCount ?? 0) >= 1, 'recorte aberto foi confundido com furo');
  const cutoutRed = paintOn(cutout.structure.shapeSvg, 160, 120, '#ff0033');
  assert.ok(isRed(cutoutRed, 59 * 160 + 47), 'furo interno preenchido');
  assert.ok(isRed(cutoutRed, 60 * 160 + 124), 'recorte aberto preenchido');

  const sharedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="100"><rect width="180" height="100" fill="#fff"/><rect x="20" y="24" width="60" height="48" fill="#ea580c"/><rect x="80" y="24" width="60" height="48" fill="#1d4ed8"/></svg>`;
  const shared = await runCase('fronteira compartilhada', sharedSvg, 180, 100);
  assert.ok(shared.structure.sharedEdges.length >= 1, 'não houve aresta canônica');
  const edge = shared.structure.sharedEdges[0];
  assert.ok(Math.abs(edge.x1 - edge.x2) < 0.05, 'a fronteira compartilhada deixou de ser uma única reta');
  assert.ok(shared.coverage.iou >= 0.96, `fronteira IoU ${shared.coverage.iou}`);
  const seam = zoomIoU(sharedSvg, shared.structure.svg, { x: 76, y: 36, w: 8, h: 24 }, 8);
  assert.ok(seam.iou >= 0.96, `fresta na fronteira em 800%: IoU ${seam.iou}`);

  const zoomRows = [
    ['contorno preto', logoSvg, logo.structure, { x: 20, y: 48, w: 16, h: 16 }],
    ['letra O', `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="140"><rect width="160" height="140" fill="#fff"/><circle cx="80" cy="70" r="48" fill="#111"/><circle cx="80" cy="70" r="30" fill="#fff"/></svg>`, letterO.structure, { x: 76, y: 20, w: 12, h: 12 }],
    ['linha de 2 px', `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="30"><rect width="160" height="30" fill="#fff"/><rect x="8" y="14" width="144" height="2" fill="#111"/></svg>`, thin2.structure, { x: 40, y: 12, w: 16, h: 8 }],
    ['fronteira compartilhada', sharedSvg, shared.structure, { x: 76, y: 36, w: 8, h: 16 }],
  ] as const;

  lines.push('## Comparativo');
  lines.push('');
  lines.push('| Caso | Representação | Furos | Cavidades abertas | Espessura mediana | Contrato de espessura | IoU |');
  lines.push('|---|---|---:|---:|---:|---|---:|');
  const rows: Array<[string, { structure: StructureReconstruction; coverage: { iou: number } }]> = [
    ['Retângulo sólido', solid],
    ['Espessura variável', taper],
    ['Faixa constante de 8 px', bar],
    ['Ponta arredondada', roundCap],
    ['Parte pequena', nub],
    ['Linha de 1 px', thin1],
    ['Linha de 2 px', thin2],
    ['Logo com contorno preto', logo],
    ['Ícone do WhatsApp', whats],
    ['Letra O', letterO],
    ['Letra A', letterA],
    ['Letra B', letterB],
    ['Forma aberta em C', openC],
    ['Símbolo com recorte', cutout],
    ['Fronteira compartilhada', shared],
  ];
  for (const [name, result] of rows) {
    const elements = result.structure.elements.length > 0 ? result.structure.elements : [undefined];
    elements.forEach((element, index) => {
      const label = elements.length > 1 ? `${name} / ${element?.fillHex ?? index + 1}` : name;
      lines.push(
        `| ${label} | ${element?.summary ?? '—'} | ${element?.holeCount ?? 0} | ${element?.openCavityCount ?? 0} | ${element?.thickness.medianPx ?? '—'} px | ${element?.thickness.withinContract ? 'sim' : 'não'} | ${(result.coverage.iou * 100).toFixed(2)}% |`
      );
    });
  }

  lines.push('');
  lines.push('## Ampliação de 100% a 3200%');
  lines.push('');
  lines.push('| Caso | 100% | 400% | 800% | 1600% | 3200% |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const [name, referenceSvg, structure, box] of zoomRows) {
    const values = [1, 4, 8, 16, 32].map((zoom) => zoomIoU(referenceSvg, structure.svg, box, zoom).iou);
    values.forEach((iou, index) => {
      assert.ok(iou >= 0.95, `${name} em ${[100, 400, 800, 1600, 3200][index]}% ficou com IoU ${iou}`);
    });
    lines.push(`| ${name} | ${values.map((iou) => `${(iou * 100).toFixed(2)}%`).join(' | ')} |`);
  }

  lines.push('');
  lines.push('Nenhum preenchimento sólido foi reduzido a traço. Furos fechados seguem evenodd com orientação oposta à do contorno externo. Aberturas ligadas ao exterior não foram tampadas. O pipeline de produção e o processamento tipográfico não foram alterados.');

  const report = lines.join('\n');
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  writeFileSync('/opt/cursor/artifacts/estrutura-etapa03.md', report);
  console.log(report);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
