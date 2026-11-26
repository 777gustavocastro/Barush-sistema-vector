import { loadActivities } from '../clients/clientStore';
import type { ClientActivity } from '../clients/clientTypes';
import { FILE_ASSETS, PROJECT_THREADS } from '../data/mockData';
import type { CatalogProduct } from '../products/catalogTypes';
import { HISTORY_ACTOR } from './productionRules';
import type { ProductionFileRef, ProductionOrder, ProductionPriority, ProductionStatus } from '../types';

export function productNeedsProduction(product: CatalogProduct | undefined): boolean {
  if (!product) return false;
  return product.templates.some((template) =>
    Boolean(
      template.physicalSize.trim() ||
        template.printArea.trim() ||
        template.safeArea.trim() ||
        template.bleed.trim() ||
        template.formatNotes.trim() ||
        template.technicalNotes.trim() ||
        template.contourNote.trim() ||
        (template.width && template.height)
    )
  );
}

export function technicalSnapshot(product: CatalogProduct): Array<{ label: string; value: string }> {
  const template = product.templates.find((item) =>
    Boolean(item.physicalSize || item.printArea || item.width || item.formatNotes || item.technicalNotes)
  ) ?? product.templates[0];
  const rows: Array<{ label: string; value: string } | null> = [
    { label: 'Categoria', value: product.category },
    template?.name ? { label: 'Template', value: template.name } : null,
    template?.physicalSize.trim() ? { label: 'Dimensão', value: template.physicalSize.trim() } : null,
    template?.width && template?.height ? { label: 'Medida', value: `${template.width} × ${template.height} ${template.unit}`.trim() } : null,
    template?.printArea.trim() ? { label: 'Área de impressão', value: template.printArea.trim() } : null,
    template?.safeArea.trim() ? { label: 'Área segura', value: template.safeArea.trim() } : null,
    template?.bleed.trim() ? { label: 'Sangria', value: template.bleed.trim() } : null,
    template?.formatNotes.trim() ? { label: 'Acabamento', value: template.formatNotes.trim() } : null,
    template?.contourNote.trim() ? { label: 'Contorno', value: template.contourNote.trim() } : null,
    template?.technicalNotes.trim() ? { label: 'Especificação', value: template.technicalNotes.trim() } : null,
  ];
  const seen = new Set<string>();
  return rows.filter((item): item is { label: string; value: string } => {
    if (!item || !item.value || seen.has(item.label)) return false;
    seen.add(item.label);
    return true;
  });
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3);
}

function sharesToken(left: string, right: string): boolean {
  const rightTokens = new Set(tokens(right));
  return tokens(left).some((word) => rightTokens.has(word));
}

function linkedFiles(clientId: string, productName: string, activities: ClientActivity[]): ProductionFileRef[] {
  const refs: ProductionFileRef[] = [];
  const arts = activities.find((item) => item.clientId === clientId)?.arts ?? [];
  arts
    .filter((art) => sharesToken(art.name, productName))
    .forEach((art) => {
      refs.push({ id: art.id, name: art.name, format: art.format, kind: 'arte', url: art.previewUrl });
    });
  FILE_ASSETS.filter(
    (file) => file.clientId === clientId && (sharesToken(file.name, productName) || sharesToken(file.project, productName))
  ).forEach((file) => {
    if (refs.some((item) => item.name === file.name)) return;
    refs.push({ id: file.id, name: file.name, format: file.format, kind: 'arquivo' });
  });
  return refs;
}

function approvalFor(clientId: string, productName: string, files: ProductionFileRef[]): {
  approval: NonNullable<ProductionOrder['approval']>;
  status: ProductionStatus;
} {
  const thread = PROJECT_THREADS.find(
    (item) => item.clientId === clientId && (sharesToken(item.productRef, productName) || sharesToken(item.title, productName))
  );
  if (thread?.status === 'aprovado') return { approval: 'aprovada', status: 'pre_impressao' };
  if (thread || files.some((file) => file.kind === 'arte')) return { approval: 'pendente', status: 'arte_aprovacao' };
  return { approval: 'nao_exige', status: 'pre_impressao' };
}

