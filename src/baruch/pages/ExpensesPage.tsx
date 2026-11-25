import { Plus } from 'lucide-react';
import { useState } from 'react';
import { formatBRL } from '../data/mockData';
import type { ExpenseRecord } from '../types';

interface ExpensesPageProps {
  expenses: ExpenseRecord[];
  onAddExpense: (expense: ExpenseRecord) => void;
}

const EXPENSE_CATEGORIES: ExpenseRecord['category'][] = [
  'Insumos',
  'Equipamentos',
  'Terceirização',
  'Operacional',
  'Logística',
];

export function ExpensesPage({ expenses, onAddExpense }: ExpensesPageProps) {
  const [description, setDescription] = useState('');
  const [supplier, setSupplier] = useState('');
  const [category, setCategory] = useState<ExpenseRecord['category']>('Insumos');
  const [amount, setAmount] = useState('');
  const [showForm, setShowForm] = useState(false);

  const totalPaid = expenses
    .filter((e) => e.status === 'pago')
    .reduce((acc, e) => acc + e.amount, 0);
  const totalPending = expenses
    .filter((e) => e.status === 'pendente')
    .reduce((acc, e) => acc + e.amount, 0);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const numeric = parseFloat(amount.replace(',', '.'));
    if (!description.trim() || !numeric || numeric <= 0) return;

    onAddExpense({
      id: `exp-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      description: description.trim(),
      supplier: supplier.trim() || 'Fornecedor avulso',
      category,
      amount: numeric,
      status: 'pago',
    });

    setDescription('');
    setSupplier('');
    setAmount('');
    setShowForm(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-[#071A34] tracking-[-0.015em]">
            Despesas e custos operacionais
          </h2>
          <p className="text-[12.5px] text-[#5A6B82] mt-0.5">
            Controle de compras de insumos, manutenção de equipamentos e saídas financeiras.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowForm((prev) => !prev)}
          className="h-8 px-3.5 rounded-md bg-[#071A34] text-white text-[12.5px] font-medium hover:bg-[#0D284D] transition-colors inline-flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5 text-[#E3C16F]" />
          Registrar despesa
        </button>
      </div>

      {/* Resumo de despesas */}
      <div className="bg-white border border-[#E4EAF1] rounded-lg grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#EEF2F7]">
        <div className="p-4">
          <div className="text-[12px] text-[#5A6B82]">Total lançado</div>
          <div className="text-[19px] font-semibold text-[#071A34] tabular-nums mt-1">
            {formatBRL(totalPaid + totalPending)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-[12px] text-[#5A6B82]">Liquidado</div>
          <div className="text-[19px] font-semibold text-emerald-700 tabular-nums mt-1">
            {formatBRL(totalPaid)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-[12px] text-[#5A6B82]">A pagar</div>
          <div className="text-[19px] font-semibold text-[#9A7220] tabular-nums mt-1">
            {formatBRL(totalPending)}
          </div>
        </div>
      </div>

      {/* Formulário inline discreto */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white border border-[#E4EAF1] rounded-lg p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
        >
          <div className="md:col-span-4">
            <label className="block text-[11.5px] font-medium text-[#5A6B82] mb-1">
              Descrição
            </label>
            <input
              type="text"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex.: Bobina BOPP fosco 30cm"
              className="w-full h-8 px-2.5 rounded-md bg-[#F6F8FB] border border-[#E4EAF1] text-[13px] focus:outline-none focus:bg-white focus:border-[#071A34]/40"
            />
          </div>
          <div className="md:col-span-3">
            <label className="block text-[11.5px] font-medium text-[#5A6B82] mb-1">
              Fornecedor
            </label>
            <input
              type="text"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="Nome do fornecedor"
              className="w-full h-8 px-2.5 rounded-md bg-[#F6F8FB] border border-[#E4EAF1] text-[13px] focus:outline-none focus:bg-white focus:border-[#071A34]/40"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11.5px] font-medium text-[#5A6B82] mb-1">
              Categoria
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseRecord['category'])}
              className="w-full h-8 px-2 rounded-md bg-[#F6F8FB] border border-[#E4EAF1] text-[12.5px] focus:outline-none focus:bg-white"
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11.5px] font-medium text-[#5A6B82] mb-1">
              Valor (R$)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              className="w-full h-8 px-2.5 rounded-md bg-[#F6F8FB] border border-[#E4EAF1] text-[13px] tabular-nums focus:outline-none focus:bg-white"
            />
          </div>
          <div className="md:col-span-1">
            <button
              type="submit"
              className="w-full h-8 rounded-md bg-[#071A34] text-white text-[12.5px] font-medium hover:bg-[#0D284D]"
            >
              Salvar
            </button>
          </div>
        </form>
      )}

      {/* Tabela de despesas */}
      <div className="bg-white border border-[#E4EAF1] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#EEF2F7] bg-[#FAFBFD] text-[11.5px] font-medium text-[#5A6B82]">
                <th className="py-2.5 px-4">Data</th>
                <th className="py-2.5 px-4">Descrição / Fornecedor</th>
                <th className="py-2.5 px-4">Categoria</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4 text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-[13px]">
              {expenses.map((expense) => (
                <tr key={expense.id} className="hover:bg-[#F8FAFC]">
                  <td className="py-2.5 px-4 font-mono text-[12px] text-[#5A6B82] whitespace-nowrap">
                    {expense.date.split('-').reverse().join('/')}
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="font-medium text-[#0F1E36]">{expense.description}</div>
                    <div className="text-[11.5px] text-[#5A6B82]">{expense.supplier}</div>
                  </td>
                  <td className="py-2.5 px-4 text-[#334155]">{expense.category}</td>
                  <td className="py-2.5 px-4 whitespace-nowrap">
                    <span
                      className={`text-[11.5px] font-medium px-2 py-0.5 rounded-full ${
                        expense.status === 'pago'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-[#C89B3C]/15 text-[#8A6418]'
                      }`}
                    >
                      {expense.status === 'pago' ? 'Pago' : 'Pendente'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-[#071A34] whitespace-nowrap">
                    {formatBRL(expense.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
