import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import {
  computeQualityComparisonFromBuffers,
  createNodeTempWorkspace,
  decodeImageBytesToRgba,
  registerStage2VerificationHook,
  runVectorizationOnRgba,
  validateSvgStructure,
  type RawRgbaImage,
} from '../src/engine';

interface UniversalBenchmarkCase {
  id: string;
  title: string;
  width: number;
  height: number;
  sourceSvg: string;
  addPhotoGrain?: boolean;
  minSsimPct: number;
  minColorLabPct: number;
  customChecks?: (
    original: RawRgbaImage,
    rendered: RawRgbaImage,
    svgContent: string
  ) => void;
}

function getPixel(img: RawRgbaImage, x: number, y: number): [number, number, number, number] {
  const cx = Math.max(0, Math.min(img.width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(img.height - 1, Math.round(y)));
  const idx = (cy * img.width + cx) * 4;
  return [img.data[idx], img.data[idx + 1], img.data[idx + 2], img.data[idx + 3]];
}

const BENCHMARK_CASES: UniversalBenchmarkCase[] = [
  {
    id: 'logo-escudo-vazado-faixa',
    title: '1. Logotipo Bipartido com Vazado Interno + Texto sobre Faixa Dourada',
    width: 420,
    height: 360,
    minSsimPct: 95.5,
    minColorLabPct: 96.0,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="360" viewBox="0 0 420 360">
      <defs>
        <linearGradient id="goldRibbon" x1="90" y1="265" x2="330" y2="315" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#f59e0b"/>
          <stop offset="50%" stop-color="#fde047"/>
          <stop offset="100%" stop-color="#d97706"/>
        </linearGradient>
      </defs>
      <!-- Anel externo vazado (evenodd real: centro superior em 210,72 deve permanecer transparente!) -->
      <path fill="#0f172a" fill-rule="evenodd" d="M210 18 C288 18 350 80 350 158 C350 236 288 298 210 298 C132 298 70 236 70 158 C70 80 132 18 210 18 Z M210 42 C146 42 94 94 94 158 C94 222 146 274 210 274 C274 274 326 222 326 158 C326 94 274 42 210 42 Z"/>
      <!-- Escudo central bipartido: metade esquerda azul e metade direita vermelha compartilhando fronteira x=210 -->
      <path fill="#2563eb" d="M210 68 L138 96 L138 166 C138 208 168 238 210 252 Z"/>
      <path fill="#dc2626" d="M210 68 L282 96 L282 166 C282 208 252 238 210 252 Z"/>
      <!-- Estrela branca central sobre a costura -->
      <polygon fill="#ffffff" points="210,122 218,144 242,144 223,158 230,180 210,167 190,180 197,158 178,144 202,144"/>
      <!-- Faixa dourada com degradê sob tipografia escura -->
      <rect x="86" y="272" width="248" height="50" rx="10" fill="url(#goldRibbon)"/>
      <text x="210" y="305" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="800" font-size="24" letter-spacing="2" fill="#1e1b4b">STUDIO PRO</text>
    </svg>`,
    customChecks: (_orig, rendered) => {
      // 1) Verifica espaço vazio real entre o anel externo e o escudo (ex.: x=210, y=54 deve ser transparente!)
      const [, , , holeAlpha] = getPixel(rendered, 210, 54);
      if (holeAlpha > 25) {
        throw new Error(`Espaço vazado interno do anel foi preenchido indevidamente (alpha=${holeAlpha})`);
      }
      // 2) Verifica fronteira compartilhada x=210 entre azul e vermelho (ex.: y=105 e y=215 não podem vazar fundo transparente!)
      const [, , , seamTopA] = getPixel(rendered, 210, 105);
      const [, , , seamBotA] = getPixel(rendered, 210, 215);
      if (seamTopA < 235 || seamBotA < 235) {
        throw new Error(
          `Fenda detectada na fronteira compartilhada entre regiões (alpha=${seamTopA}, ${seamBotA})`
        );
      }
      // 3) Verifica que a faixa dourada sob "STUDIO PRO" NÃO sofreu apagamento retangular transparente/branco
      const [rr, rg, , ra] = getPixel(rendered, 210, 278);
      if (ra < 235 || rr < 180 || rg < 110) {
        throw new Error(
          `Substrato da faixa dourada sob o texto foi danificado: rgba=(${rr},${rg},a=${ra})`
        );
      }
    },
  },
  {
    id: 'personagem-mascote-detalhado',
    title: '2. Personagem / Mascote com Olhos, Reflexos, Sombras e Subtons',
    width: 400,
    height: 400,
    minSsimPct: 96.0,
    minColorLabPct: 96.5,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
      <defs>
        <linearGradient id="foxFur" x1="120" y1="80" x2="280" y2="330" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#fb923c"/>
          <stop offset="55%" stop-color="#f97316"/>
          <stop offset="100%" stop-color="#c2410c"/>
        </linearGradient>
        <radialGradient id="cheekPink" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stop-color="#fb7185" stop-opacity="0.85"/>
          <stop offset="100%" stop-color="#fb7185" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="400" height="400" fill="#f8fafc"/>
      <!-- Sombra de base -->
      <ellipse cx="200" cy="356" rx="95" ry="14" fill="#cbd5e1"/>
      <!-- Orelhas pontudas -->
      <polygon points="105,155 82,52 168,108" fill="#ea580c"/>
      <polygon points="112,142 96,74 152,112" fill="#fed7aa"/>
      <polygon points="295,155 318,52 232,108" fill="#ea580c"/>
      <polygon points="288,142 304,74 248,112" fill="#fed7aa"/>
      <!-- Cabeça arredondada -->
      <ellipse cx="200" cy="212" rx="116" ry="104" fill="url(#foxFur)"/>
      <!-- Máscara facial creme -->
      <path d="M96 226 C126 196 168 206 200 242 C232 206 274 196 304 226 C296 282 252 316 200 316 C148 316 104 282 96 226 Z" fill="#fff7ed"/>
      <!-- Bochechas suaves -->
      <ellipse cx="132" cy="246" rx="18" ry="11" fill="#fda4af"/>
      <ellipse cx="268" cy="246" rx="18" ry="11" fill="#fda4af"/>
      <!-- Olho esquerdo (esclera + pupila + reflexo especular pequeno) -->
      <circle cx="154" cy="196" r="18" fill="#ffffff"/>
      <circle cx="157" cy="196" r="10" fill="#0f172a"/>
      <circle cx="153" cy="192" r="3.2" fill="#ffffff"/>
      <!-- Olho direito (esclera + pupila + reflexo especular pequeno) -->
      <circle cx="246" cy="196" r="18" fill="#ffffff"/>
      <circle cx="243" cy="196" r="10" fill="#0f172a"/>
      <circle cx="239" cy="192" r="3.2" fill="#ffffff"/>
      <!-- Focinho escuro + brilho superior -->
      <ellipse cx="200" cy="246" rx="15" ry="10" fill="#1e293b"/>
      <ellipse cx="196" cy="243" rx="5" ry="2.2" fill="#94a3b8"/>
    </svg>`,
    customChecks: (_orig, rendered) => {
      // Verifica preservação do pequeno reflexo branco (r=3.2) dentro da pupila escura esquerda (153, 192)
      const [hr, hg, hb] = getPixel(rendered, 153, 192);
      const [pr, pg, pb] = getPixel(rendered, 160, 199);
      if (hr < 200 || hg < 200 || hb < 200) {
        throw new Error(`Reflexo especular do olho foi perdido: rgb=(${hr},${hg},${hb})`);
      }
      if (pr > 60 || pg > 60 || pb > 75) {
        throw new Error(`Pupila escura do personagem perdeu contraste: rgb=(${pr},${pg},${pb})`);
      }
    },
  },
  {
    id: 'emblema-metalico-iluminado',
    title: '3. Superfície Metálica Cromada e Ouro 3D com Iluminação Especular Focal',
    width: 380,
    height: 380,
    minSsimPct: 95.5,
    minColorLabPct: 95.5,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="380" viewBox="0 0 380 380">
      <defs>
        <linearGradient id="chromeRing" x1="50" y1="40" x2="330" y2="340" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#f8fafc"/>
          <stop offset="22%" stop-color="#94a3b8"/>
          <stop offset="45%" stop-color="#1e293b"/>
          <stop offset="62%" stop-color="#ffffff"/>
          <stop offset="82%" stop-color="#64748b"/>
          <stop offset="100%" stop-color="#e2e8f0"/>
        </linearGradient>
        <radialGradient id="goldSphere" cx="190" cy="190" r="108" fx="148" fy="144" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#fef9c3"/>
          <stop offset="28%" stop-color="#facc15"/>
          <stop offset="68%" stop-color="#ca8a04"/>
          <stop offset="100%" stop-color="#713f12"/>
        </radialGradient>
      </defs>
      <rect width="380" height="380" fill="#090d16"/>
      <!-- Anel metálico cromado multi-stop -->
      <path fill="url(#chromeRing)" fill-rule="evenodd" d="M190 36 C275 36 344 105 344 190 C344 275 275 344 190 344 C105 344 36 275 36 190 C36 105 105 36 190 36 Z M190 74 C126 74 74 126 74 190 C74 254 126 306 190 306 C254 306 306 254 306 190 C306 126 254 74 190 74 Z"/>
      <!-- Esfera central dourada com foco deslocado -->
      <circle cx="190" cy="190" r="104" fill="url(#goldSphere)"/>
    </svg>`,
    customChecks: (_orig, rendered, svg) => {
      if (!svg.includes('<radialGradient') && !svg.includes('<linearGradient')) {
        throw new Error('Superfície metálica não utilizou gradientes vetoriais nativos');
      }
      // Ponto focal iluminado (150, 146) deve ser claramente mais luminoso que a borda sombreada (252, 248)
      const [lr, lg] = getPixel(rendered, 150, 146);
      const [sr, sg] = getPixel(rendered, 252, 248);
      if (lr + lg <= sr + sg + 90) {
        throw new Error(
          `Direção/foco de iluminação metálica não preservada: luz=(${lr},${lg}) vs sombra=(${sr},${sg})`
        );
      }
    },
  },
  {
    id: 'icone-geometrico-pontas-retas-curvas',
    title: '4. Ícone Técnico Misto (Pontas Agudas + Retas Exatas + Curvas Suaves)',
    width: 360,
    height: 360,
    minSsimPct: 96.5,
    minColorLabPct: 97.5,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360">
      <!-- Moldura hexagonal com arestas retas puras -->
      <polygon points="180,22 316,101 316,259 180,338 44,259 44,101" fill="#1e1b4b"/>
      <polygon points="180,46 295,113 295,247 180,314 65,247 65,113" fill="#312e81"/>
      <!-- Arco circular suave turquesa -->
      <circle cx="180" cy="180" r="88" fill="#06b6d4"/>
      <circle cx="180" cy="180" r="66" fill="#312e81"/>
      <!-- Estrela central de 4 pontas agudas -->
      <polygon points="180,104 198,162 256,180 198,198 180,256 162,198 104,180 162,162" fill="#facc15"/>
    </svg>`,
  },
  {
    id: 'estampa-botanica-detalhada',
    title: '5. Estampa / Ilustração Multi-Cor com Subtons e Micro-Detalhes',
    width: 420,
    height: 360,
    minSsimPct: 95.5,
    minColorLabPct: 96.5,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="360" viewBox="0 0 420 360">
      <rect width="420" height="360" fill="#fefce8"/>
      <!-- Folhas em múltiplos tons e subtons de verde -->
      <path d="M80 290 C70 190 140 110 230 80 C220 175 165 255 80 290 Z" fill="#15803d"/>
      <path d="M135 305 C165 215 245 155 345 150 C305 235 235 295 135 305 Z" fill="#0d9488"/>
      <path d="M65 210 C45 140 80 75 145 50 C145 120 115 175 65 210 Z" fill="#65a30d"/>
      <!-- Flor coral com camadas de pétalas em subtons -->
      <circle cx="245" cy="165" r="46" fill="#e11d48"/>
      <circle cx="245" cy="165" r="31" fill="#fb7185"/>
      <circle cx="245" cy="165" r="15" fill="#fde047"/>
      <!-- Pequenas bagas ornamentais (r=4px a 5px — não podem ser eliminadas!) -->
      <circle cx="315" cy="88" r="5" fill="#dc2626"/>
      <circle cx="336" cy="104" r="4.5" fill="#f97316"/>
      <circle cx="298" cy="112" r="4.5" fill="#dc2626"/>
      <circle cx="96" cy="322" r="5" fill="#0284c7"/>
    </svg>`,
    customChecks: (_orig, rendered) => {
      // Verifica que as pequenas bagas (r=4.5px..5px) não foram descartadas como ruído
      const [br, bg] = getPixel(rendered, 315, 88);
      if (br < 170 || bg > 90) {
        throw new Error(`Pequeno detalhe botânico (baga em 315,88) foi perdido: rgb=(${br},${bg})`);
      }
    },
  },
  {
    id: 'vidro-translucido-sobreposto',
    title: '6. Transparências Reais, Opacidade Parcial e Sobreposição',
    width: 380,
    height: 320,
    minSsimPct: 95.0,
    minColorLabPct: 95.5,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="320" viewBox="0 0 380 320">
      <defs>
        <linearGradient id="glassCard" x1="80" y1="80" x2="300" y2="250" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.62"/>
          <stop offset="100%" stop-color="#818cf8" stop-opacity="0.38"/>
        </linearGradient>
      </defs>
      <!-- Esferas sólidas vibrantes ao fundo (com fundo geral transparente!) -->
      <circle cx="125" cy="115" r="58" fill="#f43f5e"/>
      <circle cx="260" cy="205" r="62" fill="#f59e0b"/>
      <!-- Painel translúcido sobreposto -->
      <rect x="78" y="82" width="224" height="156" rx="24" fill="url(#glassCard)"/>
    </svg>`,
    customChecks: (_orig, rendered) => {
      // Canto externo (10,10) deve permanecer 100% transparente
      const [, , , cornerA] = getPixel(rendered, 10, 10);
      if (cornerA > 10) {
        throw new Error(`Fundo transparente foi preenchido indevidamente (alpha=${cornerA})`);
      }
      // Centro do painel translúcido fora das esferas (190, 160) deve preservar translucidez parcial
      const [, , , midA] = getPixel(rendered, 190, 160);
      if (midA < 60 || midA > 215) {
        throw new Error(`Opacidade parcial do vidro não foi preservada (alpha=${midA})`);
      }
    },
  },
  {
    id: 'desenho-traco-artistico',
    title: '7. Desenho Linear e Traço Caligráfico Contínuo',
    width: 380,
    height: 320,
    minSsimPct: 95.0,
    minColorLabPct: 96.5,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="320" viewBox="0 0 380 320">
      <rect width="380" height="320" fill="#ffffff"/>
      <path d="M52 248 C92 104 168 62 224 146 C264 206 306 184 334 86" fill="none" stroke="#0f172a" stroke-width="10" stroke-linecap="round"/>
      <path d="M68 274 C134 224 226 224 316 268" fill="none" stroke="#0f172a" stroke-width="5" stroke-linecap="round"/>
      <circle cx="190" cy="96" r="24" fill="none" stroke="#0f172a" stroke-width="6"/>
      <circle cx="190" cy="96" r="7" fill="#0f172a"/>
    </svg>`,
  },
  {
    id: 'fotografia-paisagem-natural',
    title: '8. Fotografia Natural Contínua com Luz Crepuscular e Grão',
    width: 420,
    height: 280,
    addPhotoGrain: true,
    minSsimPct: 86.5,
    minColorLabPct: 91.0,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="280" viewBox="0 0 420 280">
      <defs>
        <linearGradient id="duskSky" x1="0" y1="0" x2="0" y2="190" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#1e1b4b"/>
          <stop offset="48%" stop-color="#be185d"/>
          <stop offset="100%" stop-color="#fb923c"/>
        </linearGradient>
      </defs>
      <rect width="420" height="280" fill="url(#duskSky)"/>
      <circle cx="290" cy="118" r="34" fill="#fef08a"/>
      <path d="M0 195 L95 128 L188 182 L284 118 L368 172 L420 146 L420 280 L0 280 Z" fill="#4c1d95"/>
      <path d="M0 222 L124 168 L236 218 L342 162 L420 206 L420 280 L0 280 Z" fill="#1e1b4b"/>
    </svg>`,
  },
];

async function rasterizeCase(c: UniversalBenchmarkCase): Promise<Buffer> {
  const resvg = new Resvg(c.sourceSvg, { fitTo: { mode: 'width', value: c.width } });
  const png = resvg.render().asPng();

  if (!c.addPhotoGrain) {
    return png;
  }

  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let seed = 987654321;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff - 0.5;
  };
  for (let i = 0; i < data.length; i += 4) {
    const g = Math.round(rand() * 10);
    data[i] = Math.max(0, Math.min(255, data[i] + g));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + g));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + g));
  }
  return await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function main() {
  console.log('=== BENCHMARK UNIVERSAL DE RECONSTRUÇÃO VETORIAL (PARTE 1 — 8 CENÁRIOS CRÍTICOS) ===\n');
  const workspace = await createNodeTempWorkspace('barush-universal-bench-');
  const boardTiles: Array<{ input: Buffer; top: number; left: number }> = [];
  const tileW = 440;
  const tileH = 220;

  let hookInvokedCount = 0;
  registerStage2VerificationHook({
    id: 'stage2-universal-readiness-probe',
    name: 'Sonda de Prontidão Modular da Etapa 2',
    inspectScene: (scene) => {
      hookInvokedCount++;
      return {
        passed: scene.objects.length > 0 && scene.topologySummary.uncoveredForegroundPixels === 0,
        defects: [],
        inspectedRegionCount: scene.topologySummary.totalRegions,
      };
    },
  });

  try {
    for (let idx = 0; idx < BENCHMARK_CASES.length; idx++) {
      const bench = BENCHMARK_CASES[idx];
      const rasterBuf = await rasterizeCase(bench);
      const ext = bench.addPhotoGrain ? 'jpg' : 'png';
      const originalRgba = await decodeImageBytesToRgba(new Uint8Array(rasterBuf), ext);

      const result = await runVectorizationOnRgba(originalRgba, {
        profile: 'auto',
        engine: 'auto',
        autoTune: true,
        colorCount: 20,
        detailPrecision: 84,
        curveSmoothness: 68,
        pathSimplification: 22,
        noiseRemoval: 20,
        contourSensitivity: 78,
        optimizeSvg: true,
      });

      if (!result.sceneGraph || !result.stage2Report?.passed) {
        throw new Error(`[${bench.id}] Grafo de cena ou relatório modular da Etapa 2 inválido!`);
      }

      // 1. Proibição absoluta de raster embutido
      const lower = result.svg.toLowerCase();
      if (lower.includes('<image') || lower.includes('data:image/') || lower.includes(';base64,')) {
        throw new Error(`[${bench.id}] Violação grave: imagem raster detectada no SVG!`);
      }

      const structure = validateSvgStructure(
        result.svg,
        originalRgba.width,
        originalRgba.height
      );
      if (!structure.valid) {
        throw new Error(`[${bench.id}] Estrutura SVG inválida: ${structure.errors.join('; ')}`);
      }

      // 2. Renderiza SVG vetorial puro e mede fidelidade perceptual + topológica
      const renderedPng = new Resvg(result.svg, {
        fitTo: { mode: 'width', value: originalRgba.width },
      })
        .render()
        .asPng();
      const renderedRgba = await decodeImageBytesToRgba(new Uint8Array(renderedPng), 'png');

      const quality = computeQualityComparisonFromBuffers(originalRgba, renderedRgba);

      if (quality.ssimPct < bench.minSsimPct) {
        throw new Error(
          `[${bench.id}] SSIM abaixo do mínimo exigido: ${quality.ssimPct}% < ${bench.minSsimPct}%`
        );
      }
      if (quality.colorFidelityPct < bench.minColorLabPct) {
        throw new Error(
          `[${bench.id}] Fidelidade cromática Lab abaixo do mínimo: ${quality.colorFidelityPct}% < ${bench.minColorLabPct}%`
        );
      }

      // 3. Executa asserções geométricas/topológicas específicas (furos, fronteira compartilhada, reflexos, transparência)
      if (bench.customChecks) {
        bench.customChecks(originalRgba, renderedRgba, result.svg);
      }

      // 4. Valida leitura como vetores editáveis no Inkscape
      const svgPath = path.join(workspace.dirPath, `${bench.id}.svg`);
      await fs.writeFile(svgPath, result.svg, 'utf8');
      const inkscapeLines = execFileSync('inkscape', ['--query-all', svgPath], {
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
        .filter(Boolean);
      if (inkscapeLines.length < 2) {
        throw new Error(`[${bench.id}] Inkscape não encontrou objetos editáveis suficientes.`);
      }

      const sg = result.sceneGraph;
      let extraPhotoInfo = '';
      if (bench.addPhotoGrain) {
        const cleanRefPng = new Resvg(bench.sourceSvg, {
          fitTo: { mode: 'width', value: bench.width },
        })
          .render()
          .asPng();
        const cleanRefRgba = await decodeImageBytesToRgba(new Uint8Array(cleanRefPng), 'png');
        const cleanQuality = computeQualityComparisonFromBuffers(cleanRefRgba, renderedRgba);
        if (cleanQuality.ssimPct < 94.0 || cleanQuality.colorFidelityPct < 92.5) {
          throw new Error(
            `[${bench.id}] Reconstrução fotográfica perdeu fidelidade estrutural real: SSIM limpo=${cleanQuality.ssimPct}%, Cores limpas=${cleanQuality.colorFidelityPct}%`
          );
        }
        extraPhotoInfo = ` | [vs Cena Limpa s/ Ruído: SSIM=${cleanQuality.ssimPct}%, Cores Lab=${cleanQuality.colorFidelityPct}% (ΔE=${cleanQuality.meanDeltaELab})]`;
      }

      console.log(
        `✓ ${bench.title}\n` +
          `  Categoria=${result.colorAnalysis.detectedCategory} | Motor=${result.engineUsed} | SSIM=${quality.ssimPct}% | Cores Lab=${quality.colorFidelityPct}% (ΔE=${quality.meanDeltaELab}) | Contornos=${quality.contourFidelityPct}%${extraPhotoInfo}\n` +
          `  Objetos=${result.reconstructedObjectCount} | Caminhos=${result.validation.pathCount} | Gradientes=${result.reconstructedGradientCount} | Fronteiras Compartilhadas=${sg.topologySummary.sharedCanonicalBoundaries} | Inkscape IDs=${inkscapeLines.length}`
      );

      // Monta par Original vs Vetor para o painel visual
      const origThumb = await sharp(rasterBuf)
        .resize(200, 190, { fit: 'contain', background: { r: 241, g: 245, b: 249, alpha: 1 } })
        .png()
        .toBuffer();
      const vecThumb = await sharp(renderedPng)
        .resize(200, 190, { fit: 'contain', background: { r: 241, g: 245, b: 249, alpha: 1 } })
        .png()
        .toBuffer();

      const col = idx % 2;
      const row = Math.floor(idx / 2);
      boardTiles.push({ input: origThumb, left: col * tileW + 14, top: row * tileH + 18 });
      boardTiles.push({ input: vecThumb, left: col * tileW + 222, top: row * tileH + 18 });
    }

    if (hookInvokedCount !== BENCHMARK_CASES.length) {
      throw new Error('Hook da Etapa 2 não foi executado em todos os cenários');
    }

    await fs.mkdir('/opt/cursor/artifacts', { recursive: true });
    const boardPath = '/opt/cursor/artifacts/painel-universal-etapa1.png';
    await sharp({
      create: {
        width: tileW * 2,
        height: tileH * 4,
        channels: 4,
        background: { r: 15, g: 23, b: 42, alpha: 1 },
      },
    })
      .composite(boardTiles)
      .png()
      .toFile(boardPath);

    console.log(`\nPainel comparativo universal salvo em: ${boardPath}`);
    console.log(
      '=== TODOS OS 8 CENÁRIOS UNIVERSAIS APROVADOS (TOPOLOGIA, CORES OKLAB, GRADIENTES, PONTAS, FUROS E ETAPA 2) ==='
    );
  } finally {
    await workspace.cleanup();
  }
}

main().catch((err) => {
  console.error('\nFALHA NO BENCHMARK UNIVERSAL:', err);
  process.exit(1);
});
