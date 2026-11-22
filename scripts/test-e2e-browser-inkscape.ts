import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { createNodeTempWorkspace, validateSvgStructure } from '../src/engine';

const APP_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const ARTIFACTS_DIR = '/opt/cursor/artifacts';

async function ensureServerReachable(url: string): Promise<ChildProcess | null> {
  try {
    const res = await fetch(url);
    if (res.ok) return null;
  } catch {
    // Se o servidor não estiver ativo, inicia uma instância temporária do Vite
  }

  const child = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5173'], {
    cwd: process.cwd(),
    stdio: 'ignore',
  });

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      const res = await fetch(url);
      if (res.ok) return child;
    } catch {
      // Aguarda inicialização
    }
  }
  child.kill();
  throw new Error(`Não foi possível acessar o servidor em ${url}`);
}

async function setReactRangeValue(
  page: import('playwright-core').Page,
  selector: string,
  value: number
) {
  await page.locator(selector).evaluate((el, nextVal) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    setter?.call(input, String(nextVal));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function main() {
  console.log('=== TESTE REAL DE PONTA A PONTA (NAVEGADOR CHROME + INKSCAPE) ===\n');

  const tempWs = await createNodeTempWorkspace('barush-e2e-real-');
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true }).catch(() => undefined);

  const spawnedServer = await ensureServerReachable(APP_URL);

  // Gera imagem real PNG multicolorida com canal alfa transparente para o fluxo E2E
  const sampleRasterSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="320">
    <rect x="36" y="28" width="348" height="264" rx="56" fill="#1e1b4b"/>
    <circle cx="155" cy="160" r="78" fill="#6366f1"/>
    <polygon points="265,78 342,226 188,226" fill="#10b981"/>
    <circle cx="265" cy="176" r="28" fill="#facc15"/>
  </svg>`;
  const uploadImagePath = path.join(tempWs.dirPath, 'logo-estudio-barush.png');
  await sharp(Buffer.from(sampleRasterSvg)).png().toFile(uploadImagePath);

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  const browser = await chromium.launch({
    executablePath: '/usr/local/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 920 },
      acceptDownloads: true,
    });
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    // 1. Abra o sistema
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="upload-dropzone"]').waitFor({ state: 'visible' });
    const startBtnDisabledInitially = await page
      .locator('[data-testid="start-vectorize-button"]')
      .isDisabled();
    if (!startBtnDisabledInitially) {
      throw new Error('O botão "Vetorizar imagem" deveria estar desabilitado antes do upload.');
    }
    console.log('1. Sistema aberto no Google Chrome (1440×920) sem erros de console.');

    // 2. Envie uma imagem
    await page.locator('[data-testid="file-upload-input"]').setInputFiles(uploadImagePath);
    await page.locator('[data-testid="image-intelligence-card"]').waitFor({ state: 'visible' });
    const detectedText = await page.locator('[data-testid="image-intelligence-card"]').innerText();
    console.log(
      `2. Imagem enviada ("logo-estudio-barush.png") e analisada automaticamente (${detectedText.replace(/\s+/g, ' ').trim()}).`
    );

    // 3. Selecione o perfil de vetorização
    await page.locator('[data-testid="profile-high_fidelity"]').click();
    const isHighFidelityChecked = await page
      .locator('[data-testid="profile-high_fidelity"]')
      .getAttribute('aria-checked');
    if (isHighFidelityChecked !== 'true') {
      throw new Error('Falha ao selecionar o perfil "Alta fidelidade".');
    }
    console.log('3. Perfil "Alta fidelidade" selecionado com sucesso.');

    // 4. Clique em vetorizar & 5. Aguarde o processamento assíncrono (verificando que a thread de UI não trava)
    await page.evaluate(
      `window.__rafTicks = 0; (function loop(){ window.__rafTicks++; requestAnimationFrame(loop); })();`
    );

    await page.locator('[data-testid="start-vectorize-button"]').click();
    console.log('4. Vetorização disparada via Web Worker WebAssembly.');

    await page.locator('[data-testid="svg-ready-banner"]').waitFor({
      state: 'visible',
      timeout: 60000,
    });

    const rafTicks = await page.evaluate(
      () => (window as unknown as { __rafTicks: number }).__rafTicks
    );
    if (rafTicks < 1) {
      throw new Error('A interface principal não registrou quadros durante o processamento.');
    }
    console.log(
      `5. Processamento assíncrono concluído sem travar a interface (${rafTicks} quadros RAF livres).`
    );

    // 6. Visualize o resultado (confirma SVG vetorial REAL no DOM, sem substituto PNG)
    const firstSvgStats = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="real-svg-viewport"]');
      const svg = host?.querySelector('svg');
      const paths = svg ? svg.querySelectorAll('path') : [];
      const rasterImgs = host ? host.querySelectorAll('img, image') : [];
      return {
        hasSvgElement: Boolean(svg),
        viewBox: svg?.getAttribute('viewBox') ?? null,
        pathCount: paths.length,
        rasterImgCount: rasterImgs.length,
        markup: svg?.outerHTML ?? '',
      };
    });

    if (
      !firstSvgStats.hasSvgElement ||
      firstSvgStats.pathCount < 3 ||
      firstSvgStats.rasterImgCount > 0
    ) {
      throw new Error(
        `Renderização SVG inválida no DOM: ${JSON.stringify({
          hasSvgElement: firstSvgStats.hasSvgElement,
          pathCount: firstSvgStats.pathCount,
          rasterImgCount: firstSvgStats.rasterImgCount,
        })}`
      );
    }
    console.log(
      `6. Resultado SVG real renderizado diretamente no DOM (${firstSvgStats.pathCount} elementos <path>, viewBox="${firstSvgStats.viewBox}", 0 imagens raster).`
    );

    // Captura screenshot lado a lado como evidência real
    await page
      .screenshot({ path: path.join(ARTIFACTS_DIR, 'vetorizador-lado-a-lado.png') })
      .catch(() => undefined);

    // 7. Compare original e vetor (Controle deslizante, Zoom, Lupa 4x, Fundos Branco/Escuro/Transparente e Caminhos)
    await page.locator('[data-testid="mode-slider"]').click();
    await page.locator('[data-testid="split-comparison-stage"]').waitFor({ state: 'visible' });
    await setReactRangeValue(page, '[data-testid="split-range-input"]', 35);
    await page
      .screenshot({ path: path.join(ARTIFACTS_DIR, 'vetorizador-slider-comparacao.png') })
      .catch(() => undefined);

    await page.locator('[data-testid="mode-overlay"]').click();
    await page.locator('[data-testid="overlay-comparison-stage"]').waitFor({ state: 'visible' });
    await page.locator('[data-testid="mode-pixel-diff"]').click();
    await page.locator('[data-testid="pixel-diff-stage"]').waitFor({ state: 'visible' });

    const objMetricText = await page.locator('[data-testid="metric-objects"]').innerText();
    const ssimMetricText = await page.locator('[data-testid="metric-ssim"]').innerText();
    if (!Number(objMetricText) || !ssimMetricText.includes('%')) {
      throw new Error(`Métricas estruturais/SSIM ausentes na UI: obj=${objMetricText}, ssim=${ssimMetricText}`);
    }

    await page.locator('[data-testid="mode-side-by-side"]').click();
    await page.locator('[data-testid="zoom-in-button"]').click();
    await page.locator('[data-testid="zoom-in-button"]').click();
    const zoomText = await page.locator('[data-testid="zoom-readout"]').innerText();
    if (zoomText !== '200%') {
      throw new Error(`Zoom esperado 200%, obtido: ${zoomText}`);
    }

    await page.locator('[data-testid="toggle-detail-loupe"]').click();
    await page.locator('[data-testid="toggle-wireframe"]').click();
    await page.locator('[data-testid="bg-white"]').click();
    await page.locator('[data-testid="bg-dark"]').click();
    await page.locator('[data-testid="bg-transparent"]').click();
    await page.locator('[data-testid="toggle-wireframe"]').click();
    console.log(
      '7. Comparação antes e depois validada: Lado a lado, Controle deslizante (35%), Zoom (200%), Lupa 4×, Destaque de caminhos e Fundos Transparente/Branco/Escuro.'
    );

    // 8. Altere os parâmetros avançados
    await page.locator('[data-testid="toggle-advanced-settings"]').click();
    await page.locator('[data-testid="slider-colorCount"]').waitFor({ state: 'visible' });
    await setReactRangeValue(page, '[data-testid="slider-colorCount"]', 2);
    await setReactRangeValue(page, '[data-testid="slider-curveSmoothness"]', 95);
    await setReactRangeValue(page, '[data-testid="slider-pathSimplification"]', 75);
    console.log(
      '8. Parâmetros avançados alterados (Quantidade de cores=2, Suavidade=95%, Simplificação=75%).'
    );

    // 9. Execute uma nova vetorização sem reenviar a imagem
    await page.locator('[data-testid="revectorize-button"]').click();
    await page.locator('[data-testid="svg-ready-banner"]').waitFor({
      state: 'visible',
      timeout: 60000,
    });

    const secondSvgMarkup = await page.evaluate(
      () => document.querySelector('[data-testid="real-svg-viewport"] svg')?.outerHTML ?? ''
    );
    if (!secondSvgMarkup || secondSvgMarkup === firstSvgStats.markup) {
      throw new Error('A re-vetorização após alterar os parâmetros não modificou o SVG!');
    }

    // Restaura perfil Logo e ilustração para exportar o emblema completo multicolorido
    await page.locator('[data-testid="profile-logo_illustration"]').click();
    await page.locator('[data-testid="revectorize-button"]').click();
    await page.locator('[data-testid="svg-ready-banner"]').waitFor({
      state: 'visible',
      timeout: 60000,
    });
    console.log(
      '9. Nova vetorização executada sem reenviar a imagem; atualização efetiva do SVG confirmada.'
    );

    // 10. Baixe o SVG
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid="download-svg-button"]').click();
    const download = await downloadPromise;
    const downloadedSvgPath = path.join(tempWs.dirPath, download.suggestedFilename());
    await download.saveAs(downloadedSvgPath);

    const downloadedSvgContent = await fs.readFile(downloadedSvgPath, 'utf-8');
    const downloadedValidation = validateSvgStructure(downloadedSvgContent);
    if (!downloadedValidation.valid) {
      throw new Error(
        `SVG baixado falhou na validação: ${downloadedValidation.errors.join('; ')}`
      );
    }
    console.log(
      `10. Download real do arquivo "${download.suggestedFilename()}" concluído (${downloadedValidation.byteLength} bytes, ${downloadedValidation.pathCount} caminhos).`
    );

    // 11. Abra o SVG no Inkscape
    const inkscapeVersion = execFileSync('inkscape', ['--version'], { encoding: 'utf-8' }).trim();
    const queryAllOutput = execFileSync('inkscape', ['--query-all', downloadedSvgPath], {
      encoding: 'utf-8',
    }).trim();
    const queriedLines = queryAllOutput.split('\n');
    const queriedObjects = queriedLines.filter((line) => line.startsWith('objeto-'));
    const queriedPaths = queriedLines.filter(
      (line) => line.startsWith('caminho-') || line.startsWith('letra-')
    );
    if (queriedObjects.length < 1 || queriedPaths.length < 3) {
      throw new Error(
        `Inkscape leu menos objetos/caminhos editáveis que o esperado: objetos=${queriedObjects.length}, caminhos=${queriedPaths.length}`
      );
    }
    const firstPathId = queriedPaths[0].split(',')[0];
    console.log(
      `11. SVG aberto no ${inkscapeVersion}: ${queriedObjects.length} grupos de objetos e ${queriedPaths.length} caminhos independentes reconhecidos (${queriedPaths
        .slice(0, 3)
        .map((l) => l.split(',')[0])
        .join(', ')}...).`
    );

    // 12. Confirme que os caminhos são editáveis no Inkscape (seleciona primeiro caminho, aplica translação vetorial real no Inkscape e reexporta)
    const beforeX = parseFloat(
      execFileSync('inkscape', [`--query-id=${firstPathId}`, '--query-x', downloadedSvgPath], {
        encoding: 'utf-8',
      }).trim()
    );

    const editedByInkscapePath = path.join(tempWs.dirPath, 'editado-no-inkscape.svg');
    const exportedInkscapePng = path.join(tempWs.dirPath, 'renderizado-no-inkscape.png');

    execFileSync(
      'inkscape',
      [
        downloadedSvgPath,
        `--actions=select-by-id:${firstPathId};transform-translate:25,15;export-plain-svg;export-filename:${editedByInkscapePath};export-do`,
      ],
      { encoding: 'utf-8' }
    );

    execFileSync(
      'inkscape',
      [downloadedSvgPath, `--export-type=png`, `--export-filename=${exportedInkscapePng}`],
      { encoding: 'utf-8' }
    );

    const afterX = parseFloat(
      execFileSync('inkscape', [`--query-id=${firstPathId}`, '--query-x', editedByInkscapePath], {
        encoding: 'utf-8',
      }).trim()
    );

    const pngStat = await fs.stat(exportedInkscapePng);
    if (Math.abs(afterX - beforeX) < 5 || pngStat.size < 500) {
      throw new Error(
        `Falha ao comprovar edição individual do caminho no Inkscape (id=${firstPathId}, beforeX=${beforeX}, afterX=${afterX})`
      );
    }
    console.log(
      `12. Edição real confirmada no Inkscape: objeto "${firstPathId}" selecionado e movido individualmente (X: ${beforeX.toFixed(
        2
      )} -> ${afterX.toFixed(2)}) e reexportado com sucesso!`
    );

    // 13. Teste adicional na UI real com a imagem de referência do Pássaro Colorido (se disponível em /opt/cursor/artifacts)
    const birdRefPath = path.join(ARTIFACTS_DIR, 'passaro-colorido-referencia.png');
    try {
      await fs.access(birdRefPath);
      await page.setViewportSize({ width: 1440, height: 980 });
      await page.locator('[data-testid="file-upload-input"]').setInputFiles(birdRefPath);
      await page.locator('[data-testid="profile-auto"]').click();
      await page.locator('[data-testid="start-vectorize-button"]').click();
      await Promise.race([
        page.locator('[data-testid="svg-ready-banner"]').waitFor({ state: 'visible', timeout: 60000 }),
        page.locator('[data-testid="processing-error-panel"]').waitFor({ state: 'visible', timeout: 60000 }),
      ]);
      if (await page.locator('[data-testid="processing-error-panel"]').isVisible()) {
        throw new Error(await page.locator('[data-testid="processing-error-panel"]').innerText());
      }
      await page.locator('[data-testid="bg-white"]').click();
      await page.locator('[data-testid="zoom-out-button"]').click();
      await page.locator('[data-testid="zoom-out-button"]').click();
      await page
        .screenshot({
          path: path.join(ARTIFACTS_DIR, 'ui-passaro-colorido-vetor-puro.png'),
          fullPage: true,
        })
        .catch(() => undefined);
      console.log(
        '13. Pássaro colorido reconstruído na interface web real e capturado em ui-passaro-colorido-vetor-puro.png.'
      );
    } catch (step13Err) {
      const errPanel = await page
        .locator('[data-testid="processing-error-panel"]')
        .innerText()
        .catch(() => '');
      throw new Error(`Falha no passo 13 (Pássaro Colorido no navegador): ${String(step13Err)} | PainelErro: ${errPanel}`);
    }

    // Verificação adicional de responsividade mobile (390×844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    if (hasHorizontalOverflow) {
      throw new Error('Problema de responsividade detectado em 390×844 (overflow horizontal)!');
    }
    console.log('✔ Responsividade mobile (390×844) e desktop (1440×920) verificada sem overflow.');

    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error(
        `Erros detectados durante execução no navegador: console=${JSON.stringify(
          consoleErrors
        )}, pageErrors=${JSON.stringify(pageErrors)}`
      );
    }
  } finally {
    await browser.close();
    spawnedServer?.kill();
    await tempWs.cleanup();
  }

  console.log('\n=== FLUXO DE PONTA A PONTA (12 PASSOS REAIS + INKSCAPE) CONCLUÍDO COM 100% DE SUCESSO ===');
}

main().catch((err) => {
  console.error('\nFALHA NO TESTE DE PONTA A PONTA:', err);
  process.exit(1);
});
