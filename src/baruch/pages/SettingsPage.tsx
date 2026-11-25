import { Check } from 'lucide-react';
import { useState } from 'react';

interface SettingsPageProps {
  userName: string;
  userRole: string;
}

export function SettingsPage({ userName, userRole }: SettingsPageProps) {
  const [companyName, setCompanyName] = useState('BARUCH Comunicação & Personalização');
  const [email, setEmail] = useState('contato@baruchgrafica.com.br');
  const [bleedDefault, setBleedDefault] = useState('3 mm');
  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-[18px] font-semibold text-[#071A34] tracking-[-0.015em]">
          Configurações do sistema
        </h2>
        <p className="text-[12.5px] text-[#5A6B82] mt-0.5">
          Identidade da gráfica, parâmetros técnicos padrão e perfil do usuário conectado.
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="bg-white border border-[#E4EAF1] rounded-lg divide-y divide-[#EEF2F7]"
      >
        <div className="p-5 space-y-4">
          <div className="text-[13px] font-semibold text-[#071A34]">
            Dados da gráfica
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-medium text-[#5A6B82] mb-1">
                Razão social / Nome fantasia
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full h-9 px-3 rounded-md bg-[#F6F8FB] border border-[#E4EAF1] text-[13px] text-[#0F1E36] focus:outline-none focus:bg-white focus:border-[#071A34]/40"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#5A6B82] mb-1">
                E-mail comercial
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-9 px-3 rounded-md bg-[#F6F8FB] border border-[#E4EAF1] text-[13px] text-[#0F1E36] focus:outline-none focus:bg-white focus:border-[#071A34]/40"
              />
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-[13px] font-semibold text-[#071A34]">
            Padrões de pré-impressão
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-medium text-[#5A6B82] mb-1">
                Sangria padrão
              </label>
              <select
                value={bleedDefault}
                onChange={(e) => setBleedDefault(e.target.value)}
                className="w-full h-9 px-3 rounded-md bg-[#F6F8FB] border border-[#E4EAF1] text-[13px] text-[#0F1E36] focus:outline-none focus:bg-white"
              >
                <option value="2 mm">2 mm</option>
                <option value="3 mm">3 mm (Padrão gráfico)</option>
                <option value="5 mm">5 mm (Grandes formatos)</option>
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#5A6B82] mb-1">
                Usuário conectado
              </label>
              <div className="h-9 px-3 rounded-md bg-[#FAFBFD] border border-[#E4EAF1] flex items-center justify-between text-[13px] text-[#0F1E36]">
                <span>{userName}</span>
                <span className="text-[11.5px] text-[#5A6B82]">{userRole}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-3.5 bg-[#FAFBFD] flex items-center justify-between">
          <span className="text-[12px] text-emerald-700 inline-flex items-center gap-1">
            {saved && (
              <>
                <Check className="w-3.5 h-3.5" />
                Alterações salvas
              </>
            )}
          </span>
          <button
            type="submit"
            className="h-8 px-4 rounded-md bg-[#071A34] text-white text-[12.5px] font-medium hover:bg-[#0D284D] transition-colors"
          >
            Salvar alterações
          </button>
        </div>
      </form>
    </div>
  );
}
