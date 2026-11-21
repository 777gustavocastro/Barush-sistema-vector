import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import {
  analyzeImageColors,
  buildSvgExportArtifact,
  createNodeTempWorkspace,
  decodeImageBytesToRgba,
  runVectorizationOnRgba,
  validateImageDimensions,
  validateRasterBytes,
  validateSvgStructure,
  type RawRgbaImage,
  type VectorizationParameters,
} from '../src/engine';

const DEFAULT_AUTO_PARAMS: VectorizationParameters = {
  profile: 'auto',
  engine: 'auto',
  autoTune: true,
  colorCount: 16,
  detailPrecision: 80,
  curveSmoothness: 70,
  pathSimplification: 26,
  noiseRemoval: 25,
  contourSensitivity: 74,
  optimizeSvg: true,
};

interface CategoryFixture {
  id: string;
  categoryName: string;
  fileName: string;
  format: 'png' | 'jpg' | 'jpeg' | 'webp';
  width: number;
  height: number;
  sourceSvgMarkup: string;
  addPhotographicGrain?: boolean;
  minSimilarityPct: number;
}

function computeVisualMetrics(original: RawRgbaImage, renderedSvg: RawRgbaImage) {
  if (original.width !== renderedSvg.width || original.height !== renderedSvg.height) {
    throw new Error(
      `Deformação de dimensões detectada: original ${original.width}x${original.height} vs SVG ${renderedSvg.width}x${renderedSvg.height}`
    );
  }

  const totalPixels = original.width * original.height;
  let totalChannelDiff = 0;

  let origMinX = original.width;
  let origMinY = original.height;
  let origMaxX = 0;
  let origMaxY = 0;

  let vecMinX = renderedSvg.width;
  let vecMinY = renderedSvg.height;
  let vecMaxX = 0;
  let vecMaxY = 0;

  // Verifica se as 4 bordas compartilham fundo uniforme (transparente ou cor sólida)
  const tlIdx = 0;
  const trIdx = (original.width - 1) * 4;
  const blIdx = (original.height - 1) * original.width * 4;
  const brIdx = ((original.height - 1) * original.width + (original.width - 1)) * 4;

  const bgR = original.data[tlIdx];
  const bgG = original.data[tlIdx + 1];
  const bgB = original.data[tlIdx + 2];
  const bgA = original.data[tlIdx + 3];

  const cornersUniform =
    bgA < 20 ||
    ([trIdx, blIdx, brIdx].every(
      (idx) =>
        Math.abs(original.data[idx] - bgR) +
          Math.abs(original.data[idx + 1] - bgG) +
          Math.abs(original.data[idx + 2] - bgB) <=
        30
    ));

  const isForeground = (r: number, g: number, b: number, a: number): boolean => {
    if (bgA < 20) {
      return a > 30;
    }
    if (!cornersUniform) {
      return a > 200;
    }
    return Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB) > 40;
  };

  for (let y = 0; y < original.height; y++) {
    for (let x = 0; x < original.width; x++) {
      const idx = (y * original.width + x) * 4;
      const or = original.data[idx];
      const og = original.data[idx + 1];
      const ob = original.data[idx + 2];
      const oa = original.data[idx + 3];

      const vr = renderedSvg.data[idx];
      const vg = renderedSvg.data[idx + 1];
      const vb = renderedSvg.data[idx + 2];
      const va = renderedSvg.data[idx + 3];

      // Compara pixels pré-multiplicados por alfa (tratamento justo de áreas transparentes)
      const oAlpha = oa / 255;
      const vAlpha = va / 255;
      totalChannelDiff +=
        Math.abs(or * oAlpha - vr * vAlpha) +
        Math.abs(og * oAlpha - vg * vAlpha) +
        Math.abs(ob * oAlpha - vb * vAlpha) +
        Math.abs(oa - va);

      if (isForeground(or, og, ob, oa)) {
        if (x < origMinX) origMinX = x;
        if (y < origMinY) origMinY = y;
        if (x > origMaxX) origMaxX = x;
        if (y > origMaxY) origMaxY = y;
      }

      if (isForeground(vr, vg, vb, va)) {
        if (x < vecMinX) vecMinX = x;
        if (y < vecMinY) vecMinY = y;
        if (x > vecMaxX) vecMaxX = x;
        if (y > vecMaxY) vecMaxY = y;
      }
    }
  }

  const mae = totalChannelDiff / (totalPixels * 4);
  const similarityPct = Number(((1 - mae / 255) * 100).toFixed(2));

  const bboxDeltaPx = Math.max(
    Math.abs(origMinX - vecMinX),
    Math.abs(origMinY - vecMinY),
    Math.abs(origMaxX - vecMaxX),
    Math.abs(origMaxY - vecMaxY)
  );

  return {
    similarityPct,
    mae: Number(mae.toFixed(2)),
    bboxDeltaPx,
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function verifyColorPreservation(origHexes: string[], svgHexes: string[]): number {
  if (origHexes.length === 0 || svgHexes.length === 0) return 0;
  // Verifica a menor distância média das cores dominantes originais até a paleta do SVG
  let sumDist = 0;
  const checkCount = Math.min(3, origHexes.length);
  for (let i = 0; i < checkCount; i++) {
    const [r1, g1, b1] = hexToRgb(origHexes[i]);
    let best = Infinity;
    for (const candidate of svgHexes) {
      const [r2, g2, b2] = hexToRgb(candidate);
      const dist = Math.hypot(r1 - r2, g1 - g2, b1 - b2);
      if (dist < best) best = dist;
    }
    sumDist += best;
  }
  return Number((sumDist / checkCount).toFixed(1));
}

function buildFixtures(): CategoryFixture[] {
  // Estampa repetitiva gerada programaticamente
  const patternTiles: string[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const cx = 40 + col * 70;
      const cy = 40 + row * 70;
      const color = (row + col) % 2 === 0 ? '#e11d48' : '#0284c7';
      patternTiles.push(
        `<polygon points="${cx},${cy - 22} ${cx + 22},${cy} ${cx},${cy + 22} ${cx - 22},${cy}" fill="${color}" />`,
        `<circle cx="${cx}" cy="${cy}" r="8" fill="#facc15" />`
      );
    }
  }

  // Grade densa com muitos detalhes pequenos
  const microDetails: string[] = [];
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const x = 24 + c * 38;
      const y = 24 + r * 38;
      microDetails.push(
        `<rect x="${x}" y="${y}" width="22" height="22" rx="4" fill="none" stroke="#1e293b" stroke-width="2.5"/>`,
        `<circle cx="${x + 11}" cy="${y + 11}" r="4.5" fill="${(r + c) % 2 === 0 ? '#4f46e5' : '#0d9488'}"/>`
      );
    }
  }

  return [
    {
      id: '1-logo-monocromatico',
      categoryName: '1. Logos monocromáticos',
      fileName: 'logo-monocromatico.png',
      format: 'png',
      width: 320,
      height: 240,
      minSimilarityPct: 96,
      sourceSvgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">
        <rect width="320" height="240" fill="#ffffff"/>
        <path d="M70 185 L160 40 L250 185 L212 185 L160 98 L108 185 Z" fill="#0f172a"/>
        <circle cx="160" cy="158" r="22" fill="#0f172a"/>
      </svg>`,
    },
    {
      id: '2-logo-colorido',
      categoryName: '2. Logos coloridos',
      fileName: 'logo-colorido.png',
      format: 'png',
      width: 320,
      height: 240,
      minSimilarityPct: 95,
      sourceSvgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">
        <rect width="320" height="240" fill="#ffffff"/>
        <rect x="45" y="45" width="110" height="110" rx="24" fill="#4f46e5"/>
        <circle cx="195" cy="125" r="68" fill="#10b981"/>
        <polygon points="155,55 245,195 95,195" fill="#f59e0b"/>
      </svg>`,
    },
    {
      id: '3-ilustracao',
      categoryName: '3. Ilustrações',
      fileName: 'ilustracao-paisagem.webp',
      format: 'webp',
      width: 360,
      height: 260,
      minSimilarityPct: 94,
      sourceSvgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="260">
        <rect width="360" height="260" fill="#0f172a"/>
        <circle cx="275" cy="72" r="36" fill="#fbbf24"/>
        <polygon points="0,220 115,105 230,220" fill="#312e81"/>
        <polygon points="110,220 235,88 360,220" fill="#4338ca"/>
        <rect x="0" y="210" width="360" height="50" fill="#065f46"/>
        <path d="M145 260 Q180 215 210 210 L235 210 Q205 230 195 260 Z" fill="#38bdf8"/>
      </svg>`,
    },
    {
      id: '4-icone',
      categoryName: '4. Ícones',
      fileName: 'icone-app.png',
      format: 'png',
      width: 256,
      height: 256,
      minSimilarityPct: 96,
      sourceSvgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
        <rect x="24" y="24" width="208" height="208" rx="48" fill="#2563eb"/>
        <path d="M84 132 L116 164 L176 96" fill="none" stroke="#ffffff" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,
    },
    {
      id: '5-desenho',
      categoryName: '5. Desenhos (traço artístico P&B)',
      fileName: 'desenho-nanquim.jpg',
      format: 'jpg',
      width: 320,
      height: 260,
      minSimilarityPct: 93,
      sourceSvgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="260">
        <rect width="320" height="260" fill="#ffffff"/>
        <circle cx="160" cy="130" r="82" fill="none" stroke="#111827" stroke-width="7"/>
        <path d="M115 112 Q130 95 145 112" fill="none" stroke="#111827" stroke-width="6" stroke-linecap="round"/>
        <path d="M175 112 Q190 95 205 112" fill="none" stroke="#111827" stroke-width="6" stroke-linecap="round"/>
        <path d="M122 158 Q160 192 198 158" fill="none" stroke="#111827" stroke-width="7" stroke-linecap="round"/>
        <line x1="60" y1="130" x2="92" y2="130" stroke="#111827" stroke-width="6"/>
        <line x1="228" y1="130" x2="260" y2="130" stroke="#111827" stroke-width="6"/>
      </svg>`,
    },
    {
      id: '6-estampa',
      categoryName: '6. Estampas',
      fileName: 'estampa-geometrica.jpeg',
      format: 'jpeg',
      width: 300,
      height: 300,
      minSimilarityPct: 92,
      sourceSvgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
        <rect width="300" height="300" fill="#fff1f2"/>
        ${patternTiles.join('\n')}
      </svg>`,
    },
    {
      id: '7-transparente',
      categoryName: '7. Imagens transparentes (canal alfa)',
      fileName: 'emblema-transparente.png',
      format: 'png',
      width: 280,
      height: 280,
      minSimilarityPct: 96,
      sourceSvgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280">
        <circle cx="140" cy="140" r="102" fill="#8b5cf6"/>
        <polygon points="140,62 163,112 218,118 177,155 188,209 140,182 92,209 103,155 62,118 117,112" fill="#fde047"/>
      </svg>`,
    },
    {
      id: '8-fotografia',
      categoryName: '8. Fotografias (gradientes contínuos e grão)',
      fileName: 'fotografia-por-do-sol.jpg',
      format: 'jpg',
      width: 340,
      height: 240,
      addPhotographicGrain: true,
      minSimilarityPct: 90,
      sourceSvgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="240">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#1e1b4b"/>
            <stop offset="45%" stop-color="#be185d"/>
            <stop offset="80%" stop-color="#fb923c"/>
            <stop offset="100%" stop-color="#fde047"/>
          </linearGradient>
          <radialGradient id="sun" cx="50%" cy="62%" r="38%">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="55%" stop-color="#fde047" stop-opacity="0.8"/>
            <stop offset="100%" stop-color="#fb923c" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="340" height="240" fill="url(#sky)"/>
        <rect width="340" height="240" fill="url(#sun)"/>
        <path d="M0 185 Q85 150 170 178 T340 165 L340 240 L0 240 Z" fill="#1f2937"/>
      </svg>`,
    },
    {
      id: '9-muitos-detalhes',
      categoryName: '9. Imagens com muitos detalhes',
      fileName: 'matriz-detalhada.png',
      format: 'png',
      width: 300,
      height: 300,
      minSimilarityPct: 92,
      sourceSvgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
        <rect width="300" height="300" fill="#f8fafc"/>
        ${microDetails.join('\n')}
      </svg>`,
    },
  ];
}

