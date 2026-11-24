import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import {
  continuityOfPath,
  flattenPath,
  geometricAcceptance,
  maskIoU,
  meetsCircle,
  meetsLine,
  pathCensus,
  referenceError,
  sampleArc,
  sampleCircle,
  sampleEllipse,
  sampleLine,
  type Point2D,
} from '../src/engine/geometric/contract/geometricContract';
import {
  describePrimitive,
  reconstructOpenChainPrimitive,
  reconstructScenePrimitives,
} from '../src/engine/geometric/primitives';
import {
  runVectorizationOnRgba,
  type RawRgbaImage,
  type VectorizationParameters,
} from '../src/engine';

const legacyParams: VectorizationParameters = {
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

async function rasterizeSvg(svg: string, w: number, h: number): Promise<RawRgbaImage> {
  const png = await sharp(Buffer.from(svg)).resize(w, h).ensureAlpha().png().toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data),
    sourceFormat: 'png',
  };
}

function chainsOfLegacySvg(svg: string): Point2D[][] {
  return [...svg.matchAll(/\bd="([^"]+)"/g)].flatMap((match) => flattenPath(match[1]));
}

function renderZoomIoU(
  refSvg: string,
  candSvg: string,
  baseW: number,
  baseH: number,
  zoomFactor: number,
  cropBox?: { x: number; y: number; w: number; h: number }
): { iou: number; recall: number; precision: number } {
  const box = cropBox ?? { x: 0, y: 0, w: baseW, h: baseH };
  const outW = Math.round(box.w * zoomFactor);
  const outH = Math.round(box.h * zoomFactor);

  const wrapCrop = (svg: string) => {
    const inner = svg.replace(/^<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}">${inner}</svg>`;
  };

  const refPix = new Resvg(wrapCrop(refSvg), { fitTo: { mode: 'width', value: outW } }).render().pixels;
  const candPix = new Resvg(wrapCrop(candSvg), { fitTo: { mode: 'width', value: outW } }).render().pixels;

  const isDark = (buf: Uint8Array, idx4: number) =>
    buf[idx4] < 200 || buf[idx4 + 1] < 200 || buf[idx4 + 2] < 200;

  return maskIoU(
    outW,
    outH,
    (x, y) => isDark(refPix, (y * outW + x) * 4),
    (x, y) => isDark(candPix, (y * outW + x) * 4)
  );
}

