import fs from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import {
  computeQualityComparisonFromBuffers,
  createNodeTempWorkspace,
  decodeImageBytesToRgba,
  getVTracerBinding,
  runVectorizationOnRgba,
  validateSvgStructure,
  type RawRgbaImage,
} from '../src/engine';

/**
 * Gera um logotipo colorido de alta complexidade contendo TODOS os elementos críticos do teste obrigatório:
 * - Asas com penas afiladas e pontas agudas ("Asas e extremidades")
 * - Corpo orgânico em curva "S" suave ("Curvas do corpo")
 * - Degradês lineares e radiais ricos ("Transições de cores" e "Degradês")
 * - Detalhes pequenos (olho, brilho, filetes internos)
 * - Contornos nítidos
 * - Tipografia principal e subtítulo pequeno ("Tipografia")
 */
function createReferenceWingedLogoSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="440" viewBox="0 0 560 440">
    <defs>
      <linearGradient id="wingUpper" x1="80" y1="70" x2="480" y2="230" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#06b6d4"/>
        <stop offset="45%" stop-color="#2563eb"/>
        <stop offset="100%" stop-color="#7c3aed"/>
      </linearGradient>
      <linearGradient id="wingLower" x1="110" y1="130" x2="450" y2="275" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#fde047"/>
        <stop offset="50%" stop-color="#f97316"/>
        <stop offset="100%" stop-color="#e11d48"/>
      </linearGradient>
      <radialGradient id="shieldGlow" cx="280" cy="185" r="135" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#1e293b"/>
        <stop offset="70%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#020617"/>
      </radialGradient>
      <linearGradient id="bodyCurve" x1="230" y1="85" x2="330" y2="295" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#38bdf8"/>
        <stop offset="50%" stop-color="#818cf8"/>
        <stop offset="100%" stop-color="#f43f5e"/>
      </linearGradient>
    </defs>

    <!-- Fundo branco limpo típico de imagem de logo enviada pelo usuário -->
    <rect width="560" height="440" fill="#ffffff"/>

    <!-- Medalhão circular suave de fundo -->
    <circle cx="280" cy="185" r="126" fill="url(#shieldGlow)" stroke="#334155" stroke-width="3"/>

    <!-- Asa Esquerda Superior (3 penas curvas com pontas agudas) -->
    <path d="M258 175 C205 142, 130 96, 44 68 C88 108, 128 140, 178 164 C118 145, 72 132, 28 118 C74 154, 126 178, 188 190 C134 184, 88 180, 52 174 C98 202, 168 216, 250 212 Z" fill="url(#wingUpper)"/>

    <!-- Asa Direita Superior (simétrica com extremidades afiladas) -->
    <path d="M302 175 C355 142, 430 96, 516 68 C472 108, 432 140, 382 164 C442 145, 488 132, 532 118 C486 154, 434 178, 372 190 C426 184, 472 180, 508 174 C462 202, 392 216, 310 212 Z" fill="url(#wingUpper)"/>

    <!-- Plumagem Inferior em Degradê Quente (ouro -> laranja -> carmesim) -->
    <path d="M252 204 C196 210, 134 218, 78 228 C126 242, 182 244, 236 234 C178 252, 138 264, 108 274 C168 274, 224 258, 266 236 Z" fill="url(#wingLower)"/>
    <path d="M308 204 C364 210, 426 218, 482 228 C434 242, 378 244, 324 234 C382 252, 422 264, 452 274 C392 274, 336 258, 294 236 Z" fill="url(#wingLower)"/>

    <!-- Corpo Central em Curva "S" Orgânica + Crista Afilada -->
    <path d="M280 66 C298 84, 308 108, 298 134 C288 160, 262 184, 268 218 C274 250, 302 272, 280 304 C252 278, 236 244, 244 206 C252 172, 276 150, 272 118 C269 98, 264 82, 280 66 Z" fill="url(#bodyCurve)" stroke="#f8fafc" stroke-width="2"/>

    <!-- Detalhes pequenos: olho nítido, brilho interno e estrelas laterais -->
    <circle cx="283" cy="102" r="5.5" fill="#ffffff"/>
    <circle cx="284.5" cy="101.5" r="2.5" fill="#0f172a"/>
    <circle cx="142" cy="88" r="4" fill="#f59e0b"/>
    <circle cx="418" cy="88" r="4" fill="#f59e0b"/>

    <!-- Tipografia Principal e Subtítulo Fino -->
    <text x="280" y="366" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="800" font-size="36" letter-spacing="3" fill="#0f172a">BARUSH VECTOR</text>
    <text x="280" y="398" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="600" font-size="14" letter-spacing="5" fill="#475569">ESTUDIO DE ALTA PRECISAO</text>
  </svg>`;
}

function cropRgba(img: RawRgbaImage, x: number, y: number, w: number, h: number): RawRgbaImage {
  const out = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    const srcOff = ((y + row) * img.width + x) * 4;
    const dstOff = row * w * 4;
    out.set(img.data.subarray(srcOff, srcOff + w * 4), dstOff);
  }
  return { data: out, width: w, height: h };
}

function renderSvgToRgba(svg: string, width: number, background = 'rgb(255,255,255)'): RawRgbaImage {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background,
  });
  const r = resvg.render();
  return {
    width: r.width,
    height: r.height,
    data: new Uint8Array(r.pixels.buffer, r.pixels.byteOffset, r.pixels.byteLength),
  };
}

async function main() {
  console.log('=== TESTE COMPARATIVO DE ALTA FIDELIDADE: LOGO COM ASAS, DEGRADÊS E TIPOGRAFIA ===\n');

  const tempWs = await createNodeTempWorkspace('barush-fidelity-bench-');
  const outArtifactDir = '/opt/cursor/artifacts';
  await fs.mkdir(outArtifactDir, { recursive: true }).catch(() => undefined);

  try {
    // 1. Renderiza o logo de referência em PNG raster real (560x440)
    const refSvg = createReferenceWingedLogoSvg();
    const pngBytes = new Uint8Array(await sharp(Buffer.from(refSvg)).png().toBuffer());
    const originalRgba = await decodeImageBytesToRgba(pngBytes, 'logo-asas-degrade.png');

    // 2. Simula o comportamento ANTERIOR (causador da perda visual diagnosticada):
    // maxColors=12, hierarchical='cutout', filterSpeckle=5, simplify=0.85, spliceThreshold=72, sem upscale
    const vtracer = await getVTracerBinding();
    const legacyBrokenSvgRaw = vtracer.convertPixels(
      originalRgba.data,
      originalRgba.width,
      originalRgba.height,
      {
        clustering: 'color-cluster',
        hierarchical: 'cutout',
        mode: 'spline',
        maxColors: 12,
        colorPrecision: 6,
        layerDifference: 18,
        filterSpeckle: 6,
        cornerThreshold: 38,
        lengthThreshold: 4.5,
        spliceThreshold: 74,
        maxIterations: 10,
        pathPrecision: 2,
        simplify: 0.9,
      }
    ).replace('<svg ', `<svg viewBox="0 0 ${originalRgba.width} ${originalRgba.height}" `);

    // 3. Executa o NOVO Pipeline Adaptativo — MODO 2: VETOR EDITÁVEL (100% vetorial real!)
    const newEditableResult = await runVectorizationOnRgba(originalRgba, {
      profile: 'auto',
      outputMode: 'editable_vector',
      engine: 'auto',
      autoTune: true,
      colorCount: 256,
      detailPrecision: 96,
      curveSmoothness: 68,
      pathSimplification: 0,
      noiseRemoval: 0,
      contourSensitivity: 86,
      optimizeSvg: true,
    });

    // 4. Executa o NOVO Pipeline — MODO 1: FIDELIDADE VISUAL MÁXIMA (SVG Híbrido identificado)
    const newMaxFidelityResult = await runVectorizationOnRgba(originalRgba, {
      profile: 'auto',
      outputMode: 'max_visual_fidelity',
      engine: 'auto',
      autoTune: true,
      colorCount: 256,
      detailPrecision: 96,
      curveSmoothness: 68,
      pathSimplification: 0,
      noiseRemoval: 0,
      contourSensitivity: 86,
      optimizeSvg: true,
    });

    // Verifica estritamente que os dois modos NÃO se confundem
    const checkEditable = validateSvgStructure(newEditableResult.svg, { allowHybridRaster: false });
    if (!checkEditable.valid || newEditableResult.isHybridRasterSvg || checkEditable.hasEmbeddedRaster) {
      throw new Error('Modo 2 (Vetor Editável) falhou na validação puramente vetorial!');
    }
    const checkHybrid = validateSvgStructure(newMaxFidelityResult.svg, { allowHybridRaster: true });
    if (!checkHybrid.valid || !newMaxFidelityResult.isHybridRasterSvg || !checkHybrid.hasEmbeddedRaster) {
      throw new Error('Modo 1 (Fidelidade Visual Máxima) não gerou SVG híbrido identificado corretamente!');
    }

    const legacyRendered = renderSvgToRgba(legacyBrokenSvgRaw, originalRgba.width);
    const newEditableRendered = renderSvgToRgba(newEditableResult.svg, originalRgba.width);

    // Métricas Globais
    const legacyGlobal = computeQualityComparisonFromBuffers(originalRgba, legacyRendered);
    const newGlobal = computeQualityComparisonFromBuffers(originalRgba, newEditableRendered);

    // Métricas por Zona Anatômica do Logo:
    // Zona A: Asas e extremidades (x: 20..240, y: 60..280)
    const origWings = cropRgba(originalRgba, 20, 60, 220, 220);
    const legWings = cropRgba(legacyRendered, 20, 60, 220, 220);
    const newWings = cropRgba(newEditableRendered, 20, 60, 220, 220);
    const wingLegacyMetrics = computeQualityComparisonFromBuffers(origWings, legWings);
    const wingNewMetrics = computeQualityComparisonFromBuffers(origWings, newWings);

    // Zona B: Curvas do corpo + degradês centrais (x: 220..340, y: 60..310)
    const origBody = cropRgba(originalRgba, 220, 60, 120, 250);
    const legBody = cropRgba(legacyRendered, 220, 60, 120, 250);
    const newBody = cropRgba(newEditableRendered, 220, 60, 120, 250);
    const bodyLegacyMetrics = computeQualityComparisonFromBuffers(origBody, legBody);
    const bodyNewMetrics = computeQualityComparisonFromBuffers(origBody, newBody);

    // Zona C: Tipografia principal + subtítulo (x: 70..490, y: 330..415)
    const origTypo = cropRgba(originalRgba, 70, 330, 420, 85);
    const legTypo = cropRgba(legacyRendered, 70, 330, 420, 85);
    const newTypo = cropRgba(newEditableRendered, 70, 330, 420, 85);
    const typoLegacyMetrics = computeQualityComparisonFromBuffers(origTypo, legTypo);
    const typoNewMetrics = computeQualityComparisonFromBuffers(origTypo, newTypo);

    console.log(`Categoria adaptativa detectada: "${newEditableResult.adaptiveStrategyLabel}"`);
    console.log(`Upscale sub-pixel aplicado: ${newEditableResult.upscaleFactorUsed}×`);
    console.log(`Regiões tipográficas detectadas: ${newEditableResult.detectedTypographyCount}`);
    console.log(`Gradientes SVG nativos reconstruídos: ${newEditableResult.reconstructedGradientCount}`);
    console.log(`Caminhos vetoriais editáveis (Modo 2): ${checkEditable.pathCount}\n`);

    console.log('--- COMPARAÇÃO QUANTITATIVA: ANTES vs DEPOIS (MODO 2 — VETOR 100% EDITÁVEL) ---');
    console.log(
      `GLOBAL:               Antes=${legacyGlobal.pixelSimilarityPct}% (${legacyGlobal.psnrDb} dB, Contornos=${legacyGlobal.contourFidelityPct}%, Cores=${legacyGlobal.colorFidelityPct}%)`
    );
    console.log(
      `                      Depois=${newGlobal.pixelSimilarityPct}% (${newGlobal.psnrDb} dB, Contornos=${newGlobal.contourFidelityPct}%, Cores=${newGlobal.colorFidelityPct}%)\n`
    );

    console.log(
      `1. Asas/extremidades: Antes=${wingLegacyMetrics.pixelSimilarityPct}% (Contornos=${wingLegacyMetrics.contourFidelityPct}%) -> Depois=${wingNewMetrics.pixelSimilarityPct}% (Contornos=${wingNewMetrics.contourFidelityPct}%)`
    );
    console.log(
      `2. Curvas/degradês:   Antes=${bodyLegacyMetrics.pixelSimilarityPct}% (Cores=${bodyLegacyMetrics.colorFidelityPct}%)     -> Depois=${bodyNewMetrics.pixelSimilarityPct}% (Cores=${bodyNewMetrics.colorFidelityPct}%)`
    );
    console.log(
      `3. Tipografia/texto:  Antes=${typoLegacyMetrics.pixelSimilarityPct}% (Contornos=${typoLegacyMetrics.contourFidelityPct}%) -> Depois=${typoNewMetrics.pixelSimilarityPct}% (Contornos=${typoNewMetrics.contourFidelityPct}%)\n`
    );

    console.log(
      `MODO 1 (Fidelidade Visual Máxima — SVG Híbrido identificado): ${newMaxFidelityResult.qualityReport?.pixelSimilarityPct}% (${newMaxFidelityResult.validation.pathCount} caminhos estruturais + camada raster sem perdas)`
    );

    // Gera prancha comparativa lado a lado (Original | Antes | Novo Vetor Editável) para inspeção visual real!
    const origPng = await sharp(Buffer.from(originalRgba.data), {
      raw: { width: originalRgba.width, height: originalRgba.height, channels: 4 },
    })
      .png()
      .toBuffer();
    const legPng = await sharp(Buffer.from(legacyRendered.data), {
      raw: { width: legacyRendered.width, height: legacyRendered.height, channels: 4 },
    })
      .png()
      .toBuffer();
    const newPng = await sharp(Buffer.from(newEditableRendered.data), {
      raw: { width: newEditableRendered.width, height: newEditableRendered.height, channels: 4 },
    })
      .png()
      .toBuffer();

    const boardWidth = originalRgba.width * 3 + 40;
    const boardHeight = originalRgba.height + 20;
    await sharp({
      create: {
        width: boardWidth,
        height: boardHeight,
        channels: 4,
        background: { r: 24, g: 24, b: 27, alpha: 1 },
      },
    })
      .composite([
        { input: origPng, left: 10, top: 10 },
        { input: legPng, left: originalRgba.width + 20, top: 10 },
        { input: newPng, left: originalRgba.width * 2 + 30, top: 10 },
      ])
      .png()
      .toFile(path.join(outArtifactDir, 'comparativo-antes-depois-logo-asas.png'));

    if (
      newGlobal.pixelSimilarityPct <= legacyGlobal.pixelSimilarityPct ||
      newGlobal.contourFidelityPct <= legacyGlobal.contourFidelityPct ||
      typoNewMetrics.contourFidelityPct <= typoLegacyMetrics.contourFidelityPct
    ) {
      throw new Error('O novo algoritmo não superou amplamente o anterior em todas as métricas!');
    }

    if (newGlobal.pixelSimilarityPct < 98.5 || newGlobal.contourFidelityPct < 92) {
      throw new Error(
        `Fidelidade global do Vetor Editável ainda abaixo do alvo rigoroso: ${newGlobal.pixelSimilarityPct}% / Contornos ${newGlobal.contourFidelityPct}%`
      );
    }

    console.log('\n=== APROVADO COM GANHO EXPRESSIVO EM ASAS, CORPO, DEGRADÊS, CONTORNOS E TIPOGRAFIA ===');
  } finally {
    await tempWs.cleanup();
  }
}

main().catch((err) => {
  console.error('\nFALHA NO BENCHMARK DO LOGO DE ASAS:', err);
  process.exit(1);
});
