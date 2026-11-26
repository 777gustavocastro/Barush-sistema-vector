import {
  ArrowUp,
  Check,
  Eraser,
  Layers,
  Loader2,
  Maximize2,
  Paperclip,
  Waypoints,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MOCKUP_LABELS, VECTORIZE_MODE_LABELS } from './chatImageOps';
import type {
  AspectRatioOption,
  BottomToolId,
  ChatAttachment,
  MockupCategoryOption,
  OutputFormatOption,
  QualityOption,
  UpscaleFactorOption,
  VectorizeModeOption,
} from './chatTypes';

interface ChatComposerProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  attachments: ChatAttachment[];
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveAttachment: (id: string) => void;
  outputFormat: OutputFormatOption;
  onOutputFormatChange: (fmt: OutputFormatOption) => void;
  aspectRatio: AspectRatioOption;
  onAspectRatioChange: (ratio: AspectRatioOption) => void;
  quality: QualityOption;
  onQualityChange: (q: QualityOption) => void;
  activeTool: BottomToolId | null;
  onSelectTool: (tool: BottomToolId | null) => void;
  vectorizeMode: VectorizeModeOption;
  onVectorizeModeChange: (mode: VectorizeModeOption) => void;
  upscaleFactor: UpscaleFactorOption;
  onUpscaleFactorChange: (factor: UpscaleFactorOption) => void;
  mockupType: MockupCategoryOption;
  onMockupTypeChange: (type: MockupCategoryOption) => void;
  busy: boolean;
  onSubmit: () => void;
}

type OpenPopover =
  | null
  | 'output'
  | 'ratio'
  | 'quality'
  | 'vectorize'
  | 'upscale'
  | 'mockup';

const OUTPUT_OPTIONS: OutputFormatOption[] = ['PNG', 'PDF', 'SVG'];
const QUALITY_OPTIONS: QualityOption[] = ['4K', '2K'];
const VECTORIZE_OPTIONS: VectorizeModeOption[] = [
  'auto',
  'high_fidelity',
  'logo',
  'illustration',
];
const UPSCALE_OPTIONS: UpscaleFactorOption[] = ['2x', '4x'];
const MOCKUP_OPTIONS: MockupCategoryOption[] = [
  'copos',
  'camisetas',
  'uniformes',
  'banners',
  'cartao_visitas',
  'impressoes',
];

const RATIO_VISUALS: Array<{ id: AspectRatioOption; w: number; h: number }> = [
  { id: '1:1', w: 18, h: 18 },
  { id: '3:4', w: 15, h: 20 },
  { id: '4:3', w: 20, h: 15 },
  { id: '9:16', w: 12, h: 21 },
  { id: '16:9', w: 22, h: 13 },
  { id: '3:2', w: 21, h: 14 },
  { id: '2:3', w: 14, h: 21 },
  { id: '4:5', w: 16, h: 20 },
  { id: '21:9', w: 24, h: 11 },
  { id: 'A4', w: 14, h: 20 },
];