async function main() {
  const reportLines: string[] = [
    '# Etapa 2 — Motor de Reconstrução por Primitivas Geométricas (Comparativo)',
    '',
    'Comparação direta entre **Geometria original**, **Pipeline anterior** e **Novo motor de primitivas** sob os critérios da Etapa 1.',
    '',
  ];

  // 1. Testes unitários de cadeia aberta (reta, arco circular, arco elíptico e rejeição de curva orgânica)
  const openLinePts = sampleLine(10, 20, 210, 70, 2);
  const openLineRes = reconstructOpenChainPrimitive(openLinePts, '#111111', 2);
  assert.equal(openLineRes.accepted, true, 'reta aberta deveria ser aceita');
  assert.equal(openLineRes.primitive?.kind, 'line');
  assert.ok(openLineRes.svgElement?.startsWith('<line '), 'deveria emitir <line>');

  const openArcPts = sampleArc(100, 100, 60, 200, 340, 2);
  const openArcRes = reconstructOpenChainPrimitive(openArcPts, '#111111', 2);
  assert.equal(openArcRes.accepted, true, 'arco circular aberto deveria ser aceito');
  assert.equal(openArcRes.primitive?.kind, 'arc');
  assert.ok(openArcRes.svgElement?.includes(' A '), 'arco deveria emitir comando SVG A');

  const openEllipArcPts: Point2D[] = [];
  for (let deg = 190; deg <= 350; deg += 2) {
    const a = (deg * Math.PI) / 180;
    openEllipArcPts.push({ x: 100 + 75 * Math.cos(a), y: 100 + 38 * Math.sin(a) });
  }
  const openEllipArcRes = reconstructOpenChainPrimitive(openEllipArcPts, '#111111', 2);
  assert.equal(openEllipArcRes.accepted, true, 'arco elíptico aberto deveria ser aceito');
  assert.equal(openEllipArcRes.primitive?.kind, 'arc');

  const organicOpenPts: Point2D[] = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    organicOpenPts.push({ x: 20 + t * 160, y: 60 + 28 * Math.sin(t * Math.PI * 2) });
  }
  const organicOpenRes = reconstructOpenChainPrimitive(organicOpenPts, '#111111', 2);
  assert.equal(organicOpenRes.accepted, false, 'curva senoidal orgânica NÃO pode ser aceita como arco ou reta');

  reportLines.push('## Auto-checagem de cadeias abertas');
  reportLines.push(`- Reta aberta: ${describePrimitive(openLineRes.primitive)} (máx ${openLineRes.error.maxPx} px)`);
  reportLines.push(`- Arco circular aberto: ${describePrimitive(openArcRes.primitive)} (máx ${openArcRes.error.maxPx} px)`);
  reportLines.push(`- Arco elíptico aberto: ${describePrimitive(openEllipArcRes.primitive)} (máx ${openEllipArcRes.error.maxPx} px)`);
  reportLines.push(`- Curva orgânica aberta: REJEITADA corretamente (${organicOpenRes.reason})`);
  reportLines.push('');

  // 2. Bateria comparativa da Etapa 1 + formas adicionais (polígono côncavo, elipse rotacionada, retângulo rotacionado)
  interface BenchSpec {
    name: string;
    w: number;
    h: number;
    svg: string;
    referencePoints: Point2D[];
    limitPx: number;
    expectAccepted: boolean;
    expectedKinds?: string[];
    checkHole?: boolean;
  }

  const specs: BenchSpec[] = [
    {
      name: 'reta horizontal 720 px',
      w: 720,
      h: 80,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="80"><rect width="720" height="80" fill="#fff"/><rect x="40" y="36" width="640" height="8" fill="#111"/></svg>`,
      referencePoints: sampleLine(40, 36, 680, 36, 4),
      limitPx: geometricAcceptance.line.maxPx,
      expectAccepted: true,
      expectedKinds: ['rect', 'polygon'],
    },
    {
      name: 'reta vertical',
      w: 80,
      h: 200,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="200"><rect width="80" height="200" fill="#fff"/><rect x="36" y="20" width="8" height="160" fill="#111"/></svg>`,
      referencePoints: sampleLine(36, 20, 36, 180, 4),
      limitPx: geometricAcceptance.line.maxPx,
      expectAccepted: true,
      expectedKinds: ['rect', 'polygon'],
    },
    {
      name: 'reta diagonal (triângulo retângulo)',
      w: 160,
      h: 120,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#fff"/><polygon points="20,100 140,20 140,100" fill="#111"/></svg>`,
      referencePoints: sampleLine(20, 100, 140, 20, 3),
      limitPx: geometricAcceptance.line.maxPx,
      expectAccepted: true,
      expectedKinds: ['polygon'],
    },
    {
      name: 'círculo 480 px',
      w: 480,
      h: 480,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><rect width="480" height="480" fill="#fff"/><circle cx="240" cy="240" r="150" fill="#111"/></svg>`,
      referencePoints: sampleCircle(240, 240, 150, 4),
      limitPx: geometricAcceptance.circle.maxRadiusPx,
      expectAccepted: true,
      expectedKinds: ['circle'],
    },
    {
      name: 'elipse',
      w: 200,
      h: 120,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#fff"/><ellipse cx="100" cy="60" rx="70" ry="36" fill="#111"/></svg>`,
      referencePoints: sampleEllipse(100, 60, 70, 36, 4),
      limitPx: geometricAcceptance.ellipse.maxRadialPx,
      expectAccepted: true,
      expectedKinds: ['ellipse'],
    },
    {
      name: 'arco (faixa de 6 px — combinação de 2 arcos + 2 retas)',
      w: 160,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#fff"/><path d="M30 70 A 50 50 0 0 1 130 70" fill="none" stroke="#111" stroke-width="6"/></svg>`,
      referencePoints: sampleArc(80, 70, 53, 182, 358, 4),
      limitPx: geometricAcceptance.arc.maxPx,
      expectAccepted: true,
      expectedKinds: ['composite'],
    },
    {
      name: 'retângulo de cantos retos',
      w: 160,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#fff"/><rect x="30" y="24" width="100" height="52" fill="#111"/></svg>`,
      referencePoints: [
        { x: 30, y: 24 },
        { x: 130, y: 24 },
        { x: 130, y: 76 },
        { x: 30, y: 76 },
      ],
      limitPx: geometricAcceptance.corner.positionPx,
      expectAccepted: true,
      expectedKinds: ['rect'],
    },
    {
      name: 'retângulo arredondado',
      w: 160,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#fff"/><rect x="24" y="22" width="112" height="56" rx="12" fill="#111"/></svg>`,
      referencePoints: [
        ...sampleLine(36, 22, 124, 22, 4),
        ...sampleArc(124, 34, 12, -90, 0, 10),
        ...sampleLine(136, 34, 136, 66, 4),
      ],
      limitPx: geometricAcceptance.arc.maxPx,
      expectAccepted: true,
      expectedKinds: ['rect', 'composite'],
    },
    {
      name: 'polígono côncavo (forma em L preservando concavidade real)',
      w: 160,
      h: 120,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#fff"/><polygon points="24,20 72,20 72,68 136,68 136,100 24,100" fill="#111"/></svg>`,
      referencePoints: [
        { x: 24, y: 20 },
        { x: 72, y: 20 },
        { x: 72, y: 68 },
        { x: 136, y: 68 },
        { x: 136, y: 100 },
        { x: 24, y: 100 },
      ],
      limitPx: geometricAcceptance.corner.positionPx,
      expectAccepted: true,
      expectedKinds: ['polygon'],
    },
    {
      name: 'curva orgânica (DEVE rejeitar primitiva)',
      w: 200,
      h: 120,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#fff"/><path d="M30 80 C 50 20, 90 20, 110 60 C 130 100, 160 90, 180 40" fill="none" stroke="#111" stroke-width="5"/></svg>`,
      referencePoints: [],
      limitPx: geometricAcceptance.organic.maxPx,
      expectAccepted: false,
    },
    {
      name: 'letra com serifa (contorno em T/I com 12 vértices)',
      w: 120,
      h: 90,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#fff"/><path d="M52 16 h10 v40 h-10 z M40 56 h34 v6 h-34 z" fill="#111"/></svg>`,
      referencePoints: [
        { x: 52, y: 16 },
        { x: 62, y: 16 },
        { x: 40, y: 56 },
        { x: 74, y: 56 },
        { x: 74, y: 62 },
        { x: 40, y: 62 },
      ],
      limitPx: geometricAcceptance.corner.positionPx + 0.1,
      expectAccepted: true,
      expectedKinds: ['polygon'],
    },
    {
      name: 'letra sem serifa',
      w: 80,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"><rect width="80" height="100" fill="#fff"/><rect x="34" y="12" width="12" height="76" fill="#111"/></svg>`,
      referencePoints: sampleLine(34, 12, 34, 88, 4),
      limitPx: geometricAcceptance.line.maxPx,
      expectAccepted: true,
      expectedKinds: ['rect'],
    },
    {
      name: 'furo (triângulo com furo circular)',
      w: 140,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#fff"/><path d="M30 78 L70 16 L110 78 Z" fill="#2563eb"/><circle cx="70" cy="52" r="10" fill="#fff"/></svg>`,
      referencePoints: sampleCircle(70, 52, 10, 12),
      limitPx: geometricAcceptance.circle.maxRadiusPx,
      expectAccepted: true,
      expectedKinds: ['polygon'],
      checkHole: true,
    },
    {
      name: 'contorno preto espesso (moldura retangular)',
      w: 160,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#fff"/><rect x="28" y="22" width="104" height="56" fill="none" stroke="#111" stroke-width="8"/></svg>`,
      referencePoints: [
        { x: 24, y: 18 },
        { x: 136, y: 18 },
        { x: 136, y: 82 },
        { x: 24, y: 82 },
      ],
      limitPx: geometricAcceptance.corner.positionPx,
      expectAccepted: true,
      expectedKinds: ['rect'],
      checkHole: true,
    },
  ];

  reportLines.push('## Comparativo por categoria (Original vs Pipeline Anterior vs Motor de Primitivas)');
  reportLines.push('');
  reportLines.push('| Caso | Pipeline anterior (erro máx) | Motor de primitivas (tipo) | Motor de primitivas (erro máx) | IoU máscara | Contrato |');
  reportLines.push('|---|---:|---|---:|---:|---|');

  const zoomTestTargets: Array<{ name: string; refSvg: string; primSvg: string; w: number; h: number }> = [];

  for (const spec of specs) {
    const img = await rasterizeSvg(spec.svg, spec.w, spec.h);
    const legacy = await runVectorizationOnRgba(img, legacyParams);
    const primScene = reconstructScenePrimitives(img);

    assert.equal(/<image\b|feImage|data:image/i.test(primScene.svg), false, `${spec.name}: SVG contém raster`);

    const comp = primScene.components[0];
    assert.ok(comp, `${spec.name}: nenhum componente detectado`);

    const legacyErr =
      spec.referencePoints.length > 0
        ? referenceError(spec.referencePoints, chainsOfLegacySvg(legacy.svg))
        : null;

    if (!spec.expectAccepted) {
      assert.equal(
        comp.outerResult.accepted,
        false,
        `${spec.name}: forma orgânica NÃO deveria ser aceita como primitiva (aceitou ${comp.outerResult.primitive?.kind})`
      );
      const legacyCont = continuityOfPath(
        [...legacy.svg.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]).join(' ')
      );
      reportLines.push(
        `| ${spec.name} | ${legacyCont.unintendedG1Breaks} quebras G1 (${legacyCont.maxSmoothTurnDeg}°) | rejeitada corretamente | — | — | DENTRO (preservada orgânica) |`
      );
      continue;
    }

    assert.equal(
      comp.outerResult.accepted,
      true,
      `${spec.name}: primitiva rejeitada inesperadamente (${comp.outerResult.reason})`
    );
    if (spec.expectedKinds) {
      assert.ok(
        spec.expectedKinds.includes(comp.outerResult.primitive!.kind),
        `${spec.name}: esperado ${spec.expectedKinds.join('/')} mas obteve ${comp.outerResult.primitive!.kind}`
      );
    }

    if (spec.checkHole) {
      assert.ok(comp.holeCount >= 1, `${spec.name}: furo não foi detectado`);
      assert.equal(comp.holeResults[0]?.accepted, true, `${spec.name}: furo não foi reconstruído como primitiva`);
    }

    const primChains = [comp.sampledOuterChain];
    if (spec.checkHole && comp.holeResults[0]?.primitive) {
      const hPrim = comp.holeResults[0].primitive;
      if (hPrim.kind === 'circle') {
        primChains.push(sampleCircle(hPrim.cx, hPrim.cy, hPrim.r, 4));
      } else if (hPrim.kind === 'rect') {
        primChains.push([
          { x: hPrim.x, y: hPrim.y },
          { x: hPrim.x + hPrim.width, y: hPrim.y },
          { x: hPrim.x + hPrim.width, y: hPrim.y + hPrim.height },
          { x: hPrim.x, y: hPrim.y + hPrim.height },
          { x: hPrim.x, y: hPrim.y },
        ]);
      }
    }

    const primErr = referenceError(spec.referencePoints, primChains);
    assert.ok(
      primErr.maxPx <= spec.limitPx,
      `${spec.name}: erro do motor de primitivas ${primErr.maxPx} px excedeu limite ${spec.limitPx} px`
    );

    if (spec.name.includes('reta horizontal') || spec.name.includes('reta vertical')) {
      assert.equal(meetsLine(primErr), true, `${spec.name}: não atendeu meetsLine`);
    }
    if (spec.name.includes('círculo 480')) {
      assert.equal(meetsCircle(primErr.maxPx, primErr.hausdorffPx), true, `${spec.name}: não atendeu meetsCircle`);
    }

    const iouStr = comp.outerResult.maskMetrics
      ? `${(comp.outerResult.maskMetrics.iou * 100).toFixed(2)}%`
      : `${(renderZoomIoU(spec.svg, primScene.svg, spec.w, spec.h, 1).iou * 100).toFixed(2)}%`;

    const desc =
      spec.checkHole && comp.holeResults[0]?.primitive
        ? `${describePrimitive(comp.outerResult.primitive)} + furo ${describePrimitive(comp.holeResults[0].primitive)}`
        : describePrimitive(comp.outerResult.primitive);

    reportLines.push(
      `| ${spec.name} | ${legacyErr ? `${legacyErr.maxPx} px` : '—'} | ${desc} | ${primErr.maxPx} px | ${iouStr} | DENTRO (≤ ${spec.limitPx} px) |`
    );

    if (
      spec.name.includes('reta diagonal') ||
      spec.name.includes('círculo 480') ||
      spec.name.includes('arco') ||
      spec.name.includes('retângulo arredondado')
    ) {
      zoomTestTargets.push({
        name: spec.name,
        refSvg: spec.svg,
        primSvg: primScene.svg,
        w: spec.w,
        h: spec.h,
      });
    }
  }

  // 3. Estabilidade em ampliações 100%, 200%, 400%, 800%, 1600% e 3200%
  reportLines.push('');
  reportLines.push('## Estabilidade em ampliações (100% até 3200%)');
  reportLines.push('');
  reportLines.push('| Forma | 100% IoU | 400% IoU | 800% IoU (recorte borda) | 1600% IoU (recorte borda) | 3200% IoU (recorte borda) |');
  reportLines.push('|---|---:|---:|---:|---:|---:|');

  for (const target of zoomTestTargets) {
    const iou100 = renderZoomIoU(target.refSvg, target.primSvg, target.w, target.h, 1).iou;
    const iou400 = renderZoomIoU(target.refSvg, target.primSvg, target.w, target.h, 4).iou;
    // Recorte de 24×24 px focado em uma borda real para testar 800%, 1600% e 3200% sem estourar memória
    const crop =
      target.name.includes('círculo')
        ? { x: 240 - 16, y: 90 - 12, w: 32, h: 24 }
        : target.name.includes('diagonal')
          ? { x: 64, y: 48, w: 32, h: 24 }
          : target.name.includes('arco')
            ? { x: 64, y: 12, w: 32, h: 24 }
            : { x: 118, y: 18, w: 24, h: 24 };
    const iou800 = renderZoomIoU(target.refSvg, target.primSvg, target.w, target.h, 8, crop).iou;
    const iou1600 = renderZoomIoU(target.refSvg, target.primSvg, target.w, target.h, 16, crop).iou;
    const iou3200 = renderZoomIoU(target.refSvg, target.primSvg, target.w, target.h, 32, crop).iou;

    assert.ok(iou100 >= 0.96, `${target.name}: IoU 100% abaixo de 96% (${iou100})`);
    assert.ok(iou400 >= 0.96, `${target.name}: IoU 400% abaixo de 96% (${iou400})`);
    assert.ok(iou3200 >= 0.95, `${target.name}: IoU 3200% abaixo de 95% (${iou3200})`);

    reportLines.push(
      `| ${target.name} | ${(iou100 * 100).toFixed(2)}% | ${(iou400 * 100).toFixed(2)}% | ${(iou800 * 100).toFixed(2)}% | ${(iou1600 * 100).toFixed(2)}% | ${(iou3200 * 100).toFixed(2)}% |`
    );
  }

  // 4. Logo histórico real do pássaro 600×480 (bordas pretas irregulares + letras deformadas)
  const birdSource = readFileSync(new URL('./test-winged-logo-fidelity.ts', import.meta.url), 'utf8');
  const birdSvg = birdSource.match(/return `([\s\S]*?)`;/)?.[1];
  assert.ok(birdSvg, 'logo histórico do pássaro não encontrado');

  const birdImg = await rasterizeSvg(birdSvg, 600, 480);
  const birdLegacy = await runVectorizationOnRgba(birdImg, legacyParams);
  const birdLegacyCont = continuityOfPath(
    [...birdLegacy.svg.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]).join(' ')
  );
  const birdLegacyCensus = pathCensus(birdLegacy.svg);

  const birdPrim = reconstructScenePrimitives(birdImg, { minComponentPixels: 20 });
  assert.equal(/<image\b|feImage|data:image/i.test(birdPrim.svg), false, 'logo do pássaro: SVG contém raster');
  // As asas/corpo orgânicos do pássaro NÃO podem ser forçados a virar círculo/elipse
  assert.ok(
    birdPrim.rejectedOrganic >= 1,
    'logo do pássaro deveria preservar componentes orgânicos sem forçar primitivas falsas'
  );

  reportLines.push('');
  reportLines.push('## Logo histórico do pássaro (600×480 — bordas pretas e letras)');
  reportLines.push('');
  reportLines.push(
    `- **Pipeline anterior**: ${birdLegacy.engineUsed}, ${birdLegacy.validation.pathCount} caminhos, ${birdLegacyCensus.commandCount} comandos, ${birdLegacyCont.unintendedG1Breaks} quebras G1 involuntárias, ${birdLegacyCont.corners} cantos, IoU ${birdLegacy.qualityReport?.iouPct ?? '—'}%.`
  );
  reportLines.push(
    `- **Motor de primitivas (Etapa 2)**: ${birdPrim.components.length} componentes conexos analisados → **${birdPrim.acceptedPrimitives} reconstruídos como primitivas exatas** e **${birdPrim.rejectedOrganic} preservados como orgânicos/complexos** (nenhuma forma orgânica foi forçada em círculo ou elipse).`
  );
  for (const c of birdPrim.components.slice(0, 12)) {
    reportLines.push(
      `  - Componente #${c.componentId} (${c.pixelCount} px, furos ${c.holeCount}): ${describePrimitive(c.outerResult.primitive)} — ${c.outerResult.reason}`
    );
  }
  reportLines.push('');
  reportLines.push(
    '> Nota de escopo: componentes orgânicos, traços com espessura variável e furos internos compostos serão tratados nas Etapas 3 e 4; nesta Etapa 2 apenas primitivas matematicamente válidas são aceitas.'
  );

  const report = reportLines.join('\n');
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  writeFileSync('/opt/cursor/artifacts/primitivas-etapa02.md', report);
  console.log(report);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
