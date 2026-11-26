import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { reconstructAppearance } from '../src/engine/geometric/appearance';
import type { RawRgbaImage } from '../src/engine/types';

async function raster(svg: string, width: number, height: number): Promise<RawRgbaImage> {
  const png = await sharp(Buffer.from(svg)).resize(width, height).ensureAlpha().png().toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data), sourceFormat: 'png' };
}

function count(svg: string, tag: string): number {
  return svg.match(new RegExp(`<${tag}\\b`, 'g'))?.length ?? 0;
}

async function main() {
  const lines = ['# Etapa 5 — Aparência, cores, gradientes e reflexos', ''];

  const solid = await raster(
    `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="90"><rect width="140" height="90" fill="#fff"/><rect x="24" y="18" width="92" height="54" fill="#111"/></svg>`,
    140,
    90
  );
  const black = reconstructAppearance(solid);
  assert.equal(black.objects.filter((item) => item.role === 'object').length, 1);
  assert.equal(black.objects[0].kind, 'solid');
  assert.equal(black.objects[0].geometry, black.objects[0].painted);
  assert.equal(count(black.svg, 'image') + count(black.svg, 'feImage'), 0);

  const goldSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect width="180" height="120" fill="#fff"/><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="30" y1="60" x2="150" y2="60"><stop offset="0%" stop-color="#5c3b09"/><stop offset="50%" stop-color="#d4a017"/><stop offset="100%" stop-color="#fff4c4"/></linearGradient></defs><ellipse cx="90" cy="60" rx="60" ry="36" fill="url(#g)"/></svg>`;
  const gold = reconstructAppearance(await raster(goldSvg, 180, 120));
  assert.equal(gold.objects.filter((item) => item.role === 'object').length, 1, 'o ouro foi fragmentado');
  assert.equal(gold.objects[0].kind, 'linear');
  assert.ok(gold.objects[0].stopCount >= 2);
  assert.equal(count(gold.svg, 'linearGradient'), 1);
  assert.equal(gold.objects[0].geometry, gold.objects[0].painted);
  assert.equal(count(gold.svg, 'image'), 0);

  const silverSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#fff"/><defs><radialGradient id="p" gradientUnits="userSpaceOnUse" cx="80" cy="80" r="58"><stop offset="0%" stop-color="#f8fafc"/><stop offset="55%" stop-color="#94a3b8"/><stop offset="100%" stop-color="#334155"/></radialGradient></defs><circle cx="80" cy="80" r="58" fill="url(#p)"/></svg>`;
  const silver = reconstructAppearance(await raster(silverSvg, 160, 160));
  assert.equal(silver.objects.filter((item) => item.role === 'object').length, 1, 'a prata foi fragmentada');
  assert.equal(silver.objects[0].kind, 'radial');
  assert.match(silver.svg, /<radialGradient\b/);
  assert.equal(silver.objects[0].geometry, silver.objects[0].painted);

  const colorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#fff"/><rect x="18" y="16" width="36" height="48" fill="#2563eb"/><rect x="66" y="16" width="36" height="48" fill="#dc2626"/></svg>`;
  const colored = reconstructAppearance(await raster(colorSvg, 120, 80));
  const coloredObjects = colored.objects.filter((item) => item.role === 'object');
  assert.equal(coloredObjects.length, 2);
  assert.ok(coloredObjects.every((item) => item.kind === 'solid'));
  assert.ok(coloredObjects.every((item) => item.geometry === item.painted));

  const shineSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140"><rect width="140" height="140" fill="#fff"/><circle cx="70" cy="70" r="48" fill="#1d4ed8"/><circle cx="52" cy="52" r="14" fill="#ffffff" opacity="0.85"/></svg>`;
  const shine = reconstructAppearance(await raster(shineSvg, 140, 140));
  assert.equal(shine.objects.filter((item) => item.role === 'object').length, 1, 'o brilho virou outra silhueta');
  assert.match(shine.svg, /clipPath/);
  assert.match(shine.svg, /-brilho/);
  assert.equal(shine.objects[0].geometry, shine.objects[0].painted);

  const shadowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="110"><rect width="160" height="110" fill="#fff"/><rect x="46" y="40" width="70" height="36" fill="#000" opacity="0.4"/><rect x="28" y="22" width="70" height="36" fill="#0f766e"/></svg>`;
  const shadow = reconstructAppearance(await raster(shadowSvg, 160, 110));
  assert.equal(shadow.objects.filter((item) => item.role === 'object').length, 1);
  assert.equal(shadow.objects.filter((item) => item.role === 'shadow').length, 1);
  assert.match(shadow.svg, /feGaussianBlur/);
  assert.ok(shadow.objects.every((item) => item.geometry === item.painted));

  const transparent = new Uint8Array(80 * 60 * 4);
  transparent.fill(255);
  for (let y = 16; y < 46; y++) {
    for (let x = 14; x < 64; x++) {
      const i = (y * 80 + x) * 4;
      transparent[i] = 37;
      transparent[i + 1] = 99;
      transparent[i + 2] = 235;
      transparent[i + 3] = 128;
    }
  }
  const alpha = reconstructAppearance({ width: 80, height: 60, data: transparent, sourceFormat: 'png' });
  assert.equal(alpha.objects.length, 1);
  assert.ok(Math.abs(alpha.objects[0].opacity - 0.5) < 0.08, `opacidade ${alpha.objects[0].opacity}`);
  assert.equal(alpha.objects[0].geometry, alpha.objects[0].painted);
  assert.equal(/<image\b|feImage|data:image/i.test(alpha.svg), false);

  lines.push(`- Preto sólido: ${black.objects[0].kind}, geometria idêntica após a pintura.`);
  lines.push(`- Ouro: ${gold.objects[0].kind}, ${gold.objects[0].stopCount} paradas, um só objeto.`);
  lines.push(`- Prata: ${silver.objects[0].kind}, geometria idêntica.`);
  lines.push(`- Duas cores sólidas: ${coloredObjects.length} objetos, sem ilhas.`);
  lines.push(`- Brilho: uma silhueta com máscara e camada radial.`);
  lines.push(`- Sombra: ${shadow.objects.filter((item) => item.role === 'shadow').length} camada suave, objeto intacto.`);
  lines.push(`- Transparência: opacidade ${alpha.objects[0].opacity}.`);
  lines.push('');
  lines.push('Nenhum SVG contém imagem raster. A pintura não altera o contorno.');
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  writeFileSync('/opt/cursor/artifacts/aparencia-etapa05.md', lines.join('\n'));
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
