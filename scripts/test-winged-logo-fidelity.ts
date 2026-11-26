import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import {
  computeQualityComparisonFromBuffers,
  createNodeTempWorkspace,
  decodeImageBytesToRgba,
  runVectorizationOnRgba,
  validateSvgStructure,
  type RawRgbaImage,
} from '../src/engine';

/**
 * Gera a imagem raster de referência do Pássaro Colorido (Seção 12):
 * - Formato das asas abertas e extremidades afiladas das penas
 * - Curvas orgânicas do corpo em "S"
 * - Degradês roxos (#7c3aed), azuis (#2563eb / #06b6d4), rosas (#ec4899 / #f43f5e) e amarelos (#fde047 / #f59e0b)
 * - Sombra suave translúcida e brilho/reflexo no olho
 * - Tipografia nítida principal e subtítulo
 */
function createReferenceColorfulBirdSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="480" viewBox="0 0 600 480">
    <defs>
      <linearGradient id="wingPurpleBlue" x1="60" y1="65" x2="270" y2="215" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#7c3aed"/>
        <stop offset="52%" stop-color="#2563eb"/>
        <stop offset="100%" stop-color="#06b6d4"/>
      </linearGradient>
      <linearGradient id="wingBluePinkRight" x1="540" y1="65" x2="330" y2="215" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#ec4899"/>
        <stop offset="50%" stop-color="#8b5cf6"/>
        <stop offset="100%" stop-color="#2563eb"/>
      </linearGradient>
      <linearGradient id="feathersPinkYellow" x1="90" y1="195" x2="275" y2="290" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#fde047"/>
        <stop offset="52%" stop-color="#f97316"/>
        <stop offset="100%" stop-color="#ec4899"/>
      </linearGradient>
      <linearGradient id="feathersYellowPinkRight" x1="510" y1="195" x2="325" y2="290" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#fde047"/>
        <stop offset="52%" stop-color="#fb7185"/>
        <stop offset="100%" stop-color="#db2777"/>
      </linearGradient>
      <linearGradient id="birdBodyGrad" x1="265" y1="62" x2="325" y2="320" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#38bdf8"/>
        <stop offset="38%" stop-color="#6366f1"/>
        <stop offset="72%" stop-color="#ec4899"/>
        <stop offset="100%" stop-color="#facc15"/>
      </linearGradient>
      <radialGradient id="softShadow" cx="300" cy="342" r="95" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#94a3b8" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="#94a3b8" stop-opacity="0"/>
      </radialGradient>
    </defs>

    <!-- Fundo branco de referência -->
    <rect width="600" height="480" fill="#ffffff"/>

    <!-- Sombra elíptica suave translúcida -->
    <ellipse cx="300" cy="340" rx="92" ry="14" fill="url(#softShadow)"/>

    <!-- Asa Esquerda Superior (penas afiladas em degradê roxo -> azul -> ciano) -->
    <path d="M276 184 C218 146, 138 98, 48 68 C94 112, 138 146, 192 170 C128 150, 78 136, 32 122 C82 160, 136 186, 202 198 C144 192, 94 188, 56 182 C106 212, 180 226, 268 220 Z" fill="url(#wingPurpleBlue)"/>

    <!-- Asa Direita Superior (penas afiladas em degradê rosa -> roxo -> azul) -->
    <path d="M324 184 C382 146, 462 98, 552 68 C506 112, 462 146, 408 170 C472 150, 522 136, 568 122 C518 160, 464 186, 398 198 C456 192, 506 188, 544 182 C494 212, 420 226, 332 220 Z" fill="url(#wingBluePinkRight)"/>

    <!-- Penas Inferiores Esquerda (amarelo -> laranja -> rosa) -->
    <path d="M270 214 C210 220, 144 230, 84 242 C136 258, 196 260, 252 248 C192 268, 148 282, 116 292 C180 292, 240 274, 284 250 Z" fill="url(#feathersPinkYellow)"/>

    <!-- Penas Inferiores Direita (amarelo -> coral -> rosa) -->
    <path d="M330 214 C390 220, 456 230, 516 242 C464 258, 404 260, 348 248 C408 268, 452 282, 484 292 C420 292, 360 274, 316 250 Z" fill="url(#feathersYellowPinkRight)"/>

    <!-- Corpo Curvo Central em "S" (azul -> roxo -> rosa -> amarelo) -->
    <path d="M300 64 C320 84, 330 110, 320 138 C308 166, 280 192, 286 228 C292 262, 322 286, 300 320 C270 292, 252 256, 260 216 C268 180, 294 156, 290 122 C287 100, 282 82, 300 64 Z" fill="url(#birdBodyGrad)"/>

    <!-- Olho, pupila e reflexo luminoso -->
    <circle cx="304" cy="102" r="6" fill="#ffffff"/>
    <circle cx="305.5" cy="101.5" r="2.8" fill="#0f172a"/>
    <circle cx="304.2" cy="100.3" r="1.1" fill="#ffffff"/>

    <!-- Pequenos elementos ornamentais -->
    <circle cx="152" cy="86" r="4.5" fill="#facc15"/>
    <circle cx="448" cy="86" r="4.5" fill="#ec4899"/>

    <!-- Tipografia Principal e Subtítulo -->
    <text x="300" y="396" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="800" font-size="36" letter-spacing="3" fill="#1e1b4b">BARUSH VECTOR</text>
    <text x="300" y="430" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="600" font-size="14" letter-spacing="5" fill="#475569">ARTE VETORIAL EDITAVEL</text>
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
  console.log('=== TESTE PRINCIPAL (SEÇÃO 12): PÁSSARO COLORIDO — 100% VETORIAL E ZERO RASTER ===\n');

  const tempWs = await createNodeTempWorkspace('barush-passaro-colorido-');
  const outArtifactDir = '/opt/cursor/artifacts';
  await fs.mkdir(outArtifactDir, { recursive: true }).catch(() => undefined);

  try {
    // 1. Converte o SVG de referência para PNG raster real (a entrada raster que o sistema recebe)
    const refSvg = createReferenceColorfulBirdSvg();
    const pngBytes = new Uint8Array(await sharp(Buffer.from(refSvg)).png().toBuffer());
    const originalRgba = await decodeImageBytesToRgba(pngBytes, 'passaro-colorido-referencia.png');

    // 2. Executa a Nova Arquitetura de Reconstrução Vetorial Avançada
    const result = await runVectorizationOnRgba(originalRgba, {
      profile: 'auto',
      engine: 'auto',
      autoTune: true,
      reconstructGradients: true,
      enhanceTypography: true,
      subpixelUpscale: true,
      colorCount: 256,
      detailPrecision: 96,
      curveSmoothness: 68,
      pathSimplification: 0,
      noiseRemoval: 0,
      contourSensitivity: 86,
      optimizeSvg: true,
    });

    // 3. Auditoria Estrita Anti-Raster (Seção 9 e Seção 11)
    const validation = validateSvgStructure(result.svg);
    if (!validation.valid || validation.hasEmbeddedRaster) {
      throw new Error(`Validação anti-raster falhou: ${validation.errors.join('; ')}`);
    }
    if (/<image\b/i.test(result.svg) || /data:image/i.test(result.svg) || /base64/i.test(result.svg)) {
      throw new Error('PROIBIÇÃO VIOLADA: O SVG contém imagem raster ou Base64!');
    }
    if (validation.gradientCount < 2) {
      throw new Error(
        `Esperava gradientes SVG nativos (<linearGradient>/<radialGradient>), mas obteve ${validation.gradientCount}!`
      );
    }
    if (validation.objectCount < 3) {
      throw new Error(
        `Esperava separação em múltiplos objetos independentes (<g id="objeto-N">), mas obteve ${validation.objectCount}!`
      );
    }

    // 4. Validação real de abertura e edição no Inkscape
    const svgOutPath = path.join(outArtifactDir, 'passaro-colorido-reconstruido-puro.svg');
    await fs.writeFile(svgOutPath, result.svg, 'utf-8');

    const inkscapeQuery = execFileSync('inkscape', ['--query-all', svgOutPath], {
      encoding: 'utf-8',
    }).trim();
    const inkscapeObjects = inkscapeQuery
      .split('\n')
      .filter((l) => l.startsWith('objeto-') || l.startsWith('caminho-') || l.startsWith('letra-'));

    if (inkscapeObjects.length < 10) {
      throw new Error(`Inkscape não listou objetos/caminhos editáveis suficientes: ${inkscapeObjects.length}`);
    }

    // 5. Comparação Perceptual e por Zona (Asas, Corpo+Degradês, Tipografia)
    const renderedVector = renderSvgToRgba(result.svg, originalRgba.width);
    const globalMetrics = computeQualityComparisonFromBuffers(originalRgba, renderedVector);

    const wingsMetrics = computeQualityComparisonFromBuffers(
      cropRgba(originalRgba, 25, 60, 550, 240),
      cropRgba(renderedVector, 25, 60, 550, 240)
    );
    const bodyMetrics = computeQualityComparisonFromBuffers(
      cropRgba(originalRgba, 245, 58, 110, 270),
      cropRgba(renderedVector, 245, 58, 110, 270)
    );
    const typoMetrics = computeQualityComparisonFromBuffers(
      cropRgba(originalRgba, 65, 360, 470, 85),
      cropRgba(renderedVector, 65, 360, 470, 85)
    );

    console.log(`Candidato Vencedor:     ${result.selectedCandidateLabel}`);
    console.log(`Motor Utilizado:        ${result.engineUsed}`);
    console.log(`Dimensões do SVG:       ${validation.width}×${validation.height} (viewBox="${validation.viewBox}")`);
    console.log(`Objetos Independentes:  ${validation.objectCount}`);
    console.log(`Grupos <g>:             ${validation.groupCount}`);
    console.log(`Caminhos Editáveis:     ${validation.pathCount}`);
    console.log(
      `Gradientes SVG Nativos: ${validation.gradientCount} (${validation.linearGradientCount} linear, ${validation.radialGradientCount} radial)`
    );
    console.log(`Elementos no Inkscape:  ${inkscapeObjects.length} selecionáveis individualmente`);
    console.log(`Imagens Raster no SVG:  0 (Verificado: zero <image>, zero PNG/JPEG, zero Base64)\n`);

    console.log('--- MÉTRICAS PERCEPTUAIS E ESTRUTURAIS (ORIGINAL vs SVG 100% VETORIAL) ---');
    console.log(
      `GLOBAL:      SSIM=${globalMetrics.ssimPct}% | Pixels=${globalMetrics.pixelSimilarityPct}% | Cores Lab=${globalMetrics.colorFidelityPct}% (ΔE=${globalMetrics.meanDeltaELab}) | Contornos=${globalMetrics.contourFidelityPct}% | Gradientes=${globalMetrics.gradientContinuityPct}%`
    );
    console.log(
      `Asas/Penas:  SSIM=${wingsMetrics.ssimPct}% | Cores Lab=${wingsMetrics.colorFidelityPct}% | Contornos=${wingsMetrics.contourFidelityPct}%`
    );
    console.log(
      `Corpo Curvo: SSIM=${bodyMetrics.ssimPct}% | Cores Lab=${bodyMetrics.colorFidelityPct}% | Contornos=${bodyMetrics.contourFidelityPct}%`
    );
    console.log(
      `Tipografia:  SSIM=${typoMetrics.ssimPct}% | Cores Lab=${typoMetrics.colorFidelityPct}% | Contornos=${typoMetrics.contourFidelityPct}%\n`
    );

    if (result.qualityReport?.evaluatedCandidates) {
      console.log('--- PLACAR DOS CANDIDATOS AVALIADOS ---');
      for (const c of result.qualityReport.evaluatedCandidates) {
        console.log(
          `  • ${c.label}: Score=${c.compositeScore} (SSIM=${c.ssimPct}%, Cores=${c.perceptualColorPct}%, Contornos=${c.contourFidelityPct}%, Gradientes=${c.gradientCount}, Objetos=${c.objectCount}, Caminhos=${c.pathCount})`
        );
      }
    }

    // Salva prancha comparativa lado a lado (Referência Original vs SVG 100% Vetorial Puro)
    const origPng = await sharp(Buffer.from(originalRgba.data), {
      raw: { width: originalRgba.width, height: originalRgba.height, channels: 4 },
    })
      .png()
      .toBuffer();
    const vecPng = await sharp(Buffer.from(renderedVector.data), {
      raw: { width: renderedVector.width, height: renderedVector.height, channels: 4 },
    })
      .png()
      .toBuffer();

    await fs
      .writeFile(path.join(outArtifactDir, 'passaro-colorido-referencia.png'), pngBytes)
      .catch(() => undefined);
    await fs
      .writeFile(path.join(outArtifactDir, 'passaro-colorido-vetor-puro.svg'), result.svg, 'utf-8')
      .catch(() => undefined);

    await sharp({
      create: {
        width: originalRgba.width * 2 + 30,
        height: originalRgba.height + 20,
        channels: 4,
        background: { r: 24, g: 24, b: 27, alpha: 1 },
      },
    })
      .composite([
        { input: origPng, left: 10, top: 10 },
        { input: vecPng, left: originalRgba.width + 20, top: 10 },
      ])
      .png()
      .toFile(path.join(outArtifactDir, 'comparativo-passaro-colorido-vetor-puro.png'));

    if (globalMetrics.ssimPct < 95 || globalMetrics.pixelSimilarityPct < 98) {
      throw new Error(
        `Qualidade global abaixo do patamar exigido: SSIM=${globalMetrics.ssimPct}%, Pixels=${globalMetrics.pixelSimilarityPct}%`
      );
    }

    console.log('\n=== APROVADO: PÁSSARO COLORIDO RECONSTRUÍDO COM FIDELIDADE ALTA, GRADIENTES NATIVOS E ZERO RASTER ===');
  } finally {
    await tempWs.cleanup();
  }
}

main().catch((err) => {
  console.error('\nFALHA NO TESTE DO PÁSSARO COLORIDO:', err);
  process.exit(1);
});
