import { FileCode2, Plus } from 'lucide-react';
import { useState } from 'react';
import { PRODUCTS, formatBRL } from '../data/mockData';
import type { ProductRecord } from '../types';

interface ProductsPageProps {
  globalSearch: string;
}

const CATEGORIES: Array<'Todos' | ProductRecord['category']> = [
  'Todos',
  'Impressos',
  'Personalizados',
  'Comunicação Visual',
  'Embalagens',
];

export function ProductsPage({ globalSearch }: ProductsPageProps) {
  const [category, setCategory] = useState<'Todos' | ProductRecord['category']>('Todos');

  const filtered = PRODUCTS.filter((p) => {
    const matchCategory = category === 'Todos' || p.category === category;
    const q = globalSearch.trim().toLowerCase();
    const matchQuery =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      p.templateName.toLowerCase().includes(q);
    return matchCategory && matchQuery;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-[#071A34] tracking-[-0.015em]">
            Catálogo de produtos
          </h2>
          <p className="text-[12.5px] text-[#5A6B82] mt-0.5">
            Templates técnicos, dimensões, áreas de impressão, custos e tabela de preços.
          </p>
        </div>

        <button
          type="button"
          className="h-8 px-3.5 rounded-md bg-[#071A34] text-white text-[12.5px] font-medium hover:bg-[#0D284D] transition-colors inline-flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5 text-[#E3C16F]" />
          Cadastrar produto
        </button>
      </div>

      {/* Filtros discretos por categoria */}
      <div className="flex flex-wrap items-center gap-1.5">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={`h-8 px-3 rounded-md text-[12.5px] font-medium transition-colors ${
              category === cat
                ? 'bg-[#071A34] text-white'
                : 'bg-white border border-[#E4EAF1] text-[#5A6B82] hover:text-[#071A34]'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Tabela de produtos */}
      <div className="bg-white border border-[#E4EAF1] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#EEF2F7] bg-[#FAFBFD] text-[11.5px] font-medium text-[#5A6B82]">
                <th className="py-2.5 px-4">SKU / Produto</th>
                <th className="py-2.5 px-4">Template</th>
                <th className="py-2.5 px-4">Dimensões / Área de impressão</th>
                <th className="py-2.5 px-4 text-right">Custo</th>
                <th className="py-2.5 px-4 text-right">Preço venda</th>
                <th className="py-2.5 px-4 text-right">Margem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-[13px]">
              {filtered.map((product) => {
                const margin = Math.round(
                  ((product.price - product.cost) / product.price) * 100
                );
                return (
                  <tr
                    key={product.id}
                    className="hover:bg-[#F8FAFC] transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="font-medium text-[#0F1E36]">{product.name}</div>
                      <div className="text-[11.5px] text-[#5A6B82] mt-0.5">
                        <span className="font-mono">{product.sku}</span> · {product.category}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 font-mono text-[11.5px] text-[#334155] bg-[#F6F8FB] border border-[#E4EAF1] px-2 py-0.5 rounded">
                        <FileCode2 className="w-3.5 h-3.5 text-[#C89B3C]" />
                        {product.templateName}
                      </span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="text-[12.5px] text-[#0F1E36]">{product.dimensions}</div>
                      <div className="text-[11.5px] text-[#5A6B82]">
                        Impressão: {product.printArea}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums text-[#5A6B82] whitespace-nowrap">
                      {formatBRL(product.cost)}
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums font-semibold text-[#071A34] whitespace-nowrap">
                      {formatBRL(product.price)}
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                      <span className="text-[12px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                        {margin}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