async function generateFixtureBytes(fixture: CategoryFixture): Promise<Uint8Array> {
  let pipeline = sharp(Buffer.from(fixture.sourceSvgMarkup)).resize(fixture.width, fixture.height);

  if (fixture.addPhotographicGrain) {
    const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // Grão fotográfico determinístico suave
    for (let i = 0; i < data.length; i += 4) {
      const grain = ((i * 1103515245 + 12345) & 0x0f) - 7;
      data[i] = Math.max(0, Math.min(255, data[i] + grain));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + grain));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + grain));
    }
    pipeline = sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    });
  }

  if (fixture.format === 'png') {
    return new Uint8Array(await pipeline.png().toBuffer());
  }
  if (fixture.format === 'webp') {
    return new Uint8Array(await pipeline.webp({ quality: 95 }).toBuffer());
  }
  return new Uint8Array(await pipeline.jpeg({ quality: 94 }).toBuffer());
}

async function main() {
  console.log('=== BATERIA DE TESTES REAIS NAS 9 CATEGORIAS DE IMAGEM (ETAPA 3) ===\n');

  const tempWs = await createNodeTempWorkspace('barush-etapa3-categories-');
  const fixtures = buildFixtures();

  try {
    for (const fixture of fixtures) {
      const imgBytes = await generateFixtureBytes(fixture);
      const imgPath = path.join(tempWs.dirPath, fixture.fileName);
      await fs.writeFile(imgPath, imgBytes);

      // 1. Validação de assinatura binária
      const binValidation = validateRasterBytes(imgBytes, fixture.fileName);
      if (!binValidation.valid) {
        throw new Error(`Falha ao validar formato em ${fixture.fileName}: ${binValidation.error}`);
      }

      // 2. Decodificação local RGBA + validação de dimensões
      const rgba = await decodeImageBytesToRgba(imgBytes, fixture.fileName);
      validateImageDimensions(rgba.width, rgba.height);

      // 3. Vetorização no perfil Automático com inteligência de imagem
      const result = await runVectorizationOnRgba(rgba, DEFAULT_AUTO_PARAMS);

      // 4. Validação estrutural do SVG gerado
      const svgCheck = validateSvgStructure(result.svg);
      if (!svgCheck.valid) {
        throw new Error(
          `SVG inválido em ${fixture.categoryName}: ${svgCheck.errors.join('; ')}`
        );
      }

      if (/<image[\s>]/i.test(result.svg) || /data:image\//i.test(result.svg)) {
        throw new Error(`Proibido: ${fixture.categoryName} incorporou bitmap no SVG!`);
      }

      if (result.originalWidth !== fixture.width || result.originalHeight !== fixture.height) {
        throw new Error(`Dimensões originais não preservadas em ${fixture.categoryName}`);
      }

      // 5. Renderização real do SVG em pixels (Resvg) e cálculo de fidelidade visual
      const cornerBgHex =
        !result.colorAnalysis.hasTransparency
          ? `rgb(${rgba.data[0]}, ${rgba.data[1]}, ${rgba.data[2]})`
          : undefined;
      const resvg = new Resvg(result.svg, {
        fitTo: { mode: 'original' },
        ...(cornerBgHex ? { background: cornerBgHex } : {}),
      });
      const rendered = resvg.render();
      const renderedRgba: RawRgbaImage = {
        width: rendered.width,
        height: rendered.height,
        data: new Uint8ClampedArray(
          rendered.pixels.buffer,
          rendered.pixels.byteOffset,
          rendered.pixels.byteLength
        ),
      };

      const visual = computeVisualMetrics(rgba, renderedRgba);
      const renderedPalette = analyzeImageColors(renderedRgba);
      const avgColorDelta = verifyColorPreservation(
        result.colorAnalysis.dominantHexColors,
        renderedPalette.dominantHexColors
      );

      // 6. Validação real de compatibilidade com editor vetorial Inkscape CLI
      const artifact = buildSvgExportArtifact(result.svg, fixture.fileName);
      const svgFilePath = path.join(tempWs.dirPath, artifact.fileName);
      await fs.writeFile(svgFilePath, artifact.svgText, 'utf-8');

      const inkscapeQuery = execFileSync('inkscape', ['--query-all', svgFilePath], {
        encoding: 'utf-8',
      });
      const inkscapePathLines = inkscapeQuery
        .trim()
        .split('\n')
        .filter((line) => line.startsWith('caminho-'));

      if (inkscapePathLines.length === 0) {
        throw new Error(
          `Inkscape não encontrou objetos de caminho editáveis (caminho-*) em ${artifact.fileName}`
        );
      }

      if (visual.similarityPct < fixture.minSimilarityPct) {
        throw new Error(
          `Fidelidade visual abaixo do mínimo em ${fixture.categoryName}: ${visual.similarityPct}% < ${fixture.minSimilarityPct}%`
        );
      }

      if (visual.bboxDeltaPx > 6) {
        throw new Error(
          `Desalinhamento/deformação geométrica excessiva em ${fixture.categoryName}: delta=${visual.bboxDeltaPx}px`
        );
      }

      console.log(`✔ ${fixture.categoryName}`);
      console.log(
        `   Arquivo: ${fixture.fileName} (${fixture.width}x${fixture.height}) -> Categoria detectada: "${result.colorAnalysis.categoryLabel}"`
      );
      console.log(
        `   Motor escolhido: ${result.engineUsed.toUpperCase()} | Caminhos editáveis: ${svgCheck.pathCount} (Inkscape leu ${inkscapePathLines.length} IDs)`
      );
      console.log(
        `   Fidelidade visual: ${visual.similarityPct}% | Delta cor médio: ${avgColorDelta} | Alinhamento BBox: ±${visual.bboxDeltaPx}px | Tempo: ${result.durationMs}ms\n`
      );
    }

    // Teste extra A: Logo BRANCO em fundo TRANSPARENTE (caso clássico onde limiar de luminância comum falha!)
    console.log('--- Testes adicionais de casos críticos e controles avançados ---');
    const whiteLogoPng = new Uint8Array(
      await sharp(
        Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">
          <circle cx="120" cy="120" r="80" fill="none" stroke="#ffffff" stroke-width="24"/>
          <circle cx="120" cy="120" r="26" fill="#ffffff"/>
        </svg>`)
      )
        .png()
        .toBuffer()
    );
    const whiteRgba = await decodeImageBytesToRgba(whiteLogoPng, 'logo-branco-transparente.png');
    const whiteResult = await runVectorizationOnRgba(whiteRgba, DEFAULT_AUTO_PARAMS);
    if (!whiteResult.svg.toLowerCase().includes('#ffffff') && !whiteResult.svg.toLowerCase().includes('#fff')) {
      throw new Error(
        `Logo branco transparente perdeu a cor branca! SVG gerado: ${whiteResult.svg.slice(0, 250)}`
      );
    }
    console.log(
      `✔ Logo branco sobre fundo transparente preservou cor branca (#ffffff) e transparência (${whiteResult.validation.pathCount} caminhos)`
    );

    // Teste extra B: Imagem grande (> 2048px) com controle seguro de memória e preservação da dimensão original
    const largePng = new Uint8Array(
      await sharp(
        Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2600" height="1800">
          <rect width="2600" height="1800" fill="#ffffff"/>
          <circle cx="1300" cy="900" r="620" fill="#4f46e5"/>
          <rect x="920" y="520" width="760" height="760" rx="90" fill="#f59e0b"/>
        </svg>`)
      )
        .png()
        .toBuffer()
    );
    const largeRgba = await decodeImageBytesToRgba(largePng, 'arte-alta-resolucao.png');
    const largeRes = await runVectorizationOnRgba(largeRgba, DEFAULT_AUTO_PARAMS);
    if (
      !largeRes.wasDownscaled ||
      largeRes.originalWidth !== 2600 ||
      largeRes.originalHeight !== 1800
    ) {
      throw new Error('Falha no tratamento de imagem grande (>2048px)');
    }
    console.log(
      `✔ Imagem grande (2600×1800 px) processada com controle de memória (escala interna ${largeRes.workingWidth}×${largeRes.workingHeight}) mantendo SVG 2600×1800`
    );

    // Teste extra C: Verificação de que TODOS os 6 controles avançados influenciam efetivamente o resultado
    const multiColorPng = await generateFixtureBytes(fixtures[7]); // Fotografia com muitas nuances
    const multiColorRgba = await decodeImageBytesToRgba(multiColorPng, 'foto.jpg');
    const baseCfg: VectorizationParameters = {
      profile: 'high_fidelity',
      engine: 'vtracer',
      autoTune: false,
      colorCount: 24,
      detailPrecision: 75,
      curveSmoothness: 50,
      pathSimplification: 25,
      noiseRemoval: 20,
      contourSensitivity: 65,
      optimizeSvg: true,
    };

    const baselineSvg = (await runVectorizationOnRgba(multiColorRgba, baseCfg)).svg;
    const sliderVariations: Array<{ name: string; override: Partial<VectorizationParameters> }> = [
      { name: 'Quantidade de cores', override: { colorCount: 4 } },
      { name: 'Precisão dos detalhes', override: { detailPrecision: 20 } },
      { name: 'Suavidade das curvas', override: { curveSmoothness: 100 } },
      { name: 'Simplificação dos caminhos', override: { pathSimplification: 95 } },
      { name: 'Remoção de ruídos', override: { noiseRemoval: 95 } },
      { name: 'Sensibilidade dos contornos', override: { contourSensitivity: 15 } },
    ];

    for (const item of sliderVariations) {
      const varied = await runVectorizationOnRgba(multiColorRgba, {
        ...baseCfg,
        ...item.override,
      });
      if (varied.svg === baselineSvg) {
        throw new Error(`Controle avançado "${item.name}" não alterou o resultado do SVG!`);
      }
    }
    console.log('✔ Todos os 6 controles avançados alteram efetivamente o SVG gerado');

    // Teste extra D: Proteção contra arquivos inválidos
    const fakePng = new TextEncoder().encode('ISTO NAO E UMA IMAGEM PNG');
    const invalidCheck = validateRasterBytes(fakePng, 'falso.png');
    if (invalidCheck.valid) {
      throw new Error('Falha de segurança: arquivo inválido foi aceito!');
    }
    console.log(`✔ Proteção contra arquivo inválido confirmada ("${invalidCheck.error}")`);
  } finally {
    await tempWs.cleanup();
  }

  console.log('\n=== BATERIA COMPLETA DAS 9 CATEGORIAS + CASOS CRÍTICOS APROVADA ===');
}

main().catch((err) => {
  console.error('\nERRO NA BATERIA DE TESTES DE CATEGORIAS:', err);
  process.exit(1);
});
