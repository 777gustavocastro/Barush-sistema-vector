import { ChevronLeft, ChevronRight, Image as ImageIcon } from 'lucide-react';
import type { ChatMediaItem } from './chatTypes';

interface ImageHistoryDrawerProps {
  open: boolean;
  onToggle: () => void;
  items: ChatMediaItem[];
  activeMediaId: string | null;
  onJumpToMedia: (mediaId: string) => void;
}

/**
 * Gaveta lateral direita flutuante (fundo infinito, sem coluna fixa ou card delimitador)
 * com seta fixa no canto superior direito e miniaturas verticais das imagens da conversa.
 */
export function ImageHistoryDrawer({
  open,
  onToggle,
  items,
  activeMediaId,
  onJumpToMedia,
}: ImageHistoryDrawerProps) {
  const ordered = [...items].reverse();

  return (
    <div className="pointer-events-none fixed top-16 right-5 z-20 flex flex-col items-end">
      {/* Seta acessível no canto superior direito */}
      <button
        type="button"
        onClick={onToggle}
        title={open ? 'Fechar histórico de imagens' : 'Abrir histórico de imagens da conversa'}
        aria-label={open ? 'Fechar histórico de imagens' : 'Abrir histórico de imagens da conversa'}
        className="pointer-events-auto h-8 w-8 rounded-full bg-white/85 backdrop-blur-sm border border-[#E4EAF1] text-[#071A34] hover:border-[#071A34]/35 hover:bg-white shadow-xs flex items-center justify-center transition-colors"
      >
        {open ? (
          <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
        ) : (
          <ChevronLeft className="w-4 h-4" strokeWidth={1.75} />
        )}
      </button>

      {/* Gaveta flutuante minimalista sem bloco/card pesado */}
      {open && (
        <div
          aria-label="Histórico visual da conversa"
          className="pointer-events-auto mt-2.5 w-[76px] max-h-[calc(100vh-11rem)] overflow-y-auto py-1 flex flex-col items-center gap-2 bg-[#F6F8FB]/75 backdrop-blur-md rounded-xl"
        >
          {ordered.length === 0 ? (
            <div
              className="w-14 h-14 rounded-lg border border-dashed border-[#DCE3EC] flex items-center justify-center text-slate-400"
              title="Nenhuma imagem nesta conversa"
            >
              <ImageIcon className="w-4 h-4" />
            </div>
          ) : (
            ordered.map((item) => {
              const isCurrent = item.id === activeMediaId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onJumpToMedia(item.id)}
                  title={`${item.label}${item.aspectRatio ? ` · ${item.aspectRatio}` : ''}`}
                  className={`group relative w-14 h-14 rounded-lg overflow-hidden border transition-all shrink-0 bg-white ${
                    isCurrent
                      ? 'border-[#C89B3C] ring-2 ring-[#C89B3C]/40 scale-[1.03]'
                      : 'border-[#E4EAF1] hover:border-[#071A34]/40 opacity-85 hover:opacity-100'
                  }`}
                >
                  <img
                    src={item.imageUrl}
                    alt={item.label}
                    className="w-full h-full object-cover"
                  />
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
