import type { ProductCategory } from '../types';

export type CatalogStatus = 'ativo' | 'arquivado';

export type SaleUnit = 'unidade' | 'metro' | 'm²' | 'kit' | 'peça' | 'folha';

export type MeasureUnit = 'mm' | 'cm' | 'm';

export type TemplateOrientation = 'retrato' | 'paisagem' | 'quadrada';

export interface CatalogImage {
  id: string;
  name: string;
  dataUrl: string;
}

export interface ProductTemplate {
  id: string;
  name: string;
  referenceImage: CatalogImage | null;
  physicalSize: string;
  width: number | null;
  height: number | null;
  unit: MeasureUnit | '';
  proportion: string;
  printArea: string;
  safeArea: string;
  bleed: string;
  orientation: TemplateOrientation | '';
  formatNotes: string;
  contourNote: string;
  technicalNotes: string;
}

/** Cadastro técnico e comercial. Fonte para chat, artes, vendas e relatórios. */
export interface CatalogProduct {
  id: string;
  name: string;
  category: ProductCategory;
  description: string;
  status: CatalogStatus;
  image: CatalogImage | null;
  gallery: CatalogImage[];
  cost: number | null;
  costUnit: SaleUnit;
  costNote: string;
  price: number | null;
  saleUnit: SaleUnit;
  commercialNotes: string;
  templates: ProductTemplate[];
  createdAt: string;
  updatedAt: string;
}

/** Contexto de arte consumido pelo chat, sem alterar o cadastro. */
export interface ProductArtContext {
  productId: string;
  name: string;
  category: ProductCategory;
  status: CatalogStatus;
  templates: Array<{
    id: string;
    name: string;
    proportion: string;
    width: number | null;
    height: number | null;
    unit: string;
    physicalSize: string;
    printArea: string;
    safeArea: string;
    bleed: string;
    orientation: string;
    formatNotes: string;
    contourNote: string;
    referenceImage: string | null;
  }>;
}

/** Valores iniciais de uma venda. A venda deve copiar estes números, não a referência viva. */
export interface ProductSaleSeed {
  productId: string;
  name: string;
  category: ProductCategory;
  unitPrice: number | null;
  unitCost: number | null;
  saleUnit: SaleUnit;
  costUnit: SaleUnit;
}

export const SALE_UNITS: SaleUnit[] = ['unidade', 'metro', 'm²', 'kit', 'peça', 'folha'];
export const MEASURE_UNITS: MeasureUnit[] = ['mm', 'cm', 'm'];
export const ORIENTATIONS: TemplateOrientation[] = ['retrato', 'paisagem', 'quadrada'];

export const PRODUCT_CATEGORIES: ProductCategory[] = [
  'Impressão gráfica',
  'Personalização',
  'Comunicação visual',
  'Personalização a laser',
  'Uniformes',
  'Outros',
];
