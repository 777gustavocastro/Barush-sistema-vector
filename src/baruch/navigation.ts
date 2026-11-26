import {
  BarChart3,
  CalendarClock,
  FolderOpen,
  LayoutDashboard,
  MessageSquareText,
  Package,
  Receipt,
  Settings,
  ShoppingBag,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { NavPageId } from './types';

export interface NavItemConfig {
  id: NavPageId;
  label: string;
  shortDescription: string;
  icon: LucideIcon;
}

/**
 * Ordem exata de navegação definida para o sistema BARUCH.
 */
export const MAIN_NAV_ITEMS: NavItemConfig[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    shortDescription: 'Resumo geral da gráfica',
    icon: LayoutDashboard,
  },
  {
    id: 'chat_projects',
    label: 'Chat',
    shortDescription: 'IA, criação e processamento de imagens',
    icon: MessageSquareText,
  },
  {
    id: 'products',
    label: 'Produtos',
    shortDescription: 'Catálogo, templates, dimensões e preços',
    icon: Package,
  },
  {
    id: 'clients',
    label: 'Clientes',
    shortDescription: 'Cadastro, histórico de artes e compras',
    icon: Users,
  },
  {
    id: 'sales',
    label: 'Vendas',
    shortDescription: 'PDV, pedidos, pagamentos e comprovantes',
    icon: ShoppingBag,
  },
  {
    id: 'reports',
    label: 'Relatórios',
    shortDescription: 'Gestão financeira, lucro, custos e vendas',
    icon: BarChart3,
  },
  {
    id: 'production',
    label: 'Produção / Agenda',
    shortDescription: 'Pedidos em andamento, prazos e entregas',
    icon: CalendarClock,
  },
  {
    id: 'expenses',
    label: 'Despesas',
    shortDescription: 'Compras, categorias e custos operacionais',
    icon: Receipt,
  },
  {
    id: 'files',
    label: 'Arquivos',
    shortDescription: 'Biblioteca de PDFs, imagens e SVGs',
    icon: FolderOpen,
  },
];

export const SETTINGS_NAV_ITEM: NavItemConfig = {
  id: 'settings',
  label: 'Configurações',
  shortDescription: 'Preferências da gráfica e conta',
  icon: Settings,
};

export function getNavMeta(id: NavPageId): NavItemConfig {
  if (id === 'settings') return SETTINGS_NAV_ITEM;
  return MAIN_NAV_ITEMS.find((item) => item.id === id) ?? MAIN_NAV_ITEMS[0];
}
