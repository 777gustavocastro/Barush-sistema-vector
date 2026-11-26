/** Filtro de produção aberto a partir dos indicadores do Dashboard. */
export type ProductionFocus = 'aprovacao' | 'em_producao' | 'pronto' | 'atrasados';

export type NavPageId =
  | 'dashboard'
  | 'chat_projects'
  | 'products'
  | 'clients'
  | 'sales'
  | 'reports'
  | 'production'
  | 'expenses'
  | 'files'
  | 'settings';

export interface ClientRecord {
  id: string;
  name: string;
  company: string;
  initials: string;
  accentColor: string;
  email: string;
  phone: string;
  document: string;
  city: string;
  totalSpent: number;
  ordersCount: number;
  activeProjects: number;
  lastActivity: string;
}

export type ProductCategory =
  | 'Impressão gráfica'
  | 'Personalização'
  | 'Comunicação visual'
  | 'Personalização a laser'
  | 'Uniformes'
  | 'Outros';

export type ProductStatus = 'ativo' | 'rascunho' | 'arquivado';

export type ProductConfig = 'Template' | 'Formato fixo' | 'Sob medida';

export interface ProductRecord {
  id: string;
  sku: string;
  name: string;
  category: ProductCategory;
  templateName: string;
  templateCount: number;
  dimensions: string;
  proportion?: string;
  printArea: string;
  cost: number;
  price: number;
  productionHours: number;
  active: boolean;
  status: ProductStatus;
  config: ProductConfig;
  summary: string;
  hasImage: boolean;
  tone: string;
}

export type ProductionStatus =
  | 'arte_aprovacao'
  | 'pre_impressao'
  | 'producao'
  | 'acabamento'
  | 'pronto';

export interface ProductionOrder {
  id: string;
  code: string;
  clientId: string;
  clientName: string;
  productName: string;
  quantity: number;
  dueDate: string;
  dueLabel: string;
  status: ProductionStatus;
  priority: 'normal' | 'alta';
  value: number;
}

export interface ProjectThread {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  productRef: string;
  status: 'em_criacao' | 'aguardando_cliente' | 'aprovado';
  updatedAt: string;
  messages: Array<{
    id: string;
    sender: 'user' | 'ai';
    text: string;
    time: string;
    attachment?: string;
  }>;
}

export interface ExpenseRecord {
  id: string;
  date: string;
  description: string;
  category: 'Insumos' | 'Equipamentos' | 'Terceirização' | 'Operacional' | 'Logística';
  supplier: string;
  amount: number;
  status: 'pago' | 'pendente';
}

export interface FileAsset {
  id: string;
  name: string;
  format: 'SVG' | 'PDF' | 'PNG' | 'AI';
  clientId: string;
  clientName: string;
  project: string;
  size: string;
  updatedAt: string;
}

export interface SaleRecord {
  id: string;
  code: string;
  date: string;
  clientId: string;
  clientName: string;
  itemsSummary: string;
  total: number;
  paymentMethod:
    | 'Dinheiro'
    | 'PIX'
    | 'Cartão'
    | 'Cartão de débito'
    | 'Cartão de crédito'
    | 'Boleto'
    | 'Transferência';
  status: 'confirmada' | 'pendente';
}

export interface NotificationItem {
  id: string;
  title: string;
  detail: string;
  time: string;
  unread: boolean;
  targetPage: NavPageId;
}
