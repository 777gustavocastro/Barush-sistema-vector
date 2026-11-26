export interface RenderedSvgVerification {
  width: number;
  height: number;
  nonEmptyPixelCount: number;
  pngBytes: Uint8Array;
}

function isNodeRuntime(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    Boolean((globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node) &&
    typeof window === 'undefined'
  );
}

/**
 * Renderiza um documento SVG através de um motor vetorial real:
 * - Em Node.js: utiliza @resvg/resvg-js (renderizador vetorial nativo em Rust)
 * - No Navegador: utiliza HTMLImageElement + Canvas 2D
 * Usado para confirmar visualmente que o SVG abre sem erros e produz geometria visível.
 */
export async function renderSvgForVerification(
  svgContent: string
): Promise<RenderedSvgVerification> {
  if (isNodeRuntime()) {
    const resvgPkg = '@resvg/resvg-js';
    const { Resvg } = await import(/* @vite-ignore */ resvgPkg);
    const resvg = new Resvg(svgContent, {
      fitTo: { mode: 'original' },
    });
    const rendered = resvg.render();
    const pixels: Uint8Array = rendered.pixels;
    const pngBuffer: Buffer = rendered.asPng();

    let nonEmptyPixelCount = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] > 0) {
        nonEmptyPixelCount++;
      }
    }

    return {
      width: rendered.width,
      height: rendered.height,
      nonEmptyPixelCount,
      pngBytes: new Uint8Array(pngBuffer.buffer, pngBuffer.byteOffset, pngBuffer.byteLength),
    };
  }

  const svgBlob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    return await new Promise<RenderedSvgVerification>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const width = Math.max(1, img.naturalWidth || 256);
        const height = Math.max(1, img.naturalHeight || 256);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Contexto 2D indisponível para renderizar SVG.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const { data } = ctx.getImageData(0, 0, width, height);
        let nonEmptyPixelCount = 0;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] > 0) nonEmptyPixelCount++;
        }

        canvas.toBlob((pngBlob) => {
          if (!pngBlob) {
            reject(new Error('Falha ao exportar PNG da renderização SVG.'));
            return;
          }
          pngBlob.arrayBuffer().then((ab) => {
            resolve({
              width,
              height,
              nonEmptyPixelCount,
              pngBytes: new Uint8Array(ab),
            });
          }, reject);
        }, 'image/png');
      };
      img.onerror = () => reject(new Error('O navegador não conseguiu abrir/renderizar o SVG.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
