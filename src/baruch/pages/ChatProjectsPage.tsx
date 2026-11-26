import {
  Download,
  Eraser,
  Expand,
  Layers,
  Loader2,
  Maximize2,
  Ratio,
  Sparkles,
  Upload,
  Waypoints,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RealSvgViewport } from '../../components/RealSvgViewport';
import { BeforeAfterSlider } from '../chat/BeforeAfterSlider';
import { ChatComposer } from '../chat/ChatComposer';
import {
  MOCKUP_LABELS,
  VECTORIZE_MODE_LABELS,
  enhanceImageQuality,
  formatFileSize,
  generateConceptArtwork,
  generateTypedMockup,
  removeBackgroundFromImage,
  resizeImageToRatio,
  runRealVectorizationFromUrl,
  saveMediaInFormat,
  upscaleImageByFactor,
} from '../chat/chatImageOps';
import type {
  AspectRatioOption,
  BottomToolId,
  ChatAttachment,
  ChatConversation,
  ChatMediaItem,
  ChatMessage,
  HoverActionId,
  MockupCategoryOption,
  OutputFormatOption,
  QualityOption,
  UpscaleFactorOption,
  VectorizeModeOption,
} from '../chat/chatTypes';
import { CompanyDrawer } from '../chat/CompanyDrawer';
import { ImageHistoryDrawer } from '../chat/ImageHistoryDrawer';
import { CLIENTS } from '../data/mockData';

interface ChatProjectsPageProps {
  globalSearch: string;
  onBreadcrumbChange: (crumb: string | null) => void;
}

