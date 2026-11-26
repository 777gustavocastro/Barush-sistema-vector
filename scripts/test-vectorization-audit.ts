import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { runVectorizationOnRgba, type PipelineAuditReport, type RawRgbaImage, type VectorizationParameters } from '../src/engine';

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

function stageCount(audit: PipelineAuditReport, name: string): number {
  return audit.segmentation.find((row) => row.stage === name)?.regions ?? -1;
}

function blame(audit: PipelineAuditReport, selectedPaths: number): string[] {
  const problems: string[] = [];
  const nuclei = stageCount(audit, 'A-nucleos');
  const afterC = stageCount(audit, 'C-unificacao');
  const afterD = stageCount(audit, 'D-consolidacao');
  if (audit.toneSplitPairs >= 2) {
    problems.push(
      `Fragmentos de tom: ${audit.toneSplitPairs} pares vizinhos com ΔE OKLab ≤ 5,5 continuam regiões distintas após o Passo D. Origem: opencvSegmenter, limiar maxSmoothStepOk e barreira de borda.`
    );
  }
  if (afterC > nuclei + 2 && nuclei >= 0) {
    problems.push(
      `O Passo C criou regiões novas (${nuclei} → ${afterC}). Origem: pixels que o Passo A recusou e que viraram componentes próprios.`
    );
  }
  if (audit.highContrastSmallBeforeConsolidation > audit.highContrastSmallAfterConsolidation + 1) {
    problems.push(
      `Detalhes pequenos sumiram na consolidação (${audit.highContrastSmallBeforeConsolidation} → ${audit.highContrastSmallAfterConsolidation}), com ${audit.mergedRegions} fusões. Origem: Passo D.`
    );
  }
  if (audit.resolutions.wasDownscaled && audit.resolutions.thinRunsAfter + 1 < audit.resolutions.thinRunsBefore) {
    problems.push(
      `Linhas finas caíram no redimensionamento (${audit.resolutions.thinRunsBefore} → ${audit.resolutions.thinRunsAfter}). Origem: downscaleRgbaIfNeeded, ${audit.resolutions.original} para ${audit.resolutions.working}.`
    );
  }
  if (audit.curves.bezierMaxDeviationPx > 1 || audit.curves.bezierForcedOverTolerance > 0) {
    problems.push(
      `Curva Bézier aceita com desvio máximo ${audit.curves.bezierMaxDeviationPx} px (${audit.curves.bezierForcedOverTolerance} acima da tolerância por limite de profundidade). Origem: fitAdaptiveBezierChain.`
    );
  }
  if (audit.topology.tuckEnabled) {
    problems.push('Recuo de fronteira de 0,16 px ligado nesta topologia. Origem: buildPlanarSharedTopology.');
  }
  if (audit.topology.openFilledPaths > 0) {
    problems.push(`${audit.topology.openFilledPaths} preenchimentos sem Z. Origem: buildPlanarSharedTopology.`);
  }
  if (audit.fills.wideSpanKeptSolid > 0) {
    problems.push(
      `${audit.fills.wideSpanKeptSolid} regiões com variação de cor acima de 12 níveis ficaram cor sólida. Origem: fitRegionSvgFill.`
    );
  }
  if (audit.toneSplitPairs >= 2 && audit.fills.linear + audit.fills.radial > 1) {
    problems.push(
      `Gradiente partido em ${audit.fills.linear} lineares e ${audit.fills.radial} radiais. Origem: segmentação anterior ao fitRegionSvgFill.`
    );
  }
  const opencv = audit.candidates.find((row) => row.engineKind === 'opencv_bezier_gradients');
  const vtracer = audit.candidates.find((row) => row.engineKind === 'vtracer_rek_gradients');
  if (opencv && opencv.iouPct < 92) {
    problems.push(
      `Partes ausentes: a silhueta OpenCV cobre ${opencv.iouPct}% da tinta (SSIM ${opencv.ssimPct}%). Origem: o caminho de buildPlanarSharedTopology não preenche a máscara da região.`
    );
  }
  if (opencv && opencv.contourFidelityPct < 90) {
    problems.push(
      `Contorno deformado: fidelidade de contorno OpenCV ${opencv.contourFidelityPct}% com desvio Bézier máximo ${audit.curves.bezierMaxDeviationPx} px. Origem: fronteira na grade de pixels e fitAdaptiveBezierChain.`
    );
  }
  if (opencv && vtracer && vtracer.selected && vtracer.pathCount > opencv.pathCount * 1.5) {
    problems.push(
      `VTracer venceu com ${vtracer.pathCount} caminhos contra ${opencv.pathCount} do OpenCV. Origem: evaluateAndSelectBestCandidate, sem mudança de regra nesta etapa.`
    );
  }
  if (problems.length === 0) {
    problems.push(
      `Sem fragmento tonal relevante. ${afterD} regiões finais, ${selectedPaths} caminhos no SVG escolhido, ${audit.topology.sharedBoundaries} fronteiras compartilhadas.`
    );
  }
  return problems;
}

