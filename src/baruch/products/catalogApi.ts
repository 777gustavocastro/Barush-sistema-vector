import type { CatalogProduct, ProductArtContext, ProductSaleSeed } from './catalogTypes';

export function toArtContext(product: CatalogProduct): ProductArtContext {
  return {
    productId: product.id,
    name: product.name,
    category: product.category,
    status: product.status,
    templates: product.templates.map((template) => ({
      id: template.id,
      name: template.name,
      proportion: template.proportion,
      width: template.width,
      height: template.height,
      unit: template.unit,
      physicalSize: template.physicalSize,
      printArea: template.printArea,
      safeArea: template.safeArea,
      bleed: template.bleed,
      orientation: template.orientation,
      formatNotes: template.formatNotes,
      contourNote: template.contourNote,
      referenceImage: template.referenceImage?.dataUrl ?? null,
    })),
  };
}

/** Copia comercial no momento da venda. Alterar o produto depois não muda este objeto. */
export function toSaleSeed(product: CatalogProduct): ProductSaleSeed {
  return {
    productId: product.id,
    name: product.name,
    category: product.category,
    unitPrice: product.price,
    unitCost: product.cost,
    saleUnit: product.saleUnit,
    costUnit: product.costUnit,
  };
}

export function listSellableProducts(products: CatalogProduct[]): CatalogProduct[] {
  return products.filter((product) => product.status === 'ativo');
}

export function duplicateCatalogProduct(product: CatalogProduct): CatalogProduct {
  const now = new Date().toISOString();
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  return {
    ...structuredClone(product),
    id: `prd-${stamp}`,
    name: `${product.name} (cópia)`,
    status: 'ativo',
    createdAt: now,
    updatedAt: now,
    image: product.image ? { ...product.image, id: `img-${stamp}` } : null,
    gallery: product.gallery.map((image, index) => ({ ...image, id: `gal-${stamp}-${index}` })),
    templates: product.templates.map((template, index) => ({
      ...structuredClone(template),
      id: `tpl-${stamp}-${index}`,
      referenceImage: template.referenceImage
        ? { ...template.referenceImage, id: `ref-${stamp}-${index}` }
        : null,
    })),
  };
}

export function formatTemplateSize(template: {
  width: number | null;
  height: number | null;
  unit: string;
  physicalSize: string;
}): string {
  if (template.width && template.height) {
    const unit = template.unit ? ` ${template.unit}` : '';
    return `${trimNumber(template.width)} × ${trimNumber(template.height)}${unit}`;
  }
  return template.physicalSize.trim();
}

export function formatMoney(value: number | null): string {
  if (value === null) return '';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, '');
}