interface SaleLineInput {
  productId: string;
  name: string;
  category: string;
  quantity: number;
  value: number;
}

export function buildProductionOrders(input: {
  saleId: string;
  saleCode: string;
  clientId: string;
  clientName: string;
  lines: SaleLineInput[];
  catalog: CatalogProduct[];
  notes: string;
  activities: ClientActivity[];
  now?: Date;
}): ProductionOrder[] {
  const now = input.now ?? new Date();
  const due = new Date(now);
  due.setDate(due.getDate() + 2);
  const saleNumber = input.saleCode.replace(/\D/g, '') || now.getTime().toString().slice(-4);
  const orders: ProductionOrder[] = [];
  input.lines.forEach((line, index) => {
    const product = input.catalog.find((item) => item.id === line.productId);
    if (!productNeedsProduction(product)) return;
    const files = linkedFiles(input.clientId, line.name, input.activities);
    const art = files.find((file) => file.kind === 'arte');
    const gate = approvalFor(input.clientId, line.name, files);
    const sequence = orders.length + 1;
    orders.push({
      id: `ord-${input.saleId}-${index}`,
      code: `PRD-${saleNumber}-${sequence}`,
      saleId: input.saleId,
      saleCode: input.saleCode,
      productId: line.productId,
      category: product?.category ?? line.category,
      clientId: input.clientId,
      clientName: input.clientName,
      productName: line.name,
      quantity: line.quantity,
      enteredAt: now.toISOString(),
      dueDate: due.toISOString().slice(0, 10),
      dueLabel: due.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
      status: gate.status,
      priority: 'normal',
      value: line.value,
      approval: gate.approval,
      clientNote: input.notes,
      technical: product ? technicalSnapshot(product) : [],
      artId: art?.id,
      artName: art?.name,
      artUrl: art?.url,
      files,
      history: [
        {
          id: `hist-${input.saleId}-${index}`,
          at: now.toISOString(),
          label: 'Pedido encaminhado para produção.',
          by: HISTORY_ACTOR,
        },
      ],
    });
  });
  return orders;
}

export function buildManualOrder(input: {
  clientId: string;
  clientName: string;
  product: CatalogProduct;
  quantity: number;
  dueDate: string;
  priority: ProductionPriority;
  clientNote: string;
  internalNote: string;
  activities: ClientActivity[];
}): ProductionOrder {
  const now = new Date();
  const files = linkedFiles(input.clientId, input.product.name, input.activities);
  const art = files.find((file) => file.kind === 'arte');
  const gate = approvalFor(input.clientId, input.product.name, files);
  const stamp = now.getTime().toString().slice(-6);
  return {
    id: `ord-manual-${stamp}`,
    code: `PRD-M-${stamp}`,
    productId: input.product.id,
    category: input.product.category,
    clientId: input.clientId,
    clientName: input.clientName,
    productName: input.product.name,
    quantity: input.quantity,
    enteredAt: now.toISOString(),
    dueDate: input.dueDate,
    dueLabel: new Date(`${input.dueDate}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
    status: gate.status,
    priority: input.priority,
    value: (input.product.price ?? 0) * input.quantity,
    approval: gate.approval,
    clientNote: input.clientNote,
    internalNote: input.internalNote,
    technical: technicalSnapshot(input.product),
    artId: art?.id,
    artName: art?.name,
    artUrl: art?.url,
    files,
    history: [{ id: `hist-manual-${stamp}`, at: now.toISOString(), label: 'Pedido manual registrado na produção.', by: HISTORY_ACTOR }],
  };
}

export async function activitiesForProduction(): Promise<ClientActivity[]> {
  return loadActivities().catch(() => []);
}