async function main() {
  const cases: Array<{ name: string; category: string; w: number; h: number; svg: string }> = [
    {
      name: 'logo-solido',
      category: 'logo sólido',
      w: 140,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#ffffff"/><rect x="24" y="22" width="92" height="56" rx="8" fill="#111827"/></svg>`,
    },
    {
      name: 'letra',
      category: 'letra',
      w: 120,
      h: 90,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#ffffff"/><path d="M52 16 h10 v40 h-10 z M40 56 h34 v6 h-34 z" fill="#111111"/></svg>`,
    },
    {
      name: 'simbolo',
      category: 'símbolo',
      w: 120,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100"><rect width="120" height="100" fill="#fff7ed"/><circle cx="60" cy="50" r="28" fill="none" stroke="#9a3412" stroke-width="4"/><circle cx="60" cy="50" r="10" fill="#9a3412"/></svg>`,
    },
    {
      name: 'ilustracao',
      category: 'ilustração',
      w: 140,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#ecfeff"/><circle cx="48" cy="50" r="26" fill="#0284c7"/><rect x="70" y="30" width="46" height="40" fill="#f59e0b"/><circle cx="92" cy="50" r="10" fill="#7c2d12"/></svg>`,
    },
    {
      name: 'metal',
      category: 'metálico',
      w: 140,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#f8fafc"/><defs><radialGradient id="g" cx="36%" cy="32%" r="70%"><stop offset="0%" stop-color="#fff4c4"/><stop offset="50%" stop-color="#d4a017"/><stop offset="100%" stop-color="#5c3b09"/></radialGradient></defs><ellipse cx="70" cy="50" rx="40" ry="28" fill="url(#g)"/></svg>`,
    },
    {
      name: 'gradiente',
      category: 'gradiente',
      w: 140,
      h: 90,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="90"><rect width="140" height="90" fill="#ffffff"/><defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#0f172a"/><stop offset="50%" stop-color="#e2e8f0"/><stop offset="100%" stop-color="#334155"/></linearGradient></defs><rect x="18" y="22" width="104" height="46" fill="url(#s)"/></svg>`,
    },
    {
      name: 'fotografia',
      category: 'fotografia',
      w: 100,
      h: 80,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="#64748b"/><circle cx="40" cy="36" r="16" fill="#fda4af"/><rect x="58" y="28" width="28" height="34" fill="#1e293b"/></svg>`,
    },
    {
      name: 'forma-complexa',
      category: 'forma complexa',
      w: 140,
      h: 100,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100"><rect width="140" height="100" fill="#ffffff"/><path d="M30 70 L70 18 L110 70 Z" fill="#2563eb"/><circle cx="70" cy="58" r="12" fill="#ffffff"/></svg>`,
    },
  ];

  const lines: string[] = [
    '# Auditoria da vetorização',
    '',
    'Medição sem alterar limiares, sem trocar a regra de seleção e sem mexer no processador tipográfico.',
    '',
  ];

  for (const item of cases) {
    const image = await raster(item.svg, item.w, item.h);
    const result = await runVectorizationOnRgba(image, params);
    const audit = result.pipelineAudit;
    assert.ok(audit, `${item.name} sem auditoria`);
    assert.ok(audit.segmentation.some((row) => row.stage === 'A-nucleos'), item.name);
    assert.ok(audit.segmentation.some((row) => row.stage === 'D-consolidacao'), item.name);
    assert.ok(audit.candidates.length >= 1, item.name);
    assert.equal(result.validation.hasEmbeddedRaster, false, item.name);
    const problems = blame(audit, result.validation.pathCount);
    const opencv = audit.candidates.find((row) => row.engineKind === 'opencv_bezier_gradients');
    const vtracer = audit.candidates.find((row) => row.engineKind === 'vtracer_rek_gradients');
    const selected = audit.candidates.find((row) => row.selected);
    lines.push(`## ${item.category}`);
    lines.push('');
    lines.push(`- Resolução: ${audit.resolutions.original} → trabalho ${audit.resolutions.working}. Redução: ${audit.resolutions.wasDownscaled ? 'sim' : 'não'}.`);
    lines.push(`- Bordas fortes antes/depois da escala: ${audit.resolutions.strongEdgesBefore} / ${audit.resolutions.strongEdgesAfter}.`);
    lines.push(`- Regiões: ${audit.segmentation.map((row) => `${row.stage}=${row.regions}`).join(', ')}.`);
    lines.push(`- Fundidas: ${audit.mergedRegions}. Protegidas: ${audit.protectedRegions}. Pequenas no fim: ${audit.smallRegionsFinal}.`);
    lines.push(`- Pares de tom vizinhos (ΔE ≤ 5,5): ${audit.toneSplitPairs}. Regiões desconectadas: ${audit.disconnectedRegions}.`);
    lines.push(`- Topologia: ${audit.topology.sharedBoundaries} fronteiras, ${audit.topology.holes} furos, ${audit.topology.openFilledPaths} preenchimentos abertos, recuo ${audit.topology.tuckEnabled ? 'ligado' : 'desligado'}.`);
    lines.push(`- Bézier: ${audit.curves.bezierFits} ajustes, desvio máximo ${audit.curves.bezierMaxDeviationPx} px, ${audit.curves.bezierForcedOverTolerance} forçados acima de 1 px.`);
    lines.push(`- Preenchimentos: sólido ${audit.fills.solid}, linear ${audit.fills.linear}, radial ${audit.fills.radial}, composto ${audit.fills.compound}, sólido com muita variação ${audit.fills.wideSpanKeptSolid}.`);
    lines.push(`- OpenCV: ${opencv ? `${opencv.pathCount} caminhos, SSIM ${opencv.ssimPct}, ΔE₀₀ ${opencv.deltaE2000}, contorno ${opencv.contourFidelityPct}%, IoU ${opencv.iouPct}%` : 'ausente'}.`);
    lines.push(`- VTracer: ${vtracer ? `${vtracer.pathCount} caminhos, SSIM ${vtracer.ssimPct}, ΔE₀₀ ${vtracer.deltaE2000}, contorno ${vtracer.contourFidelityPct}%, IoU ${vtracer.iouPct}%` : 'ausente'}.`);
    lines.push(`- Escolhido: ${selected?.candidateId ?? result.engineUsed}, ${result.validation.pathCount} caminhos.`);
    lines.push(`- Cobertura da máscara: pior recall ${audit.coverage.worstRecall}, traços recusados ${audit.coverage.strokesRejected}, preenchimentos reconstruídos ${audit.coverage.fillsRebuilt}, componentes ausentes ${audit.coverage.missingComponents}.`);
    lines.push(`- Problemas: ${problems.join(' ')}`);
    lines.push('');
  }

  const report = lines.join('\n');
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  writeFileSync('/opt/cursor/artifacts/auditoria-etapa01.md', report);
  console.log(report);
  console.log('auditoria: ok', cases.length);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
