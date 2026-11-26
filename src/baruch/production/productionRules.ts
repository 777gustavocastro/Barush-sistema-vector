import type { ProductionOrder, ProductionStatus } from '../types';

export const HISTORY_ACTOR = 'Gustavo Castro';

export type BoardColumn = 'aguardando' | 'producao' | 'pronto' | 'entregue';

const COLUMN_STATUS: Record<BoardColumn, ProductionStatus[]> = {
  aguardando: ['arte_aprovacao', 'pre_impressao'],
  producao: ['producao', 'acabamento'],
  pronto: ['pronto'],
  entregue: ['entregue'],
};

export function columnOf(status: ProductionStatus): BoardColumn {
  if (COLUMN_STATUS.producao.includes(status)) return 'producao';
  if (status === 'pronto') return 'pronto';
  if (status === 'entregue') return 'entregue';
  return 'aguardando';
}

export function canSetStatus(order: ProductionOrder, status: ProductionStatus): { ok: boolean; message?: string } {
  if (order.status === status) return { ok: false, message: 'O pedido já está neste status.' };
  if (order.status === 'entregue' && status !== 'pronto') {
    return { ok: false, message: 'Um pedido entregue só pode voltar para pronto.' };
  }
  if (order.status === 'arte_aprovacao' && status !== 'pre_impressao') {
    return { ok: false, message: 'Aprove a arte antes de avançar a produção.' };
  }
  if (status === 'entregue' && order.status !== 'pronto') {
    return { ok: false, message: 'Só um pedido pronto pode ser marcado como entregue.' };
  }
  if ((status === 'producao' || status === 'acabamento' || status === 'pronto' || status === 'entregue') && order.approval === 'pendente') {
    return { ok: false, message: 'Aprove a arte antes de iniciar a produção.' };
  }
  return { ok: true };
}

export function canMove(order: ProductionOrder, target: BoardColumn): { ok: boolean; status?: ProductionStatus; message?: string } {
  const current = columnOf(order.status);
  if (current === target) return { ok: false, message: 'O pedido já está nesta etapa.' };
  const status: ProductionStatus =
    target === 'aguardando'
      ? order.approval === 'pendente'
        ? 'arte_aprovacao'
        : 'pre_impressao'
      : target === 'producao'
        ? 'producao'
        : target === 'pronto'
          ? 'pronto'
          : 'entregue';
  const check = canSetStatus(order, status);
  if (!check.ok) return { ok: false, message: check.message };
  return { ok: true, status };
}

export function historyLabel(status: ProductionStatus): string {
  if (status === 'pre_impressao') return 'Arte aprovada. Pedido aguardando início.';
  if (status === 'producao') return 'Produção iniciada.';
  if (status === 'acabamento') return 'Pedido enviado para acabamento.';
  if (status === 'pronto') return 'Produção marcada como pronta.';
  if (status === 'entregue') return 'Pedido marcado como entregue.';
  if (status === 'arte_aprovacao') return 'Pedido retornou para aprovação da arte.';
  return 'Status atualizado.';
}
