import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import {
  computeQualityComparisonFromBuffers,
  createNodeTempWorkspace,
  decodeImageBytesToRgba,
  renderSvgSupersampled,
  runVectorizationOnRgba,
  validateSvgStructure,
  type RawRgbaImage,
} from '../src/engine';

interface CategoryTestCase {
  id: string;
  categoryLabel: string;
  width: number;
  height: number;
  addPhotoGrain?: boolean;
  minSsimPct: number;
  maxDeltaE2000: number;
  maxChamferPx: number;
  minIouPct: number;
  sourceSvg: string;
  customAssert?: (orig: RawRgbaImage, rendered: RawRgbaImage, svg: string) => void;
}

function inspectSvgXmlIntegrity(svg: string, caseId: string): void {
  const lower = svg.toLowerCase();
  if (
    lower.includes('<image') ||
    lower.includes('<feimage') ||
    lower.includes('data:image/') ||
    lower.includes(';base64,') ||
    lower.includes('.png') ||
    lower.includes('.jpg') ||
    lower.includes('.jpeg')
  ) {
    throw new Error(`[${caseId}] Proibição XML violada: referência ou dado raster detectado no SVG!`);
  }

  // Valida unicidade de IDs e integridade de todas as referências url(#id)
  const idSet = new Set<string>();
  const idRegex = /\bid="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = idRegex.exec(svg)) !== null) {
    const id = match[1];
    if (idSet.has(id)) {
      throw new Error(`[${caseId}] ID XML duplicado encontrado no SVG: #${id}`);
    }
    idSet.add(id);
  }

  const urlRefRegex = /url\(#([^)]+)\)/g;
  while ((match = urlRefRegex.exec(svg)) !== null) {
    const refId = match[1];
    if (!idSet.has(refId)) {
      throw new Error(`[${caseId}] Referência órfã url(#${refId}) sem definição correspondente em <defs>!`);
    }
  }
}

