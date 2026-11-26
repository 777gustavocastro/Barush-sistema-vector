import type { ProductionOrder, SaleRecord } from '../types';

export interface SaleLineSnapshot {
  productId: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  catalogPrice: number;
  discount: number;
}

export interface SalePayment {
  id: string;
  method: SaleRecord['paymentMethod'];
  amount: number;
  paidAt: string;
}

export interface StoredSale {
  id: string;
  code: string;
  createdAt: string;
  dateLabel: string;
  clientId: string | null;
  clientName: string;
  lines: SaleLineSnapshot[];
  notes: string;
  subtotal: number;
  discount: number;
  addition: number;
  total: number;
  payments: SalePayment[];
  received: number;
  pending: number;
  paymentStatus: 'pago' | 'parcial' | 'pendente';
  status: 'finalizada' | 'cancelada' | 'orcamento';
  cancelReason?: string;
  cancelledAt?: string;
  productionOrders: ProductionOrder[];
}
