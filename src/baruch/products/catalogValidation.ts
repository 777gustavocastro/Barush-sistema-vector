import type { CatalogProduct, ProductTemplate } from './catalogTypes';

export function blankCatalogProduct(): CatalogProduct {
  const now = new Date().toISOString();
  return {
    id: `prd-${Date.now().toString(36)}`,
    name: '',
    category: 'Impressão gráfica',
    description: '',
    status: 'ativo',
    image: null,
    gallery: [],
    cost: null,
    costUnit: 'unidade',
    costNote: '',
    price: null,
    saleUnit: 'unidade',
    commercialNotes: '',
    templates: [],
    createdAt: now,
    updatedAt: now,
  };
}

export interface CatalogFieldErrors {
  name?: string;
  cost?: string;
  price?: string;
  templates?: Record<string, { name?: string; width?: string; height?: string }>;
}

export function validateCatalogProduct(product: CatalogProduct): CatalogFieldErrors {
  const errors: CatalogFieldErrors = {};
  if (!product.name.trim()) errors.name = 'Informe o nome do produto.';
  if (product.cost !== null && (!Number.isFinite(product.cost) || product.cost < 0)) {
    errors.cost = 'O custo precisa ser um valor positivo ou ficar em branco.';
  }
  if (product.price !== null && (!Number.isFinite(product.price) || product.price < 0)) {
    errors.price = 'O preço precisa ser um valor positivo ou ficar em branco.';
  }

  const templateErrors: NonNullable<CatalogFieldErrors['templates']> = {};
  product.templates.forEach((template) => {
    const item: { name?: string; width?: string; height?: string } = {};
    if (!template.name.trim()) item.name = 'Dê um nome ao template.';
    if (template.width !== null && (!Number.isFinite(template.width) || template.width <= 0)) {
      item.width = 'A largura precisa ser maior que zero.';
    }
    if (template.height !== null && (!Number.isFinite(template.height) || template.height <= 0)) {
      item.height = 'A altura precisa ser maior que zero.';
    }
    if (item.name || item.width || item.height) templateErrors[template.id] = item;
  });
  if (Object.keys(templateErrors).length > 0) errors.templates = templateErrors;
  return errors;
}

export function hasCatalogErrors(errors: CatalogFieldErrors): boolean {
  return Boolean(errors.name || errors.cost || errors.price || errors.templates);
}

export function firstCatalogError(errors: CatalogFieldErrors): string | null {
  if (errors.name) return errors.name;
  if (errors.cost) return errors.cost;
  if (errors.price) return errors.price;
  const template = Object.values(errors.templates ?? {})[0];
  return template?.name || template?.width || template?.height || null;
}

export function emptyTemplate(name = 'Novo template'): ProductTemplate {
  return {
    id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    referenceImage: null,
    physicalSize: '',
    width: null,
    height: null,
    unit: 'mm',
    proportion: '',
    printArea: '',
    safeArea: '',
    bleed: '',
    orientation: '',
    formatNotes: '',
    contourNote: '',
    technicalNotes: '',
  };
}
