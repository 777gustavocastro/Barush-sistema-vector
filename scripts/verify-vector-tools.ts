import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildSvgExportArtifact,
  convertRgbaToFormatBytes,
  createNodeTempWorkspace,
  decodeImageBytesToRgba,
  instantiateVTracerFromWasmBytes,
  renderSvgForVerification,
  runVectorizationFromBytes,
  validateRasterBytes,
  type RawRgbaImage,
} from '../src/engine/index';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Falha na verificação: ${message}`);
  }
}

async function readInstalledPackageVersion(pkgName: string): Promise<string> {
  const pkgJsonPath = path.resolve(process.cwd(), 'node_modules', pkgName, 'package.json');
  const raw = await fs.readFile(pkgJsonPath, 'utf-8');
  const parsed = JSON.parse(raw) as { version: string };
  return parsed.version;
}

/**
 * Gera uma ilustração raster sintética multicor (180x180 RGBA) para testar o VTracer.
 */
function createMulticolorSampleRgba(width = 180, height = 180): RawRgbaImage {
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      // Fundo claro suave
      let r = 246;
      let g = 247;
      let b = 251;
      const a = 255;

      // Retângulo arredondado índigo
      if (x >= 24 && x <= 116 && y >= 28 && y <= 120) {
        r = 79;
        g = 70;
        b = 229;
      }

      // Círculo ciano sobreposto
      const dx = x - 118;
      const dy = y - 112;
      if (dx * dx + dy * dy <= 42 * 42) {
        r = 6;
        g = 182;
        b = 212;
      }

      // Círculo âmbar superior
      const dx2 = x - 128;
      const dy2 = y - 48;
      if (dx2 * dx2 + dy2 * dy2 <= 20 * 20) {
        r = 245;
        g = 158;
        b = 11;
      }

      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }

  return { data, width, height, sourceFormat: 'png' };
}

/**
 * Gera um emblema monocromático de alto contraste com pixels isolados de ruído para testar o Potrace + filtro mediano.
 */
function createMonochromeLogoSampleRgba(width = 180, height = 180): RawRgbaImage {
  const data = new Uint8Array(width * height * 4).fill(255);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const cx = x - 90;
      const cy = y - 90;
      const distSq = cx * cx + cy * cy;

      // Anel preto externo + barra diagonal interna
      const inOuterRing = distSq <= 64 * 64 && distSq >= 44 * 44;
      const inInnerCross = Math.abs(cx) <= 12 && Math.abs(cy) <= 36;

      if (inOuterRing || inInnerCross) {
        data[idx] = 12;
        data[idx + 1] = 12;
        data[idx + 2] = 14;
      }

      data[idx + 3] = 255;
    }
  }

  // Insere ruídos isolados de 1 pixel (speckles) no fundo branco
  const noiseCoords: Array<[number, number]> = [
    [12, 14],
    [25, 160],
    [164, 22],
    [155, 158],
  ];
  for (const [nx, ny] of noiseCoords) {
    const idx = (ny * width + nx) * 4;
    data[idx] = 0;
    data[idx + 1] = 0;
    data[idx + 2] = 0;
  }

  return { data, width, height, sourceFormat: 'png' };
}

async function main() {
  console.log('=== VERIFICAÇÃO REAL DA INFRAESTRUTURA DE VETORIZAÇÃO (ETAPA 2) ===\n');

  // 1. Confirmação de versões reais instaladas
  const versions = {
    opencv: await readInstalledPackageVersion('@techstark/opencv-js'),
    vtracer: await readInstalledPackageVersion('@visioncortex/vtracer'),
    potrace: await readInstalledPackageVersion('esm-potrace-wasm'),
    svgo: await readInstalledPackageVersion('svgo'),
    sharp: await readInstalledPackageVersion('sharp'),
    resvg: await readInstalledPackageVersion('@resvg/resvg-js'),
  };

  console.log('1. Ferramentas e pacotes verificados:');
  console.log(`   - @techstark/opencv-js (OpenCV local): v${versions.opencv}`);
  console.log(`   - @visioncortex/vtracer (WASM): v${versions.vtracer}`);
  console.log(`   - esm-potrace-wasm (Potrace WASM): v${versions.potrace}`);
  console.log(`   - svgo: v${versions.svgo}`);
  console.log(`   - sharp (codec local Node): v${versions.sharp}`);
  console.log(`   - @resvg/resvg-js (visualizador/renderizador vetorial): v${versions.resvg}\n`);

  const tempWorkspace = await createNodeTempWorkspace('barush-etapa2-test-');

  try {
    // 2. Teste de codificação/decodificação e validação de formatos PNG, JPEG e WebP
    const multicolorSample = createMulticolorSampleRgba();
    const pngBytes = await convertRgbaToFormatBytes(multicolorSample, 'png');
    const jpegBytes = await convertRgbaToFormatBytes(multicolorSample, 'jpeg', 94);
    const webpBytes = await convertRgbaToFormatBytes(multicolorSample, 'webp', 94);

    assert(validateRasterBytes(pngBytes, 'amostra.png').detectedFormat === 'png', 'Validação PNG');
    assert(validateRasterBytes(jpegBytes, 'amostra.jpeg').detectedFormat === 'jpeg', 'Validação JPEG');
    assert(validateRasterBytes(webpBytes, 'amostra.webp').detectedFormat === 'webp', 'Validação WebP');

    const decodedWebp = await decodeImageBytesToRgba(webpBytes, 'amostra.webp');
    assert(decodedWebp.width === 180 && decodedWebp.height === 180, 'Decodificação WebP 180x180');

    console.log('2. Leitura e conversão de formatos (PNG / JPEG / WebP): OK');
    console.log(
      `   - Tamanhos gerados: PNG=${pngBytes.byteLength}B, JPEG=${jpegBytes.byteLength}B, WebP=${webpBytes.byteLength}B\n`
    );

    // 3. Teste real do motor principal: VTracer + SVGO + Validação + Renderização Resvg
    const vtracerResult = await runVectorizationFromBytes(
      pngBytes,
      {
        profile: 'high_fidelity',
        engine: 'vtracer',
        colorCount: 16,
        detailPrecision: 85,
        curveSmoothness: 70,
        pathSimplification: 25,
        noiseRemoval: 30,
        contourSensitivity: 75,
        optimizeSvg: true,
      },
      'ilustracao-colorida.png'
    );

    assert(
      vtracerResult.engineUsed === 'opencv_bezier_gradients' ||
        vtracerResult.engineUsed === 'vtracer_rek_gradients',
      'Motor utilizado deve ser colorido 100% vetorial'
    );
    assert(vtracerResult.validation.valid, `SVG VTracer inválido: ${vtracerResult.validation.errors.join('; ')}`);
    assert(vtracerResult.validation.pathCount >= 3, 'VTracer deve gerar múltiplos caminhos coloridos');
    assert(!vtracerResult.validation.hasEmbeddedRaster, 'SVG não pode conter imagem raster embutida');
    assert(vtracerResult.optimization !== null, 'Otimização SVGO deve estar ativa');

    const vtracerExport = buildSvgExportArtifact(vtracerResult.svg, 'ilustracao-colorida.png');
    const savedVtracerSvgPath = await tempWorkspace.writeTempFile(vtracerExport.fileName, vtracerExport.utf8Bytes);
    const vtracerRenderCheck = await renderSvgForVerification(vtracerExport.svgText);

    assert(vtracerRenderCheck.width === 180 && vtracerRenderCheck.height === 180, 'Dimensão renderizada VTracer 180x180');
    assert(vtracerRenderCheck.nonEmptyPixelCount > 5000, 'SVG VTracer renderizado deve conter geometria visível');

    console.log('3. Conversão real com VTracer + SVGO + Renderizador Vetorial (Resvg): OK');
    console.log(`   - Arquivo temporário gerado: ${savedVtracerSvgPath}`);
    console.log(`   - Caminhos (<path>): ${vtracerResult.validation.pathCount}`);
    console.log(
      `   - SVGO: ${vtracerResult.optimization.originalBytes}B -> ${vtracerResult.optimization.optimizedBytes}B (economia de ${(vtracerResult.optimization.savedRatio * 100).toFixed(1)}%)`
    );
    console.log(
      `   - Renderização vetorial validada: ${vtracerRenderCheck.width}x${vtracerRenderCheck.height} px (${vtracerRenderCheck.nonEmptyPixelCount} pixels ativos) em ${vtracerResult.durationMs} ms\n`
    );

    // 4. Teste real do motor complementar: Potrace (detecção automática de logo monocromático) + SVGO + Renderização Resvg
    const monoSample = createMonochromeLogoSampleRgba();
    const monoPngBytes = await convertRgbaToFormatBytes(monoSample, 'png');

    const potraceResult = await runVectorizationFromBytes(
      monoPngBytes,
      {
        profile: 'auto',
        engine: 'auto',
        colorCount: 2,
        detailPrecision: 80,
        curveSmoothness: 75,
        pathSimplification: 35,
        noiseRemoval: 55,
        contourSensitivity: 70,
        optimizeSvg: true,
      },
      'logo-monocromatico.png'
    );

    assert(potraceResult.colorAnalysis.isMonochromeCandidate, 'Deve detectar candidato monocromático');
    assert(potraceResult.engineUsed === 'potrace_bezier', 'Roteamento automático deve selecionar potrace_bezier');
    assert(potraceResult.validation.valid, `SVG Potrace inválido: ${potraceResult.validation.errors.join('; ')}`);
    assert(potraceResult.validation.pathCount >= 1, 'Potrace deve gerar ao menos 1 caminho vetorial');
    assert(!potraceResult.validation.hasEmbeddedRaster, 'SVG Potrace não pode conter imagem embutida');
    assert(potraceResult.optimization !== null, 'Otimização SVGO deve estar ativa no Potrace');

    const potraceExport = buildSvgExportArtifact(potraceResult.svg, 'logo-monocromatico.png');
    const savedPotraceSvgPath = await tempWorkspace.writeTempFile(potraceExport.fileName, potraceExport.utf8Bytes);
    const potraceRenderCheck = await renderSvgForVerification(potraceExport.svgText);

    assert(potraceRenderCheck.width === 180 && potraceRenderCheck.height === 180, 'Dimensão renderizada Potrace 180x180');
    assert(potraceRenderCheck.nonEmptyPixelCount > 1500, 'SVG Potrace renderizado deve conter o logo visível');

    console.log('4. Conversão real com Potrace + SVGO + Renderizador Vetorial (Resvg): OK');
    console.log(`   - Arquivo temporário gerado: ${savedPotraceSvgPath}`);
    console.log(`   - Caminhos (<path>): ${potraceResult.validation.pathCount}`);
    console.log(
      `   - SVGO: ${potraceResult.optimization.originalBytes}B -> ${potraceResult.optimization.optimizedBytes}B (economia de ${(potraceResult.optimization.savedRatio * 100).toFixed(1)}%)`
    );
    console.log(
      `   - Renderização vetorial validada: ${potraceRenderCheck.width}x${potraceRenderCheck.height} px (${potraceRenderCheck.nonEmptyPixelCount} pixels ativos) em ${potraceResult.durationMs} ms\n`
    );

    // 5. Validação do runtime WebAssembly puro de navegador do VTracer
    const rawWasmBytes = await fs.readFile(
      path.resolve(process.cwd(), 'node_modules/@visioncortex/vtracer/pkg/vtracer_wasm_bg.wasm')
    );
    const browserWasmBinding = await instantiateVTracerFromWasmBytes(rawWasmBytes);
    const browserWasmSvg = browserWasmBinding.convertPixels(
      multicolorSample.data,
      multicolorSample.width,
      multicolorSample.height,
      { mode: 'spline', maxColors: 8 }
    );
    assert(browserWasmSvg.includes('<path'), 'Runtime WASM puro de navegador deve gerar <path>');
    console.log('5. Runtime WebAssembly puro de navegador (VTracer WASM sem node:fs): OK\n');
  } finally {
    await tempWorkspace.cleanup();
  }

  console.log('6. Limpeza automática de diretório temporário: OK');
  console.log('\n=== TODOS OS TESTES REAIS CONCLUÍDOS COM SUCESSO ===');
}

main().catch((err) => {
  console.error('\nERRO NOS TESTES DE INFRAESTRUTURA:', err);
  process.exit(1);
});