function nowTime(): string {
  return new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createInitialConversations(): ChatConversation[] {
  return CLIENTS.map((client, idx) => {
    if (idx === 0) {
      return {
        id: `conv-${client.id}`,
        clientId: client.id,
        updatedAt: '10:14',
        messages: [
          {
            id: 'msg-init-1',
            sender: 'user',
            text: 'Criar conceito visual institucional para a marca com acabamento dourado e azul-marinho.',
            time: '10:12',
          },
          {
            id: 'msg-init-2',
            sender: 'ai',
            text: 'Conceito criado na proporção 4:3 em 4K. Passe o mouse sobre a imagem para vetorizar, ampliar, remover fundo ou gerar mockup.',
            time: '10:14',
            media: {
              id: 'med-init-1',
              label: 'Conceito Institucional BARUCH',
              fileName: 'conceito-institucional.png',
              kind: 'generated',
              imageUrl: '/baruch-logo.jpg',
              aspectRatio: '4:3',
              qualityLabel: '4K · PNG',
              outputFormat: 'PNG',
            },
          },
        ],
      };
    }

    return {
      id: `conv-${client.id}`,
      clientId: client.id,
      updatedAt: client.lastActivity,
      messages: [
        {
          id: `msg-welcome-${client.id}`,
          sender: 'ai',
          text: `Conversa de ${client.company} pronta. Envie uma solicitação ou anexe imagens para criar, vetorizar, ampliar ou gerar mockups.`,
          time: client.lastActivity,
        },
      ],
    };
  });
}

export function ChatProjectsPage({
  globalSearch,
  onBreadcrumbChange,
}: ChatProjectsPageProps) {
  const [conversations, setConversations] = useState<ChatConversation[]>(
    createInitialConversations
  );
  const [activeClientId, setActiveClientId] = useState<string>(CLIENTS[0].id);
  const [companyDrawerCollapsed, setCompanyDrawerCollapsed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [highlightedMediaId, setHighlightedMediaId] = useState<string | null>(null);
  const [lightboxMedia, setLightboxMedia] = useState<ChatMediaItem | null>(null);

  // Composer e configurações superiores (lado direito)
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [outputFormat, setOutputFormat] = useState<OutputFormatOption>('PNG');
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>('1:1');
  const [quality, setQuality] = useState<QualityOption>('4K');

  // 4 Ferramentas inferiores (seleção exclusiva)
  const [activeTool, setActiveTool] = useState<BottomToolId | null>(null);
  const [vectorizeMode, setVectorizeMode] = useState<VectorizeModeOption>('auto');
  const [upscaleFactor, setUpscaleFactor] = useState<UpscaleFactorOption>('2x');
  const [mockupType, setMockupType] = useState<MockupCategoryOption>('camisetas');

  const [busy, setBusy] = useState(false);

  const mediaRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const endRef = useRef<HTMLDivElement | null>(null);

  const activeClient =
    CLIENTS.find((c) => c.id === activeClientId) ?? CLIENTS[0];
  const activeConv =
    conversations.find((c) => c.clientId === activeClientId) ?? conversations[0];

  const conversationMedia = useMemo<ChatMediaItem[]>(() => {
    return activeConv.messages
      .map((m) => m.media)
      .filter((m): m is ChatMediaItem => Boolean(m));
  }, [activeConv.messages]);

  useEffect(() => {
    onBreadcrumbChange(activeClient.company);
    return () => onBreadcrumbChange(null);
  }, [activeClient.company, onBreadcrumbChange]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeConv.messages.length, activeClientId]);

  const appendMessages = (clientId: string, newMsgs: ChatMessage[]) => {
    const time = nowTime();
    setConversations((prev) =>
      prev.map((conv) =>
        conv.clientId !== clientId
          ? conv
          : {
              ...conv,
              updatedAt: time,
              messages: [...conv.messages, ...newMsgs],
            }
      )
    );
  };

  const updateMessage = (
    clientId: string,
    msgId: string,
    updater: (m: ChatMessage) => ChatMessage
  ) => {
    setConversations((prev) =>
      prev.map((conv) =>
        conv.clientId !== clientId
          ? conv
          : {
              ...conv,
              messages: conv.messages.map((m) => (m.id === msgId ? updater(m) : m)),
            }
      )
    );
  };

  const ingestFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter(
      (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|svg)$/i.test(f.name)
    );
    if (files.length === 0) return;

    const loaded: ChatAttachment[] = await Promise.all(
      files.map(
        (file) =>
          new Promise<ChatAttachment>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                name: file.name,
                mimeType: file.type || 'image/png',
                sizeLabel: formatFileSize(file.size),
                isImage: true,
                dataUrl: typeof reader.result === 'string' ? reader.result : '',
                file,
              });
            };
            reader.readAsDataURL(file);
          })
      )
    );
    setAttachments((prev) => [...prev, ...loaded]);
  };

  /**
   * Executa uma ação de imagem (seja pela ferramenta inferior ao enviar ou pelo hover da imagem).
   */
  const executeImageAction = async (
    action: HoverActionId,
    target: { imageUrl: string; fileName: string; label: string; aspectRatio?: string },
    clientId: string
  ) => {
    if (action === 'vectorize') {
      const msgId = `ai-vec-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
      appendMessages(clientId, [
        {
          id: msgId,
          sender: 'ai',
          text: `Vetorizando ${target.label} no modo ${VECTORIZE_MODE_LABELS[vectorizeMode]}...`,
          time: nowTime(),
          progress: { stage: 'Preparando imagem...', percent: 10 },
        },
      ]);

      const result = await runRealVectorizationFromUrl(
        target.imageUrl,
        target.fileName,
        vectorizeMode,
        (ev) => {
          updateMessage(clientId, msgId, (m) => ({
            ...m,
            progress: { stage: ev.stageLabel, percent: Math.round(ev.percent) },
          }));
        }
      );

      const svgBlob = new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);
      const ssim = result.qualityReport
        ? ` · SSIM ${result.qualityReport.ssimPct.toFixed(1)}%`
        : '';

      updateMessage(clientId, msgId, (m) => ({
        ...m,
        progress: undefined,
        text: `Vetorização concluída (${VECTORIZE_MODE_LABELS[vectorizeMode]}).`,
        media: {
          id: `med-vec-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          label: `Vetor · ${target.label}`,
          fileName: `${target.fileName.replace(/\.[a-z0-9]+$/i, '')}.svg`,
          kind: 'vectorized',
          imageUrl: svgUrl,
          beforeUrl: target.imageUrl,
          svgMarkup: result.svg,
          vectorResult: result,
          aspectRatio: target.aspectRatio ?? aspectRatio,
          qualityLabel: `${result.reconstructedObjectCount} objetos · SVG${ssim}`,
          outputFormat: 'SVG',
          width: result.originalWidth,
          height: result.originalHeight,
          operationTag: 'Vetorizado',
        },
      }));
      return;
    }

    if (action === 'upscale') {
      const out = await upscaleImageByFactor(target.imageUrl, upscaleFactor);
      appendMessages(clientId, [
        {
          id: `ai-up-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          sender: 'ai',
          text: `Ampliação ${upscaleFactor} aplicada em ${target.label}.`,
          time: nowTime(),
          media: {
            id: `med-up-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            label: `Upscale ${upscaleFactor} · ${target.label}`,
            fileName: `${target.fileName.replace(/\.[a-z0-9]+$/i, '')}-${upscaleFactor}.png`,
            kind: 'processed',
            imageUrl: out.dataUrl,
            beforeUrl: target.imageUrl,
            aspectRatio: target.aspectRatio ?? aspectRatio,
            qualityLabel: out.qualityLabel,
            outputFormat,
            width: out.width,
            height: out.height,
            operationTag: `Upscale ${upscaleFactor}`,
          },
        },
      ]);
      return;
    }

    if (action === 'mockup') {
      const out = await generateTypedMockup(target.imageUrl, mockupType);
      appendMessages(clientId, [
        {
          id: `ai-mk-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          sender: 'ai',
          text: `Mockup de ${MOCKUP_LABELS[mockupType].toLowerCase()} gerado a partir de ${target.label}.`,
          time: nowTime(),
          media: {
            id: `med-mk-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            label: `Mockup ${MOCKUP_LABELS[mockupType]}`,
            fileName: `${target.fileName.replace(/\.[a-z0-9]+$/i, '')}-mockup-${mockupType}.png`,
            kind: 'processed',
            imageUrl: out.dataUrl,
            aspectRatio: '3:2',
            qualityLabel: `${out.width} × ${out.height} px · ${outputFormat}`,
            outputFormat,
            width: out.width,
            height: out.height,
            operationTag: MOCKUP_LABELS[mockupType],
          },
        },
      ]);
      return;
    }

    if (action === 'remove_bg') {
      const out = await removeBackgroundFromImage(target.imageUrl);
      appendMessages(clientId, [
        {
          id: `ai-bg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          sender: 'ai',
          text: `Fundo removido de ${target.label}.`,
          time: nowTime(),
          media: {
            id: `med-bg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            label: `Sem fundo · ${target.label}`,
            fileName: `${target.fileName.replace(/\.[a-z0-9]+$/i, '')}-sem-fundo.png`,
            kind: 'processed',
            imageUrl: out.dataUrl,
            beforeUrl: target.imageUrl,
            aspectRatio: target.aspectRatio ?? aspectRatio,
            qualityLabel: `${out.width} × ${out.height} px · PNG transparente`,
            outputFormat: 'PNG',
            width: out.width,
            height: out.height,
            operationTag: 'Sem fundo',
          },
        },
      ]);
      return;
    }

    if (action === 'resize') {
      const out = await resizeImageToRatio(target.imageUrl, aspectRatio, quality);
      appendMessages(clientId, [
        {
          id: `ai-rs-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          sender: 'ai',
          text: `Imagem redimensionada para ${aspectRatio} (${quality}).`,
          time: nowTime(),
          media: {
            id: `med-rs-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            label: `Redimensionada · ${target.label}`,
            fileName: `${target.fileName.replace(/\.[a-z0-9]+$/i, '')}-${aspectRatio.replace(':', 'x')}.png`,
            kind: 'processed',
            imageUrl: out.dataUrl,
            aspectRatio,
            qualityLabel: `${quality} · ${out.width} × ${out.height} px`,
            outputFormat,
            width: out.width,
            height: out.height,
            operationTag: `Formato ${aspectRatio}`,
          },
        },
      ]);
      return;
    }

    if (action === 'enhance') {
      const out = await enhanceImageQuality(target.imageUrl);
      appendMessages(clientId, [
        {
          id: `ai-en-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          sender: 'ai',
          text: `Qualidade e nitidez aprimoradas em ${target.label}.`,
          time: nowTime(),
          media: {
            id: `med-en-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            label: `Aprimorada · ${target.label}`,
            fileName: `${target.fileName.replace(/\.[a-z0-9]+$/i, '')}-hd.png`,
            kind: 'processed',
            imageUrl: out.dataUrl,
            beforeUrl: target.imageUrl,
            aspectRatio: target.aspectRatio ?? aspectRatio,
            qualityLabel: `${out.width} × ${out.height} px · ${outputFormat}`,
            outputFormat,
            width: out.width,
            height: out.height,
            operationTag: 'Melhorada',
          },
        },
      ]);
    }
  };

  /**
   * Envio principal do composer:
   * - Se houver ferramenta inferior selecionada + imagens anexadas: processa em ordem sequencial.
   * - Se houver ferramenta inferior selecionada sem anexos: aplica na última imagem da conversa.
   * - Se nenhuma ferramenta inferior estiver selecionada: fluxo normal de geração.
   */
  const handleSubmit = async () => {
    if (busy) return;
    const text = prompt.trim();
    const currentAttachments = [...attachments];
    if (!text && currentAttachments.length === 0 && !activeTool) return;

    const targetClientId = activeClient.id;
    setPrompt('');
    setAttachments([]);
    setBusy(true);

    try {
      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        sender: 'user',
        text:
          text ||
          (activeTool
            ? `${
                activeTool === 'vectorize'
                  ? `Vetorizar (${VECTORIZE_MODE_LABELS[vectorizeMode]})`
                  : activeTool === 'upscale'
                    ? `Upscale (${upscaleFactor})`
                    : activeTool === 'mockup'
                      ? `Mockup (${MOCKUP_LABELS[mockupType]})`
                      : 'Remover fundo'
              }${currentAttachments.length > 0 ? ` · ${currentAttachments.length} imagem(ns)` : ''}`
            : `${currentAttachments.length} imagem(ns) anexada(s)`),
        time: nowTime(),
        attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
      };
      appendMessages(targetClientId, [userMsg]);

      // Caso 1: ferramenta inferior ativa -> aplica nas imagens anexadas em ordem (ou última da conversa)
      if (activeTool) {
        if (currentAttachments.length > 0) {
          for (const att of currentAttachments) {
            await executeImageAction(
              activeTool,
              {
                imageUrl: att.dataUrl,
                fileName: att.name,
                label: att.name,
                aspectRatio,
              },
              targetClientId
            );
          }
        } else {
          const latestMedia = conversationMedia[conversationMedia.length - 1];
          if (latestMedia) {
            await executeImageAction(
              activeTool,
              {
                imageUrl: latestMedia.imageUrl,
                fileName: latestMedia.fileName,
                label: latestMedia.label,
                aspectRatio: latestMedia.aspectRatio,
              },
              targetClientId
            );
          } else {
            appendMessages(targetClientId, [
              {
                id: `ai-hint-${Date.now()}`,
                sender: 'ai',
                text: 'Anexe uma ou mais imagens para aplicar esta ferramenta.',
                time: nowTime(),
              },
            ]);
          }
        }
        return;
      }

      // Caso 2: nenhuma ferramenta inferior selecionada -> geração normal (ou registro das imagens anexadas)
      if (currentAttachments.length > 0 && !text) {
        const addedMsgs: ChatMessage[] = currentAttachments.map((att, index) => ({
          id: `ai-att-${Date.now()}-${index}`,
          sender: 'ai',
          text: `Imagem recebida. Passe o mouse sobre ela para aplicar ações rápidas.`,
          time: nowTime(),
          media: {
            id: `med-att-${Date.now()}-${index}`,
            label: att.name,
            fileName: att.name,
            kind: 'attached',
            imageUrl: att.dataUrl,
            aspectRatio,
            qualityLabel: `${att.sizeLabel} · ${outputFormat}`,
            outputFormat,
          },
        }));
        appendMessages(targetClientId, addedMsgs);
        return;
      }

      const generated = generateConceptArtwork(
        text || 'Criação visual',
        activeClient.company,
        aspectRatio,
        quality
      );

      appendMessages(targetClientId, [
        {
          id: `ai-gen-${Date.now()}`,
          sender: 'ai',
          text: `Imagem gerada em ${aspectRatio} (${quality}, saída ${outputFormat}).`,
          time: nowTime(),
          media: {
            id: `med-gen-${Date.now()}`,
            label: text ? text.slice(0, 42) : `Criação · ${activeClient.company}`,
            fileName: `${activeClient.initials.toLowerCase()}-arte-${Date.now().toString().slice(-4)}.${outputFormat.toLowerCase()}`,
            kind: 'generated',
            imageUrl: generated.dataUrl,
            aspectRatio,
            qualityLabel: `${quality} · ${outputFormat}`,
            outputFormat,
            width: generated.width,
            height: generated.height,
          },
        },
      ]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro inesperado no processamento.';
      appendMessages(targetClientId, [
        {
          id: `ai-err-${Date.now()}`,
          sender: 'ai',
          text: `Não foi possível concluir a ação: ${msg}`,
          time: nowTime(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const handleHoverAction = async (action: HoverActionId, media: ChatMediaItem) => {
    if (busy) return;
    setBusy(true);
    try {
      await executeImageAction(
        action,
        {
          imageUrl: media.imageUrl,
          fileName: media.fileName,
          label: media.label,
          aspectRatio: media.aspectRatio,
        },
        activeClient.id
      );
    } finally {
      setBusy(false);
    }
  };

  const handleJumpToMedia = (mediaId: string) => {
    const el = mediaRefs.current[mediaId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedMediaId(mediaId);
      setTimeout(() => {
        setHighlightedMediaId((curr) => (curr === mediaId ? null : curr));
      }, 1500);
    }
  };

  const visibleMessages = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return activeConv.messages;
    return activeConv.messages.filter(
      (m) =>
        m.text.toLowerCase().includes(q) ||
        m.media?.label.toLowerCase().includes(q)
    );
  }, [activeConv.messages, globalSearch]);

  return (
    <div
      className="relative flex gap-6 h-[calc(100vh-5.5rem)]"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDragOver(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) {
          void ingestFiles(e.dataTransfer.files);
        }
      }}
    >
      {/* 1. Gaveta lateral esquerda: Empresas e conversas independentes */}
      <CompanyDrawer
        clients={CLIENTS}
        activeClientId={activeClientId}
        collapsed={companyDrawerCollapsed}
        onToggleCollapse={() => setCompanyDrawerCollapsed((v) => !v)}
        onSelectClient={(id) => {
          setActiveClientId(id);
          setAttachments([]);
        }}
      />

      {/* 2. Área central de conversa (fundo infinito, sem caixas ou colunas extras) */}
      <div className="flex-1 min-w-0 flex flex-col relative">
        {dragOver && (
          <div className="absolute inset-0 z-30 rounded-2xl border-2 border-dashed border-[#C89B3C] bg-[#071A34]/5 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
            <div className="bg-white border border-[#E4EAF1] rounded-xl px-5 py-3.5 shadow-sm flex items-center gap-2.5">
              <Upload className="w-4 h-4 text-[#C89B3C]" />
              <span className="text-[13px] font-medium text-[#071A34]">
                Solte as imagens para anexar
              </span>
            </div>
          </div>
        )}

        {/* Fluxo central de mensagens */}
        <div className="flex-1 overflow-y-auto px-2 pr-16 pb-6">
          <div className="max-w-3xl mx-auto space-y-7 pt-1">
            {visibleMessages.map((msg) => {
              const isUser = msg.sender === 'user';
              const media = msg.media;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  {/* Miniaturas enviadas pelo usuário */}
                  {isUser && msg.attachments && msg.attachments.length > 0 && (
                    <div className="mb-2 flex flex-wrap justify-end gap-1.5">
                      {msg.attachments.map((att) => (
                        <img
                          key={att.id}
                          src={att.dataUrl}
                          alt={att.name}
                          className="w-14 h-14 rounded-lg object-cover border border-[#E4EAF1]"
                        />
                      ))}
                    </div>
                  )}

                  {/* Texto limpo sem excesso de caixas */}
                  {isUser ? (
                    <div className="max-w-[78%] bg-[#071A34] text-white px-4 py-2.5 rounded-2xl rounded-br-sm text-[13.5px] leading-relaxed">
                      <p>{msg.text}</p>
                    </div>
                  ) : (
                    <div className="max-w-[88%] text-[#0F1E36] text-[13.5px] leading-relaxed">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Sparkles className="w-3.5 h-3.5 text-[#C89B3C]" />
                        <span className="text-[11.5px] font-semibold text-[#071A34]">
                          BARUCH
                        </span>
                        <span className="text-[11px] text-slate-400">{msg.time}</span>
                      </div>
                      <p>{msg.text}</p>
                    </div>
                  )}

                  {/* Progresso real da vetorização */}
                  {msg.progress && (
                    <div className="mt-2.5 w-full max-w-sm space-y-1.5">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="inline-flex items-center gap-1.5 text-[#071A34] font-medium">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C89B3C]" />
                          {msg.progress.stage}
                        </span>
                        <span className="tabular-nums text-[#5A6B82]">
                          {msg.progress.percent}%
                        </span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-[#E4EAF1] overflow-hidden">
                        <div
                          className="h-full bg-[#071A34] transition-all duration-200"
                          style={{ width: `${Math.max(8, msg.progress.percent)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Resposta com imagem: tamanho confortável, fundo infinito e ações SOMENTE no hover */}
                  {media && (
                    <div
                      ref={(el) => {
                        mediaRefs.current[media.id] = el;
                      }}
                      className={`mt-3 w-fit max-w-[490px] transition-all ${
                        highlightedMediaId === media.id
                          ? 'ring-2 ring-[#C89B3C] ring-offset-4 ring-offset-[#F6F8FB] rounded-xl'
                          : ''
                      }`}
                    >
                      {/* Container da imagem com controles exclusivos no hover */}
                      <div className="group inline-block max-w-full">
                        {/* Cabeçalho discreto da imagem alinhado à largura da arte */}
                        <div className="mb-1.5 flex items-center justify-between gap-3 text-[11.5px]">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium text-[#071A34] truncate">
                              {media.label}
                            </span>
                            {media.aspectRatio && (
                              <span className="text-[#5A6B82] font-mono text-[11px] shrink-0">
                                {media.aspectRatio}
                              </span>
                            )}
                          </div>
                          {media.qualityLabel && (
                            <span className="text-[#8393A8] font-mono text-[10.5px] shrink-0">
                              {media.qualityLabel}
                            </span>
                          )}
                        </div>

                        <div className="relative rounded-xl overflow-hidden w-fit max-w-full">
                          {media.beforeUrl ? (
                            <div className="w-[460px] max-w-full">
                              <BeforeAfterSlider
                                beforeUrl={media.beforeUrl}
                                afterImageUrl={media.svgMarkup ? undefined : media.imageUrl}
                                afterSvgMarkup={media.svgMarkup}
                                beforeLabel="Antes"
                                afterLabel={media.svgMarkup ? 'SVG' : 'Depois'}
                                aspectClassName="h-[268px]"
                              />
                            </div>
                          ) : (
                            <img
                              src={media.imageUrl}
                              alt={media.label}
                              className="block max-w-full max-h-[285px] w-auto h-auto rounded-xl"
                            />
                          )}

                          {/* Topo direito (somente no hover): Salvar + Abrir ampliada */}
                          <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
                            <button
                              type="button"
                              onClick={() =>
                                void saveMediaInFormat(
                                  media.imageUrl,
                                  media.fileName,
                                  media.svgMarkup ? 'SVG' : (media.outputFormat ?? outputFormat),
                                  media.svgMarkup
                                )
                              }
                              title="Salvar imagem"
                              aria-label="Salvar imagem"
                              className="h-8 w-8 rounded-full bg-[#071A34]/85 text-white hover:bg-[#071A34] backdrop-blur-sm flex items-center justify-center shadow-sm transition-colors"
                            >
                              <Download className="w-3.5 h-3.5 text-[#E3C16F]" strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setLightboxMedia(media)}
                              title="Visualizar ampliada"
                              aria-label="Abrir imagem em visualização ampliada"
                              className="h-8 w-8 rounded-full bg-[#071A34]/85 text-white hover:bg-[#071A34] backdrop-blur-sm flex items-center justify-center shadow-sm transition-colors"
                            >
                              <Expand className="w-3.5 h-3.5" strokeWidth={2} />
                            </button>
                          </div>
                        </div>

                        {/* Barra horizontal discreta (somente no hover, sem sobrepor a arte) */}
                        <div className="pt-2 flex flex-wrap items-center gap-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto transition-opacity duration-150">
                          <HoverActionBtn
                            icon={Waypoints}
                            label="Vetorizar"
                            disabled={busy}
                            onClick={() => void handleHoverAction('vectorize', media)}
                          />
                          <HoverActionBtn
                            icon={Maximize2}
                            label="Upscale"
                            disabled={busy}
                            onClick={() => void handleHoverAction('upscale', media)}
                          />
                          <HoverActionBtn
                            icon={Eraser}
                            label="Remover fundo"
                            disabled={busy}
                            onClick={() => void handleHoverAction('remove_bg', media)}
                          />
                          <HoverActionBtn
                            icon={Layers}
                            label="Gerar mockup"
                            disabled={busy}
                            onClick={() => void handleHoverAction('mockup', media)}
                          />
                          <HoverActionBtn
                            icon={Ratio}
                            label="Redimensionar"
                            disabled={busy}
                            onClick={() => void handleHoverAction('resize', media)}
                          />
                          <HoverActionBtn
                            icon={Sparkles}
                            label="Melhorar qualidade"
                            disabled={busy}
                            onClick={() => void handleHoverAction('enhance', media)}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        </div>

        {/* 3. Novo Composer compacto + 4 ferramentas exclusivas abaixo */}
        <div className="shrink-0 pt-2 pb-1 px-2 bg-[#F6F8FB]">
          <ChatComposer
            prompt={prompt}
            onPromptChange={setPrompt}
            attachments={attachments}
            onAddFiles={(files) => void ingestFiles(files)}
            onRemoveAttachment={(id) =>
              setAttachments((prev) => prev.filter((a) => a.id !== id))
            }
            outputFormat={outputFormat}
            onOutputFormatChange={setOutputFormat}
            aspectRatio={aspectRatio}
            onAspectRatioChange={setAspectRatio}
            quality={quality}
            onQualityChange={setQuality}
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            vectorizeMode={vectorizeMode}
            onVectorizeModeChange={setVectorizeMode}
            upscaleFactor={upscaleFactor}
            onUpscaleFactorChange={setUpscaleFactor}
            mockupType={mockupType}
            onMockupTypeChange={setMockupType}
            busy={busy}
            onSubmit={() => void handleSubmit()}
          />
        </div>
      </div>

      {/* 4. Histórico visual de imagens flutuante à direita (seta fixa no canto superior direito) */}
      <ImageHistoryDrawer
        open={historyOpen}
        onToggle={() => setHistoryOpen((v) => !v)}
        items={conversationMedia}
        activeMediaId={highlightedMediaId}
        onJumpToMedia={handleJumpToMedia}
      />

      {/* Lightbox de visualização ampliada */}
      {lightboxMedia && (
        <div
          className="fixed inset-0 z-50 bg-[#071A34]/80 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setLightboxMedia(null)}
        >
          <div
            className="relative max-w-5xl w-full max-h-[88vh] flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full flex items-center justify-between text-white">
              <div className="text-[13.5px] font-medium truncate">
                {lightboxMedia.label}
                {lightboxMedia.aspectRatio && (
                  <span className="ml-2 text-slate-300 font-mono text-[12px]">
                    {lightboxMedia.aspectRatio}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void saveMediaInFormat(
                      lightboxMedia.imageUrl,
                      lightboxMedia.fileName,
                      lightboxMedia.svgMarkup
                        ? 'SVG'
                        : (lightboxMedia.outputFormat ?? outputFormat),
                      lightboxMedia.svgMarkup
                    )
                  }
                  className="h-8 px-3 rounded-full bg-white/15 hover:bg-white/25 text-white text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-[#E3C16F]" />
                  <span>Salvar</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLightboxMedia(null)}
                  aria-label="Fechar visualização ampliada"
                  className="h-8 w-8 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="w-full h-[76vh] rounded-2xl overflow-hidden bg-white flex items-center justify-center p-4">
              {lightboxMedia.svgMarkup ? (
                <RealSvgViewport
                  svgMarkup={lightboxMedia.svgMarkup}
                  className="w-full h-full"
                />
              ) : (
                <img
                  src={lightboxMedia.imageUrl}
                  alt={lightboxMedia.label}
                  className="max-w-full max-h-full object-contain"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HoverActionBtn({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: typeof Sparkles;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="px-2.5 py-1 rounded-full text-[11.5px] font-medium text-[#3B4B61] hover:text-[#071A34] hover:bg-white/90 hover:shadow-[0_1px_4px_rgba(7,26,52,0.08)] inline-flex items-center gap-1.5 transition-all disabled:opacity-40 whitespace-nowrap"
    >
      <Icon className="w-3.5 h-3.5 text-[#5A6B82] shrink-0" strokeWidth={1.75} />
      <span>{label}</span>
    </button>
  );
}