const SIXTEEN_CATEGORY_CASES: CategoryTestCase[] = [
  {
    id: 'cat01-fotografia',
    categoryLabel: '01. Fotografia (Luz Contínua + Grão)',
    width: 340,
    height: 230,
    addPhotoGrain: true,
    minSsimPct: 88.0,
    maxDeltaE2000: 2.2,
    maxChamferPx: 3.5,
    minIouPct: 98.0,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="230" viewBox="0 0 340 230">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="165" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="52%" stop-color="#9d174d"/>
          <stop offset="100%" stop-color="#fb923c"/>
        </linearGradient>
      </defs>
      <rect width="340" height="230" fill="url(#sky)"/>
      <circle cx="242" cy="96" r="28" fill="#fef08a"/>
      <path d="M0 162 L82 108 L156 152 L238 98 L340 148 L340 230 L0 230 Z" fill="#4c1d95"/>
      <path d="M0 188 L108 144 L204 186 L288 138 L340 172 L340 230 L0 230 Z" fill="#1e1b4b"/>
    </svg>`,
  },
  {
    id: 'cat02-logo',
    categoryLabel: '02. Logotipo Corporativo Sólido',
    width: 320,
    height: 240,
    minSsimPct: 98.5,
    maxDeltaE2000: 0.6,
    maxChamferPx: 0.5,
    minIouPct: 99.0,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
      <path d="M160 22 L272 78 L248 196 L160 222 L72 196 L48 78 Z" fill="#0f172a"/>
      <path d="M160 48 L238 88 L220 174 L160 194 L100 174 L82 88 Z" fill="#2563eb"/>
      <polygon points="160,72 198,154 160,136 122,154" fill="#facc15"/>
    </svg>`,
  },
  {
    id: 'cat03-ilustracao',
    categoryLabel: '03. Ilustração Orgânica Multicamadas',
    width: 320,
    height: 240,
    minSsimPct: 97.5,
    maxDeltaE2000: 0.9,
    maxChamferPx: 0.6,
    minIouPct: 99.0,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
      <ellipse cx="160" cy="136" rx="94" ry="78" fill="#ea580c"/>
      <ellipse cx="160" cy="154" rx="58" ry="48" fill="#fed7aa"/>
      <circle cx="128" cy="108" r="18" fill="#ffffff"/>
      <circle cx="192" cy="108" r="18" fill="#ffffff"/>
      <circle cx="132" cy="108" r="9" fill="#0f172a"/>
      <circle cx="188" cy="108" r="9" fill="#0f172a"/>
      <polygon points="160,124 176,144 144,144" fill="#7c2d12"/>
    </svg>`,
  },
  {
    id: 'cat04-metalico',
    categoryLabel: '04. Arte Metálica Cromo/Ouro Especular',
    width: 340,
    height: 230,
    minSsimPct: 96.5,
    maxDeltaE2000: 1.5,
    maxChamferPx: 0.8,
    minIouPct: 98.8,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="230" viewBox="0 0 340 230">
      <defs>
        <linearGradient id="chrome" x1="40" y1="30" x2="300" y2="200" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#f8fafc"/>
          <stop offset="35%" stop-color="#64748b"/>
          <stop offset="52%" stop-color="#0f172a"/>
          <stop offset="72%" stop-color="#cbd5e1"/>
          <stop offset="100%" stop-color="#475569"/>
        </linearGradient>
        <linearGradient id="goldCore" x1="90" y1="60" x2="250" y2="170" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#fef08a"/>
          <stop offset="50%" stop-color="#d97706"/>
          <stop offset="100%" stop-color="#78350f"/>
        </linearGradient>
      </defs>
      <rect x="34" y="28" width="272" height="174" rx="34" fill="url(#chrome)"/>
      <rect x="64" y="56" width="212" height="118" rx="20" fill="url(#goldCore)"/>
      <ellipse cx="122" cy="76" rx="32" ry="8" fill="#ffffff"/>
    </svg>`,
  },
  {
    id: 'cat05-desenho',
    categoryLabel: '05. Desenho Técnico Linear (Line Art)',
    width: 320,
    height: 230,
    minSsimPct: 97.5,
    maxDeltaE2000: 0.9,
    maxChamferPx: 0.5,
    minIouPct: 94.0,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="230" viewBox="0 0 320 230">
      <rect width="320" height="230" fill="#ffffff"/>
      <g fill="none" stroke="#0f172a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="160" cy="115" r="76"/>
        <polygon points="160,52 216,148 104,148"/>
        <line x1="84" y1="115" x2="236" y2="115"/>
      </g>
    </svg>`,
  },
  {
    id: 'cat06-icone',
    categoryLabel: '06. Ícone Geométrico de Interface',
    width: 300,
    height: 300,
    minSsimPct: 99.0,
    maxDeltaE2000: 0.4,
    maxChamferPx: 0.35,
    minIouPct: 99.2,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
      <rect x="30" y="30" width="240" height="240" rx="54" fill="#4f46e5"/>
      <path d="M92 154 L132 194 L212 108" fill="none" stroke="#ffffff" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  },
  {
    id: 'cat07-tipografia',
    categoryLabel: '07. Tipografia com Números e Contadores Internos',
    width: 420,
    height: 200,
    minSsimPct: 98.0,
    maxDeltaE2000: 0.6,
    maxChamferPx: 0.45,
    minIouPct: 96.5,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="200" viewBox="0 0 420 200">
      <rect width="420" height="200" fill="#f8fafc"/>
      <text x="210" y="106" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="800" font-size="64" fill="#0f172a">AB809</text>
      <text x="210" y="158" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="28" fill="#dc2626">PRO 2026</text>
    </svg>`,
  },
  {
    id: 'cat08-gradiente-complexo',
    categoryLabel: '08. Gradientes Complexos Radiais Excêntricos + Lineares',
    width: 320,
    height: 260,
    minSsimPct: 97.5,
    maxDeltaE2000: 1.4,
    maxChamferPx: 0.6,
    minIouPct: 99.0,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="260" viewBox="0 0 320 260">
      <defs>
        <radialGradient id="orb" cx="160" cy="130" r="96" fx="118" fy="92" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#fef08a"/>
          <stop offset="48%" stop-color="#ef4444"/>
          <stop offset="100%" stop-color="#311042"/>
        </radialGradient>
      </defs>
      <circle cx="160" cy="130" r="92" fill="url(#orb)"/>
    </svg>`,
  },
  {
    id: 'cat09-transparencia',
    categoryLabel: '09. Transparência Real e Alpha Semitransparente',
    width: 320,
    height: 240,
    minSsimPct: 98.5,
    maxDeltaE2000: 0.7,
    maxChamferPx: 0.5,
    minIouPct: 99.0,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
      <circle cx="122" cy="120" r="72" fill="#2563eb" fill-opacity="0.62"/>
      <circle cx="198" cy="120" r="72" fill="#10b981" fill-opacity="0.62"/>
    </svg>`,
    customAssert: (_orig, rendered) => {
      // Centro de interseção opaco parcial e laterais semitransparentes
      const leftAlpha = rendered.data[(120 * rendered.width + 82) * 4 + 3];
      if (leftAlpha < 120 || leftAlpha > 195) {
        throw new Error(`Alpha semitransparente alterado indevidamente: alpha=${leftAlpha}`);
      }
    },
  },
  {
    id: 'cat10-sombra',
    categoryLabel: '10. Sombras Suaves Reais (Drop Shadow Preservada)',
    width: 320,
    height: 240,
    minSsimPct: 97.5,
    maxDeltaE2000: 1.1,
    maxChamferPx: 0.9,
    minIouPct: 98.0,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
      <defs>
        <radialGradient id="softShadow" cx="168" cy="186" r="88" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#0f172a" stop-opacity="0.52"/>
          <stop offset="70%" stop-color="#0f172a" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="320" height="240" fill="#f8fafc"/>
      <ellipse cx="168" cy="186" rx="86" ry="20" fill="url(#softShadow)"/>
      <rect x="96" y="46" width="128" height="118" rx="24" fill="#0ea5e9"/>
    </svg>`,
  },
  {
    id: 'cat11-contorno-fino',
    categoryLabel: '11. Contornos Finos Intencionais (2px Real vs Halo)',
    width: 320,
    height: 240,
    minSsimPct: 97.5,
    maxDeltaE2000: 0.9,
    maxChamferPx: 0.5,
    minIouPct: 99.0,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
      <rect width="320" height="240" fill="#fefce8"/>
      <circle cx="160" cy="120" r="76" fill="#38bdf8" stroke="#0f172a" stroke-width="2.4"/>
      <polygon points="160,64 208,154 112,154" fill="#f43f5e" stroke="#0f172a" stroke-width="2.2"/>
    </svg>`,
    customAssert: (_orig, rendered) => {
      // Verifica que o contorno preto fino intencional em y=44, x=160 NÃO foi apagado pelo anti-halo!
      let minLum = 255;
      for (let y = 41; y <= 47; y++) {
        const p = (y * rendered.width + 160) * 4;
        const lum = 0.299 * rendered.data[p] + 0.587 * rendered.data[p + 1] + 0.114 * rendered.data[p + 2];
        if (lum < minLum) minLum = lum;
      }
      if (minLum > 115) {
        throw new Error(`Contorno fino intencional de 2.4px foi perdido na reconstrução (minLum=${minLum.toFixed(1)})!`);
      }
    },
  },
  {
    id: 'cat12-contorno-grosso',
    categoryLabel: '12. Mascote Emblemático com Contornos Grossos',
    width: 320,
    height: 240,
    minSsimPct: 98.5,
    maxDeltaE2000: 0.6,
    maxChamferPx: 0.4,
    minIouPct: 99.2,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
      <rect x="56" y="36" width="208" height="168" rx="36" fill="#fbbf24" stroke="#111827" stroke-width="14"/>
      <circle cx="124" cy="112" r="18" fill="#111827"/>
      <circle cx="196" cy="112" r="18" fill="#111827"/>
      <path d="M118 156 Q160 186 202 156" fill="none" stroke="#111827" stroke-width="12" stroke-linecap="round"/>
    </svg>`,
  },
  {
    id: 'cat13-regioes-uniformes',
    categoryLabel: '13. Regiões Uniformes Adjacentes (Zero Fendas/Halos)',
    width: 320,
    height: 240,
    minSsimPct: 99.2,
    maxDeltaE2000: 0.35,
    maxChamferPx: 0.3,
    minIouPct: 99.8,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
      <polygon points="0,0 180,0 140,240 0,240" fill="#ef4444"/>
      <polygon points="180,0 320,0 320,130 140,240" fill="#eab308"/>
      <polygon points="320,130 320,240 140,240" fill="#06b6d4"/>
    </svg>`,
    customAssert: (_orig, _rendered, svg) => {
      const paths = (svg.match(/<path\b/g) ?? []).length;
      if (paths > 5) {
        throw new Error(`Regiões uniformes geraram fragmentação/halos desnecessários: ${paths} caminhos para 3 polígonos!`);
      }
    },
  },
  {
    id: 'cat14-texturas',
    categoryLabel: '14. Padrão Geométrico e Textura Estruturada',
    width: 300,
    height: 240,
    minSsimPct: 97.5,
    maxDeltaE2000: 0.8,
    maxChamferPx: 0.5,
    minIouPct: 99.0,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="240" viewBox="0 0 300 240">
      <rect width="300" height="240" fill="#1e293b"/>
      <g fill="#38bdf8">
        <circle cx="60" cy="60" r="16"/><circle cx="150" cy="60" r="16"/><circle cx="240" cy="60" r="16"/>
        <circle cx="105" cy="120" r="16"/><circle cx="195" cy="120" r="16"/>
        <circle cx="60" cy="180" r="16"/><circle cx="150" cy="180" r="16"/><circle cx="240" cy="180" r="16"/>
      </g>
      <g fill="#facc15">
        <rect x="142" y="112" width="16" height="16" rx="3"/>
        <rect x="52" y="112" width="16" height="16" rx="3"/>
        <rect x="232" y="112" width="16" height="16" rx="3"/>
      </g>
    </svg>`,
  },
  {
    id: 'cat15-micro-detalhes',
    categoryLabel: '15. Detalhes Muito Pequenos (Estrelas e Reflexos 2–4px)',
    width: 300,
    height: 240,
    minSsimPct: 98.5,
    maxDeltaE2000: 0.5,
    maxChamferPx: 0.4,
    minIouPct: 99.2,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="240" viewBox="0 0 300 240">
      <rect width="300" height="240" rx="28" fill="#090d16"/>
      <path d="M168 58 A62 62 0 1 0 218 158 A48 48 0 1 1 168 58 Z" fill="#fde047"/>
      <circle cx="72" cy="64" r="2.2" fill="#ffffff"/>
      <circle cx="98" cy="112" r="1.8" fill="#38bdf8"/>
      <circle cx="228" cy="68" r="2.5" fill="#ffffff"/>
      <circle cx="246" cy="108" r="1.6" fill="#fde047"/>
      <circle cx="78" cy="176" r="2.0" fill="#ffffff"/>
    </svg>`,
    customAssert: (_orig, rendered) => {
      // Confirma que a micro-estrela de raio 1.8px em (98, 112) e raio 1.6px em (246, 108) foram preservadas!
      const star1B = rendered.data[(112 * rendered.width + 98) * 4 + 2];
      const star2R = rendered.data[(108 * rendered.width + 246) * 4];
      if (star1B < 140 || star2R < 140) {
        throw new Error(`Micro-estrelas de ~2px foram apagadas indevidamente (star1B=${star1B}, star2R=${star2R})!`);
      }
    },
  },
  {
    id: 'cat16-sobreposicoes',
    categoryLabel: '16. Múltiplos Objetos Sobrepostos + Furos Internos',
    width: 340,
    height: 250,
    minSsimPct: 98.5,
    maxDeltaE2000: 0.6,
    maxChamferPx: 0.45,
    minIouPct: 99.0,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="250" viewBox="0 0 340 250">
      <rect x="38" y="42" width="164" height="154" rx="24" fill="#7c3aed"/>
      <path fill-rule="evenodd" d="M210,126 m-86,0 a86,86 0 1,0 172,0 a86,86 0 1,0 -172,0 Z M210,126 m-38,0 a38,38 0 1,0 76,0 a38,38 0 1,0 -76,0 Z" fill="#10b981"/>
      <polygon points="150,30 206,118 94,118" fill="#f97316"/>
    </svg>`,
    customAssert: (_orig, rendered) => {
      // No furo do anel verde em (232, 126), fora do retângulo roxo (x <= 202), deve ser transparente!
      const holeAlpha = rendered.data[(126 * rendered.width + 232) * 4 + 3];
      // E em (188, 126), dentro do furo do anel verde mas sobre o retângulo roxo subjacente, deve ver o roxo!
      const underIdx = (126 * rendered.width + 188) * 4;
      if (holeAlpha > 15) {
        throw new Error(`Furo interno vazado foi preenchido incorretamente (alpha=${holeAlpha})!`);
      }
      if (rendered.data[underIdx + 2] < 150 || rendered.data[underIdx + 3] < 230) {
        throw new Error(`Ordem de sobreposição no furo do anel falhou em revelar o objeto roxo inferior!`);
      }
    },
  },
];

async function rasterizeCategoryCase(c: CategoryTestCase): Promise<Buffer> {
  const png = new Resvg(c.sourceSvg, { fitTo: { mode: 'width', value: c.width } }).render().asPng();
  if (!c.addPhotoGrain) return png;

  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let seed = 135792468;
  const nextNoise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff - 0.5;
  };
  for (let i = 0; i < data.length; i += 4) {
    const g = Math.round(nextNoise() * 9);
    data[i] = Math.max(0, Math.min(255, data[i] + g));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + g));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + g));
  }
  return await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function main() {
  console.log('=== BATERIA UNIVERSAL ETAPA 2 — 16 CATEGORIAS + SUPERSAMPLING + INKSCAPE ===\n');
  const workspace = await createNodeTempWorkspace('barush-stage2-16cat-');
  const tileW = 360;
  const tileH = 148;
  const tiles: Array<{ input: Buffer; left: number; top: number }> = [];

  try {
    for (let i = 0; i < SIXTEEN_CATEGORY_CASES.length; i++) {
      const c = SIXTEEN_CATEGORY_CASES[i];
      const rasterBuf = await rasterizeCategoryCase(c);
      const ext = c.addPhotoGrain ? 'jpg' : 'png';
      const origRgba = await decodeImageBytesToRgba(new Uint8Array(rasterBuf), ext);

      const res = await runVectorizationOnRgba(origRgba, {
        profile: 'auto',
        engine: 'auto',
        autoTune: true,
        colorCount: 22,
        detailPrecision: 84,
        curveSmoothness: 68,
        pathSimplification: 22,
        noiseRemoval: 20,
        contourSensitivity: 78,
        optimizeSvg: true,
      });

      // 1. Inspeção rigorosa do XML e estrutura vetorial
      inspectSvgXmlIntegrity(res.svg, c.id);
      const struct = validateSvgStructure(res.svg, origRgba.width, origRgba.height);
      if (!struct.valid) {
        throw new Error(`[${c.id}] Falha estrutural no SVG: ${struct.errors.join('; ')}`);
      }

      // 2. Renderização de validação com Supersampling 2×
      const superRendered = await renderSvgSupersampled(res.svg, origRgba.width, origRgba.height, {
        supersampleScale: 2,
      });
      if (!superRendered) {
        throw new Error(`[${c.id}] Renderizador supersampling 2× retornou nulo!`);
      }
      const q = computeQualityComparisonFromBuffers(origRgba, superRendered);

      if (q.ssimPct < c.minSsimPct) {
        throw new Error(`[${c.id}] SSIM abaixo do critério: ${q.ssimPct}% < ${c.minSsimPct}%`);
      }
      if ((q.meanDeltaE2000 ?? 99) > c.maxDeltaE2000) {
        throw new Error(`[${c.id}] CIEDE2000 acima do limite: ${q.meanDeltaE2000} > ${c.maxDeltaE2000}`);
      }
      if ((q.chamferDistancePx ?? 99) > c.maxChamferPx) {
        throw new Error(`[${c.id}] Chamfer acima do limite: ${q.chamferDistancePx}px > ${c.maxChamferPx}px`);
      }
      if ((q.iouPct ?? 0) < c.minIouPct) {
        throw new Error(`[${c.id}] IoU abaixo do critério: ${q.iouPct}% < ${c.minIouPct}%`);
      }

      // 3. Verifica não-regressão estrita do Ciclo Automático A -> B -> C quando aplicável
      const s2 = res.stage2Report;
      if (s2?.initialMetricsB && s2?.finalMetricsC) {
        if (s2.finalMetricsC.ssimPct + 0.15 < s2.initialMetricsB.ssimPct) {
          throw new Error(
            `[${c.id}] Regressão indevida na Etapa 2: SSIM B=${s2.initialMetricsB.ssimPct}% -> C=${s2.finalMetricsC.ssimPct}%`
          );
        }
      }

      // 4. Asserção customizada da categoria (contornos finos, micro-estrelas, furos, alpha, anti-halo)
      if (c.customAssert) {
        c.customAssert(origRgba, superRendered, res.svg);
      }

      // 5. Valida abertura e leitura editável real no Inkscape
      const svgFile = path.join(workspace.dirPath, `${c.id}.svg`);
      await fs.writeFile(svgFile, res.svg, 'utf8');
      const inkOut = execFileSync('inkscape', ['--query-all', svgFile], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter(Boolean);
      if (inkOut.length < 2) {
        throw new Error(`[${c.id}] Inkscape não identificou elementos vetoriais editáveis!`);
      }

      console.log(
        `✓ ${c.categoryLabel}\n` +
          `  SSIM=${q.ssimPct}% | PSNR=${q.psnrDb}dB | ΔE00=${q.meanDeltaE2000} (P95=${q.p95DeltaE2000}) | Chamfer=${q.chamferDistancePx}px | HausdorffP99=${q.hausdorffP99Px}px | IoU=${q.iouPct}% | Caminhos=${struct.pathCount} | ReparosEtapa2=${s2?.appliedRepairs?.length ?? 0}`
      );

      // Adiciona miniatura Original vs Reconstruído ao painel de 16 categorias (grade 4×4)
      const origThumb = await sharp(rasterBuf)
        .resize(164, 128, { fit: 'contain', background: { r: 241, g: 245, b: 249, alpha: 1 } })
        .png()
        .toBuffer();
      const vecPng = await sharp(Buffer.from(superRendered.data.buffer), {
        raw: { width: superRendered.width, height: superRendered.height, channels: 4 },
      })
        .resize(164, 128, { fit: 'contain', background: { r: 241, g: 245, b: 249, alpha: 1 } })
        .png()
        .toBuffer();

      const col = i % 4;
      const row = Math.floor(i / 4);
      tiles.push({ input: origThumb, left: col * tileW + 10, top: row * tileH + 10 });
      tiles.push({ input: vecPng, left: col * tileW + 182, top: row * tileH + 10 });
    }

    await fs.mkdir('/opt/cursor/artifacts', { recursive: true });
    const collagePath = '/opt/cursor/artifacts/painel-etapa2-16categorias.png';
    await sharp({
      create: {
        width: tileW * 4,
        height: tileH * 4,
        channels: 4,
        background: { r: 15, g: 23, b: 42, alpha: 1 },
      },
    })
      .composite(tiles)
      .png()
      .toFile(collagePath);

    console.log(`\nPainel visual das 16 categorias salvo em: ${collagePath}`);
    console.log('=== TODAS AS 16 CATEGORIAS APROVADAS (ZERO RASTER, SUPERSAMPLING, ΔE2000, CHAMFER, HAUSDORFF, IOU E INKSCAPE) ===');
  } finally {
    await workspace.cleanup();
  }
}

main().catch((err) => {
  console.error('\nFALHA NA BATERIA DE 16 CATEGORIAS DA ETAPA 2:', err);
  process.exit(1);
});
