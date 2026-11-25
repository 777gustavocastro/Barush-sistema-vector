import { Download, FileCode2, FileImage, FileText, Upload } from 'lucide-react';
import { useState } from 'react';
import { CLIENTS, FILE_ASSETS } from '../data/mockData';
import type { FileAsset } from '../types';

interface FilesPageProps {
  globalSearch: string;
}

const FORMATS: Array<'Todos' | FileAsset['format']> = ['Todos', 'SVG', 'PDF', 'PNG'];

export function FilesPage({ globalSearch }: FilesPageProps) {
  const [format, setFormat] = useState<'Todos' | FileAsset['format']>('Todos');
  const [clientFilter, setClientFilter] = useState<string>('todos');

  const filtered = FILE_ASSETS.filter((file) => {
    const matchFormat = format === 'Todos' || file.format === format;
    const matchClient = clientFilter === 'todos' || file.clientId === clientFilter;
    const q = globalSearch.trim().toLowerCase();
    const matchQuery =
      !q ||
      file.name.toLowerCase().includes(q) ||
      file.clientName.toLowerCase().includes(q) ||
      file.project.toLowerCase().includes(q);
    return matchFormat && matchClient && matchQuery;
  });

  const renderIcon = (fmt: FileAsset['format']) => {
    if (fmt === 'SVG') return <FileCode2 className="w-4 h-4 text-[#C89B3C]" strokeWidth={1.75} />;
    if (fmt === 'PDF') return <FileText className="w-4 h-4 text-[#071A34]" strokeWidth={1.75} />;
    return <FileImage className="w-4 h-4 text-sky-700" strokeWidth={1.75} />;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-[#071A34] tracking-[-0.015em]">
            Biblioteca de arquivos e artes
          </h2>
          <p className="text-[12.5px] text-[#5A6B82] mt-0.5">
            Repositório centralizado de SVGs, PDFs de fechamento e imagens organizadas por cliente.
          </p>
        </div>

        <button
          type="button"
          className="h-8 px-3.5 rounded-md bg-[#071A34] text-white text-[12.5px] font-medium hover:bg-[#0D284D] transition-colors inline-flex items-center gap-1.5"
        >
          <Upload className="w-3.5 h-3.5 text-[#E3C16F]" />
          Enviar arquivo
        </button>
      </div>

      {/* Filtros por formato e cliente */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          {FORMATS.map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => setFormat(fmt)}
              className={`h-8 px-3 rounded-md text-[12.5px] font-medium transition-colors ${
                format === fmt
                  ? 'bg-[#071A34] text-white'
                  : 'bg-white border border-[#E4EAF1] text-[#5A6B82] hover:text-[#071A34]'
              }`}
            >
              {fmt}
            </button>
          ))}
        </div>

        <select
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          aria-label="Filtrar por cliente"
          className="h-8 px-3 rounded-md bg-white border border-[#E4EAF1] text-[12.5px] text-[#0F1E36] focus:outline-none focus:border-[#071A34]/40"
        >
          <option value="todos">Todos os clientes</option>
          {CLIENTS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.company}
            </option>
          ))}
        </select>
      </div>

      {/* Lista de arquivos */}
      <div className="bg-white border border-[#E4EAF1] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#EEF2F7] bg-[#FAFBFD] text-[11.5px] font-medium text-[#5A6B82]">
                <th className="py-2.5 px-4">Arquivo</th>
                <th className="py-2.5 px-4">Cliente</th>
                <th className="py-2.5 px-4">Projeto</th>
                <th className="py-2.5 px-4">Formato</th>
                <th className="py-2.5 px-4">Tamanho</th>
                <th className="py-2.5 px-4 text-right">Atualizado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-[13px]">
              {filtered.map((file) => (
                <tr key={file.id} className="hover:bg-[#F8FAFC] group">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      {renderIcon(file.format)}
                      <span className="font-mono text-[12.5px] text-[#071A34] font-medium">
                        {file.name}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-[#0F1E36]">{file.clientName}</td>
                  <td className="py-3 px-4 text-[#5A6B82]">{file.project}</td>
                  <td className="py-3 px-4">
                    <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-[#F1F5F9] text-[#334155]">
                      {file.format}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-[#5A6B82] tabular-nums">{file.size}</td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-3">
                      <span className="text-[12px] text-[#5A6B82]">{file.updatedAt}</span>
                      <button
                        type="button"
                        className="p-1 rounded text-slate-400 hover:text-[#071A34] hover:bg-[#EEF2F7] transition-colors"
                        title="Baixar arquivo"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </div>
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