export function ChatComposer({
  prompt,
  onPromptChange,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  outputFormat,
  onOutputFormatChange,
  aspectRatio,
  onAspectRatioChange,
  quality,
  onQualityChange,
  activeTool,
  onSelectTool,
  vectorizeMode,
  onVectorizeModeChange,
  upscaleFactor,
  onUpscaleFactorChange,
  mockupType,
  onMockupTypeChange,
  busy,
  onSubmit,
}: ChatComposerProps) {
  const [openPopover, setOpenPopover] = useState<OpenPopover>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenPopover(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPopover(null);
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const canSend =
    !busy && (prompt.trim().length > 0 || attachments.length > 0 || activeTool !== null);

  return (
    <div ref={rootRef} className="w-full max-w-3xl mx-auto space-y-2.5">
      {/* Campo de chat compacto e elegante */}
      <div className="relative bg-white border border-[#DCE3EC] rounded-2xl shadow-[0_2px_10px_rgba(7,26,52,0.04)] px-3 py-2.5 focus-within:border-[#071A34]/35 transition-colors">
        {/* Faixa horizontal de miniaturas anexadas (esquerda para direita) */}
        {attachments.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-2.5 mb-1.5 border-b border-[#F1F5F9]">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="relative group shrink-0 w-12 h-12 rounded-lg overflow-hidden border border-[#E4EAF1] bg-[#FAFBFD]"
                title={att.name}
              >
                <img
                  src={att.dataUrl}
                  alt={att.name}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(att.id)}
                  aria-label={`Remover ${att.name}`}
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-[#071A34]/85 text-white flex items-center justify-center opacity-90 hover:opacity-100"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Linha principal: Clipe (esquerda) | Digitação (centro) | Saída, Formato, Qualidade, Envio (direita) */}
        <div className="flex items-end gap-2">
          {/* Lado esquerdo: Anexar múltiplas imagens */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.svg"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) {
                onAddFiles(e.target.files);
              }
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Anexar imagens"
            aria-label="Anexar imagens"
            className="h-8 w-8 rounded-full text-[#5A6B82] hover:text-[#071A34] hover:bg-[#F3F6FA] flex items-center justify-center shrink-0 transition-colors"
          >
            <Paperclip className="w-4 h-4" strokeWidth={1.75} />
          </button>

          {/* Área de digitação */}
          <textarea
            rows={1}
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (canSend) onSubmit();
              }
            }}
            placeholder={
              activeTool === 'vectorize'
                ? `Vetorizar (${VECTORIZE_MODE_LABELS[vectorizeMode]}) — anexe imagens ou envie...`
                : activeTool === 'upscale'
                  ? `Upscale (${upscaleFactor}) — anexe imagens ou envie...`
                  : activeTool === 'mockup'
                    ? `Mockup (${MOCKUP_LABELS[mockupType]}) — anexe imagens ou envie...`
                    : activeTool === 'remove_bg'
                      ? 'Remover fundo — anexe imagens ou envie...'
                      : 'Descreva o que deseja criar ou anexe imagens...'
            }
            className="flex-1 min-w-0 max-h-28 resize-none bg-transparent py-1.5 text-[13.5px] text-[#0F1E36] placeholder:text-slate-400 focus:outline-none leading-snug"
          />

          {/* Lado direito: Saída | Formato | Qualidade | Botão ícone enviar */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Saída (PNG padrão / PDF / SVG) */}
            <div className="relative">
              <button
                type="button"
                title="Saída"
                onClick={() =>
                  setOpenPopover((p) => (p === 'output' ? null : 'output'))
                }
                className={`h-7 px-2 rounded-lg text-[11.5px] font-medium transition-colors ${
                  openPopover === 'output'
                    ? 'bg-[#071A34] text-white'
                    : 'text-[#5A6B82] hover:text-[#071A34] hover:bg-[#F3F6FA]'
                }`}
              >
                {outputFormat}
              </button>

              {openPopover === 'output' && (
                <div className="absolute right-0 bottom-10 z-40 bg-white border border-[#E4EAF1] rounded-xl shadow-lg shadow-[#071A34]/8 p-1.5 min-w-[116px]">
                  <div className="px-2 py-1 text-[10.5px] font-medium text-[#8393A8] uppercase tracking-wider">
                    Saída
                  </div>
                  {OUTPUT_OPTIONS.map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => {
                        onOutputFormatChange(fmt);
                        setOpenPopover(null);
                      }}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-[12px] flex items-center justify-between transition-colors ${
                        outputFormat === fmt
                          ? 'bg-[#F3F7FC] text-[#071A34] font-semibold'
                          : 'text-[#334155] hover:bg-[#FAFBFD]'
                      }`}
                    >
                      <span>{fmt}</span>
                      {outputFormat === fmt && (
                        <Check className="w-3.5 h-3.5 text-[#C89B3C]" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Formato / Proporção (pop-up horizontal com desenho visual) */}
            <div className="relative">
              <button
                type="button"
                title="Formato"
                onClick={() =>
                  setOpenPopover((p) => (p === 'ratio' ? null : 'ratio'))
                }
                className={`h-7 px-2 rounded-lg text-[11.5px] font-medium inline-flex items-center gap-1.5 transition-colors ${
                  openPopover === 'ratio'
                    ? 'bg-[#071A34] text-white'
                    : 'text-[#5A6B82] hover:text-[#071A34] hover:bg-[#F3F6FA]'
                }`}
              >
                <span className="inline-block w-3 h-2.5 rounded-[2px] border border-current opacity-80" />
                <span>{aspectRatio}</span>
              </button>

              {openPopover === 'ratio' && (
                <div className="absolute right-0 bottom-10 z-40 bg-white border border-[#E4EAF1] rounded-xl shadow-lg shadow-[#071A34]/10 p-2.5 w-[min(92vw,540px)]">
                  <div className="px-1 pb-2 text-[10.5px] font-medium text-[#8393A8] uppercase tracking-wider">
                    Formato e proporção
                  </div>
                  <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
                    {RATIO_VISUALS.map((item) => {
                      const active = aspectRatio === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            onAspectRatioChange(item.id);
                            setOpenPopover(null);
                          }}
                          className={`shrink-0 w-[48px] py-2 rounded-lg border flex flex-col items-center justify-between gap-1.5 transition-colors ${
                            active
                              ? 'bg-[#071A34] border-[#071A34] text-white'
                              : 'bg-[#FAFBFD] border-[#E4EAF1] text-[#334155] hover:border-[#071A34]/35'
                          }`}
                        >
                          <div className="h-6 flex items-center justify-center">
                            <span
                              className={`block rounded-[2px] border-[1.5px] ${
                                active ? 'border-[#E3C16F]' : 'border-[#5A6B82]'
                              }`}
                              style={{ width: item.w, height: item.h }}
                            />
                          </div>
                          <span className="text-[10.5px] font-medium leading-none">
                            {item.id}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Qualidade (4K padrão / 2K) */}
            <div className="relative">
              <button
                type="button"
                title="Qualidade"
                onClick={() =>
                  setOpenPopover((p) => (p === 'quality' ? null : 'quality'))
                }
                className={`h-7 px-2 rounded-lg text-[11.5px] font-semibold transition-colors ${
                  openPopover === 'quality'
                    ? 'bg-[#071A34] text-[#E3C16F]'
                    : 'text-[#071A34] bg-[#F3F6FA] hover:bg-[#E9EEF5]'
                }`}
              >
                {quality}
              </button>

              {openPopover === 'quality' && (
                <div className="absolute right-0 bottom-10 z-40 bg-white border border-[#E4EAF1] rounded-xl shadow-lg shadow-[#071A34]/8 p-1.5 min-w-[104px]">
                  <div className="px-2 py-1 text-[10.5px] font-medium text-[#8393A8] uppercase tracking-wider">
                    Qualidade
                  </div>
                  {QUALITY_OPTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => {
                        onQualityChange(q);
                        setOpenPopover(null);
                      }}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-[12px] flex items-center justify-between transition-colors ${
                        quality === q
                          ? 'bg-[#F3F7FC] text-[#071A34] font-semibold'
                          : 'text-[#334155] hover:bg-[#FAFBFD]'
                      }`}
                    >
                      <span>{q}</span>
                      {quality === q && (
                        <Check className="w-3.5 h-3.5 text-[#C89B3C]" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Botão compacto com apenas ícone de envio */}
            <button
              type="button"
              disabled={!canSend}
              onClick={onSubmit}
              title="Enviar"
              aria-label="Enviar mensagem"
              className="ml-1 h-8 w-8 rounded-full bg-[#071A34] text-white hover:bg-[#0D284D] disabled:opacity-35 disabled:cursor-not-allowed flex items-center justify-center transition-colors shrink-0"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#E3C16F]" />
              ) : (
                <ArrowUp className="w-4 h-4 text-[#E3C16F]" strokeWidth={2.25} />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 4 Ferramentas abaixo do campo de digitação (seleção exclusiva) */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {/* 1. Vetorizar */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              if (activeTool === 'vectorize' && openPopover === 'vectorize') {
                onSelectTool(null);
                setOpenPopover(null);
              } else {
                onSelectTool('vectorize');
                setOpenPopover((p) => (p === 'vectorize' ? null : 'vectorize'));
              }
            }}
            className={`h-8 px-3 rounded-full text-[12px] font-medium inline-flex items-center gap-1.5 transition-all ${
              activeTool === 'vectorize'
                ? 'bg-[#071A34] text-white shadow-xs'
                : 'bg-white/80 border border-[#E4EAF1] text-[#334155] hover:text-[#071A34] hover:bg-white'
            }`}
          >
            <Waypoints
              className={`w-3.5 h-3.5 ${
                activeTool === 'vectorize' ? 'text-[#E3C16F]' : 'text-[#5A6B82]'
              }`}
              strokeWidth={1.75}
            />
            <span>Vetorizar</span>
            {activeTool === 'vectorize' && (
              <span className="text-[10.5px] text-[#E3C16F] font-normal">
                · {VECTORIZE_MODE_LABELS[vectorizeMode]}
              </span>
            )}
          </button>

          {openPopover === 'vectorize' && (
            <div className="absolute left-0 bottom-10 z-40 bg-white border border-[#E4EAF1] rounded-xl shadow-lg shadow-[#071A34]/10 p-1.5 min-w-[168px]">
              <div className="px-2.5 py-1 text-[10.5px] font-medium text-[#8393A8] uppercase tracking-wider">
                Modo de vetorização
              </div>
              {VECTORIZE_OPTIONS.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    onVectorizeModeChange(mode);
                    onSelectTool('vectorize');
                    setOpenPopover(null);
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-lg text-[12px] flex items-center justify-between transition-colors ${
                    vectorizeMode === mode
                      ? 'bg-[#F3F7FC] text-[#071A34] font-semibold'
                      : 'text-[#334155] hover:bg-[#FAFBFD]'
                  }`}
                >
                  <span>{VECTORIZE_MODE_LABELS[mode]}</span>
                  {vectorizeMode === mode && (
                    <Check className="w-3.5 h-3.5 text-[#C89B3C]" />
                  )}
                </button>
              ))}
              {activeTool === 'vectorize' && (
                <button
                  type="button"
                  onClick={() => {
                    onSelectTool(null);
                    setOpenPopover(null);
                  }}
                  className="w-full mt-1 pt-1.5 border-t border-[#F1F5F9] px-2.5 py-1 text-left text-[11px] text-[#5A6B82] hover:text-[#071A34]"
                >
                  Desativar ferramenta
                </button>
              )}
            </div>
          )}
        </div>

        {/* 2. Upscale */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              if (activeTool === 'upscale' && openPopover === 'upscale') {
                onSelectTool(null);
                setOpenPopover(null);
              } else {
                onSelectTool('upscale');
                setOpenPopover((p) => (p === 'upscale' ? null : 'upscale'));
              }
            }}
            className={`h-8 px-3 rounded-full text-[12px] font-medium inline-flex items-center gap-1.5 transition-all ${
              activeTool === 'upscale'
                ? 'bg-[#071A34] text-white shadow-xs'
                : 'bg-white/80 border border-[#E4EAF1] text-[#334155] hover:text-[#071A34] hover:bg-white'
            }`}
          >
            <Maximize2
              className={`w-3.5 h-3.5 ${
                activeTool === 'upscale' ? 'text-[#E3C16F]' : 'text-[#5A6B82]'
              }`}
              strokeWidth={1.75}
            />
            <span>Upscale</span>
            {activeTool === 'upscale' && (
              <span className="text-[10.5px] text-[#E3C16F] font-normal">
                · {upscaleFactor}
              </span>
            )}
          </button>

          {openPopover === 'upscale' && (
            <div className="absolute left-0 bottom-10 z-40 bg-white border border-[#E4EAF1] rounded-xl shadow-lg shadow-[#071A34]/10 p-1.5 min-w-[132px]">
              <div className="px-2.5 py-1 text-[10.5px] font-medium text-[#8393A8] uppercase tracking-wider">
                Ampliação
              </div>
              {UPSCALE_OPTIONS.map((factor) => (
                <button
                  key={factor}
                  type="button"
                  onClick={() => {
                    onUpscaleFactorChange(factor);
                    onSelectTool('upscale');
                    setOpenPopover(null);
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-lg text-[12px] flex items-center justify-between transition-colors ${
                    upscaleFactor === factor
                      ? 'bg-[#F3F7FC] text-[#071A34] font-semibold'
                      : 'text-[#334155] hover:bg-[#FAFBFD]'
                  }`}
                >
                  <span>{factor}</span>
                  {upscaleFactor === factor && (
                    <Check className="w-3.5 h-3.5 text-[#C89B3C]" />
                  )}
                </button>
              ))}
              {activeTool === 'upscale' && (
                <button
                  type="button"
                  onClick={() => {
                    onSelectTool(null);
                    setOpenPopover(null);
                  }}
                  className="w-full mt-1 pt-1.5 border-t border-[#F1F5F9] px-2.5 py-1 text-left text-[11px] text-[#5A6B82] hover:text-[#071A34]"
                >
                  Desativar ferramenta
                </button>
              )}
            </div>
          )}
        </div>

        {/* 3. Mockup */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              if (activeTool === 'mockup' && openPopover === 'mockup') {
                onSelectTool(null);
                setOpenPopover(null);
              } else {
                onSelectTool('mockup');
                setOpenPopover((p) => (p === 'mockup' ? null : 'mockup'));
              }
            }}
            className={`h-8 px-3 rounded-full text-[12px] font-medium inline-flex items-center gap-1.5 transition-all ${
              activeTool === 'mockup'
                ? 'bg-[#071A34] text-white shadow-xs'
                : 'bg-white/80 border border-[#E4EAF1] text-[#334155] hover:text-[#071A34] hover:bg-white'
            }`}
          >
            <Layers
              className={`w-3.5 h-3.5 ${
                activeTool === 'mockup' ? 'text-[#E3C16F]' : 'text-[#5A6B82]'
              }`}
              strokeWidth={1.75}
            />
            <span>Mockup</span>
            {activeTool === 'mockup' && (
              <span className="text-[10.5px] text-[#E3C16F] font-normal">
                · {MOCKUP_LABELS[mockupType]}
              </span>
            )}
          </button>

          {openPopover === 'mockup' && (
            <div className="absolute left-0 bottom-10 z-40 bg-white border border-[#E4EAF1] rounded-xl shadow-lg shadow-[#071A34]/10 p-1.5 min-w-[172px]">
              <div className="px-2.5 py-1 text-[10.5px] font-medium text-[#8393A8] uppercase tracking-wider">
                Tipo de mockup
              </div>
              {MOCKUP_OPTIONS.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    onMockupTypeChange(type);
                    onSelectTool('mockup');
                    setOpenPopover(null);
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-lg text-[12px] flex items-center justify-between transition-colors ${
                    mockupType === type
                      ? 'bg-[#F3F7FC] text-[#071A34] font-semibold'
                      : 'text-[#334155] hover:bg-[#FAFBFD]'
                  }`}
                >
                  <span>{MOCKUP_LABELS[type]}</span>
                  {mockupType === type && (
                    <Check className="w-3.5 h-3.5 text-[#C89B3C]" />
                  )}
                </button>
              ))}
              {activeTool === 'mockup' && (
                <button
                  type="button"
                  onClick={() => {
                    onSelectTool(null);
                    setOpenPopover(null);
                  }}
                  className="w-full mt-1 pt-1.5 border-t border-[#F1F5F9] px-2.5 py-1 text-left text-[11px] text-[#5A6B82] hover:text-[#071A34]"
                >
                  Desativar ferramenta
                </button>
              )}
            </div>
          )}
        </div>

        {/* 4. Remover fundo (ação direta, sem pop-up) */}
        <button
          type="button"
          onClick={() => {
            setOpenPopover(null);
            onSelectTool(activeTool === 'remove_bg' ? null : 'remove_bg');
          }}
          className={`h-8 px-3 rounded-full text-[12px] font-medium inline-flex items-center gap-1.5 transition-all ${
            activeTool === 'remove_bg'
              ? 'bg-[#071A34] text-white shadow-xs'
              : 'bg-white/80 border border-[#E4EAF1] text-[#334155] hover:text-[#071A34] hover:bg-white'
          }`}
        >
          <Eraser
            className={`w-3.5 h-3.5 ${
              activeTool === 'remove_bg' ? 'text-[#E3C16F]' : 'text-[#5A6B82]'
            }`}
            strokeWidth={1.75}
          />
          <span>Remover fundo</span>
        </button>
      </div>
    </div>
  );
}
