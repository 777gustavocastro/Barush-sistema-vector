import type { CatalogImage } from './catalogTypes';

export async function readCatalogImage(file: File): Promise<CatalogImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selecione um arquivo de imagem.');
  }
  const dataUrl = await compressImage(file);
  return {
    id: `img-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name: file.name,
    dataUrl,
  };
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const max = 1280;
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error('Não foi possível ler a imagem.'));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Arquivo de imagem inválido.'));
    };
    image.src = url;
  });
}
