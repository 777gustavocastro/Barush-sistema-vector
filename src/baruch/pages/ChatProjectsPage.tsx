import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Download,
  Eraser,
  FileCode2,
  FileDown,
  FileText,
  Layers,
  Loader2,
  Maximize2,
  Package,
  PanelRight,
  Paperclip,
  Printer,
  Ratio,
  Send,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Wand2,
  Waypoints,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { VECTORIZER_PROFILES } from '../../constants/vectorizerConfig';
import { BeforeAfterSlider } from '../chat/BeforeAfterSlider';
import {
  buildPdfBlobFromImage,
  downloadVectorSvg,
  exportMediaAsFormat,
  formatFileSize,
  generateConceptArtwork,
  generateProductMockup,
  prepareForPrintSheet,
  processImageFilter,
  removeBackgroundFromImage,
  runRealVectorizationFromUrl,
  triggerDownload,
  upscaleImage,
} from '../chat/chatImageOps';
import type {
  AspectRatioOption,
  ChatAttachment,
  ChatConversation,
  ChatMediaItem,
  ChatMessage,
  ChatModelProfile,
  ChatToolId,
  OutputFormatOption,
  ResolutionPreset,
} from '../chat/chatTypes';
import { ClientDrawer } from '../chat/ClientDrawer';
import { CLIENTS, PRODUCTS } from '../data/mockData';
import type { ProductRecord } from '../types';

interface ChatProjectsPageProps {
  globalSearch: string;
  onBreadcrumbChange: (crumb: string | null) => void;
}

const ASPECT_RATIOS: Array<{ id: AspectRatioOption; label: string }> = [
  { id: 'product', label: 'Do produto' },
  { id: '1:1', label: '1:1' },
  { id: '4:3', label: '4:3' },
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
  { id: '3:2', label: '3:2' },
  { id: 'A4', label: 'A4' },
];

const OUTPUT_FORMATS: OutputFormatOption[] = ['SVG', 'PDF', 'PNG', 'JPG', 'WebP'];

function currentTimeLabel(): string {
  return new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createInitialConversations(): ChatConversation[] {
  return [
    {
      id: 'conv-1',
      clientId: CLIENTS[0].id,
      title: 'Cartão Executivo Dourado — Diretoria',
      productId: PRODUCTS[0].id,
      updatedAt: '10:18',
      messages: [
        {
          id: 'msg-1',
          sender: 'ai',
          text: 'Estúdio BARUCH pronto. Envie uma imagem, arraste um arquivo ou descreva a arte para gerar, vetorizar em SVG editável, criar mockup ou fechar para impressão.',
          time: '10:10',
        },
        {
          id: 'msg-2',
          sender: 'user',
          text: 'Preparar conceito institucional para o cartão executivo da Construtora Horizonte com área de hot stamping.',
          time: '10:12',
        },
        {
          id: 'msg-3',
          sender: 'ai',
          text: 'Arte inicial gerada respeitando as dimensões 90 × 50 mm e área de segurança 84 × 44 mm. Selecione a imagem abaixo para vetorizar em SVG real, remover fundo, gerar mockup ou fechar para impressão.',
          time: '10:14',
          media: {
            id: 'med-initial-1',
            label: 'Conceito Cartão Executivo',
            fileName: 'horizonte-cartao-executivo.png',
            kind: 'generated',
            imageUrl: '/baruch-logo.jpg',
            resolutionLabel: '1024 × 683 px',
            productName: PRODUCTS[0].name,
          },
        },
      ],
    },
    {
      id: 'conv-2',
      clientId: CLIENTS[1].id,
      title: 'Sacola Kraft — Edição Reserva',
      productId: PRODUCTS[3].id,
      updatedAt: '09:42',
      messages: [
        {
          id: 'msg-4',
          sender: 'ai',
          text: 'Conversa aberta para Café Origem Torrefação. Produto selecionado: Sacola Kraft Personalizada 24×34 cm (área de impressão 170 × 210 mm).',
          time: '09:42',
        },
      ],
    },
  ];
}

export function ChatProjectsPage({
  globalSearch,
  onBreadcrumbChange,
}: ChatProjectsPageProps) {
  const [conversations, setConversations] = useState<ChatConversation[]>(
    createInitialConversations
  );
  const [activeConvId, setActiveConvId] = useState<string>('conv-1');
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Composer e controles
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>('med-initial-1');
  const [modelProfile, setModelProfile] = useState<ChatModelProfile>('auto');
  const [resolution, setResolution] = useState<ResolutionPreset>('HD');
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>('product');
  const [outputFormat, setOutputFormat] = useState<OutputFormatOption>('SVG');
  const [busyTool, setBusyTool] = useState<ChatToolId | 'generate' | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null);

  const activeConv =
    conversations.find((c) => c.id === activeConvId) ?? conversations[0];
  const activeClient =
    CLIENTS.find((c) => c.id === activeConv.clientId) ?? CLIENTS[0];
  const activeProduct: ProductRecord | null =
    PRODUCTS.find((p) => p.id === activeConv.productId) ?? null;

  const conversationMedia = useMemo<ChatMediaItem[]>(() => {
    return activeConv.messages
      .map((m) => m.media)
      .filter((m): m is ChatMediaItem => Boolean(m));
  }, [activeConv.messages]);

  const selectedMedia =
    conversationMedia.find((m) => m.id === selectedMediaId) ??
    conversationMedia[conversationMedia.length - 1] ??
    null;

  useEffect(() => {
    onBreadcrumbChange(activeClient.company);
    return () => onBreadcrumbChange(null);
  }, [activeClient.company, onBreadcrumbChange]);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeConv.messages.length]);

  const appendMessages = (newMessages: ChatMessage[]) => {
    const now = currentTimeLabel();
    setConversations((prev) =>
      prev.map((conv) =>
        conv.id !== activeConv.id
          ? conv
          : {
              ...conv,
              updatedAt: now,
              messages: [...conv.messages, ...newMessages],
            }
      )
    );
  };

  const updateMessage = (msgId: string, updater: (msg: ChatMessage) => ChatMessage) => {
    setConversations((prev) =>
      prev.map((conv) =>
        conv.id !== activeConv.id
          ? conv
          : {
              ...conv,
              messages: conv.messages.map((m) => (m.id === msgId ? updater(m) : m)),
            }
      )
    );
  };

  const handleProductSelect = (productId: string) => {
    const nextId = productId || null;
    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === activeConv.id ? { ...conv, productId: nextId } : conv
      )
    );
    if (nextId) {
      setAspectRatio('product');
      const prod = PRODUCTS.find((p) => p.id === nextId);
      if (prod?.templateName.endsWith('.pdf')) setOutputFormat('PDF');
      else if (prod?.templateName.endsWith('.svg')) setOutputFormat('SVG');
    }
  };

  const handleChangeClient = (clientId: string) => {
    const existing = conversations.find((c) => c.clientId === clientId);
    if (existing) {
      setActiveConvId(existing.id);
      return;
    }
    const cli = CLIENTS.find((c) => c.id === clientId) ?? CLIENTS[0];
    const id = `conv-${Date.now()}`;
    const created: ChatConversation = {
      id,
      clientId: cli.id,
      title: `Novo projeto · ${cli.company}`,
      productId: activeProduct?.id ?? PRODUCTS[0].id,
      updatedAt: 'Agora',
      messages: [
        {
          id: `welcome-${Date.now()}`,
          sender: 'ai',
          text: `Conversa iniciada para ${cli.company}. Anexe uma imagem ou descreva a arte desejada.`,
          time: currentTimeLabel(),
        },
      ],
    };
    setConversations((prev) => [created, ...prev]);
    setActiveConvId(id);
  };

  const handleNewConversation = () => {
    const id = `conv-${Date.now()}`;
    const created: ChatConversation = {
      id,
      clientId: activeClient.id,
      title: `Arte ${activeClient.initials} · ${currentTimeLabel()}`,
      productId: activeProduct?.id ?? null,
      updatedAt: 'Agora',
      messages: [
        {
          id: `welcome-${Date.now()}`,
          sender: 'ai',
          text: `Novo projeto aberto para ${activeClient.company}. Envie uma imagem ou comando para começar.`,
          time: currentTimeLabel(),
        },
      ],
    };
    setConversations((prev) => [created, ...prev]);
    setActiveConvId(id);
    setSelectedMediaId(null);
  };

  const ingestFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const parsed: ChatAttachment[] = await Promise.all(
      files.map(
        (file) =>
          new Promise<ChatAttachment>((resolve) => {
            const isImage =
              file.type.startsWith('image/') ||
              /\.(png|jpe?g|webp|svg)$/i.test(file.name);
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                name: file.name,
                mimeType: file.type || 'application/octet-stream',
                sizeLabel: formatFileSize(file.size),
                isImage,
                dataUrl: typeof reader.result === 'string' ? reader.result : '',
                file,
              });
            };
            reader.readAsDataURL(file);
          })
      )
    );

    setAttachments((prev) => [...prev, ...parsed]);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const toggleApproveMedia = (mediaId: string) => {
    setConversations((prev) =>
      prev.map((conv) =>
        conv.id !== activeConv.id
          ? conv
          : {
              ...conv,
              messages: conv.messages.map((m) =>
                m.media?.id === mediaId
                  ? { ...m, media: { ...m.media, approved: !m.media.approved } }
                  : m
              ),
            }
      )
    );
  };

  const handleSendMessage = async (forceGenerate = false) => {
    const text = prompt.trim();
    const currentAttachments = [...attachments];
    if (!text && currentAttachments.length === 0 && !forceGenerate) return;

    setPrompt('');
    setAttachments([]);
    setStatusNote(null);

    const firstImageAtt = currentAttachments.find((a) => a.isImage);
    const attachedMedia: ChatMediaItem | undefined = firstImageAtt
      ? {
          id: `med-${Date.now()}`,
          label: firstImageAtt.name,
          fileName: firstImageAtt.name,
          kind: 'attached',
          imageUrl: firstImageAtt.dataUrl,
          productName: activeProduct?.name,
        }
      : undefined;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text:
        text ||
        (firstImageAtt
          ? `Imagem anexada: ${firstImageAtt.name}`
          : 'Gerar proposta visual com as configurações selecionadas.'),
      time: currentTimeLabel(),
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
      media: attachedMedia,
    };

    appendMessages([userMsg]);
    if (attachedMedia) {
      setSelectedMediaId(attachedMedia.id);
    }

    const wantsVector = /\bvetoriz/i.test(text);
    const wantsRemoveBg = /remov.*fundo|sem fundo/i.test(text);
    const wantsMockup = /mockup/i.test(text);
    const wantsPrint = /impress[ãa]o|sangria|fechamento/i.test(text);

    const targetForAuto = attachedMedia ?? selectedMedia;

    if (wantsVector && targetForAuto) {
      await runTool('vectorize', targetForAuto);
      return;
    }
    if (wantsRemoveBg && targetForAuto) {
      await runTool('remove_bg', targetForAuto);
      return;
    }
    if (wantsMockup && targetForAuto) {
      await runTool('mockup', targetForAuto);
      return;
    }
    if (wantsPrint && targetForAuto) {
      await runTool('print_prep', targetForAuto);
      return;
    }

    if (forceGenerate || (!firstImageAtt && text.length > 0)) {
      setBusyTool('generate');
      try {
        const art = generateConceptArtwork(
          text,
          activeClient.company,
          activeProduct,
          aspectRatio,
          resolution
        );
        const mediaId = `med-gen-${Date.now()}`;
        const media: ChatMediaItem = {
          id: mediaId,
          label: activeProduct ? `Arte · ${activeProduct.name}` : 'Arte gerada BARUCH',
          fileName: `${activeClient.initials.toLowerCase()}-arte-${Date.now().toString().slice(-4)}.png`,
          kind: 'generated',
          imageUrl: art.dataUrl,
          width: art.width,
          height: art.height,
          resolutionLabel: `${art.width} × ${art.height} px (${resolution})`,
          productName: activeProduct?.name,
        };
        appendMessages([
          {
            id: `ai-${Date.now()}`,
            sender: 'ai',
            text: activeProduct
              ? `Arte criada para ${activeProduct.name} (${activeProduct.dimensions}, área de impressão ${activeProduct.printArea}). Você pode vetorizar, gerar mockup ou preparar para impressão diretamente abaixo.`
              : `Arte criada em ${art.width} × ${art.height} px (${resolution}). Selecione uma ferramenta abaixo para continuar o fluxo.`,
            time: currentTimeLabel(),
            media,
          },
        ]);
        setSelectedMediaId(mediaId);
      } finally {
        setBusyTool(null);
      }
      return;
    }

    appendMessages([
      {
        id: `ai-${Date.now()}`,
        sender: 'ai',
        text: `Arquivo recebido e definido como referência ativa. Escolha uma ferramenta abaixo (como Vetorizar, Remover fundo, Upscale ou Preparar para impressão) para processar esta imagem.`,
        time: currentTimeLabel(),
      },
    ]);
  };

  /**
   * Executa qualquer ferramenta do estúdio sobre a imagem alvo (anexada, gerada ou processada).
   */
  const runTool = async (tool: ChatToolId, explicitTarget?: ChatMediaItem | null) => {
    if (busyTool) return;
    const target = explicitTarget ?? selectedMedia;

    if (!target) {
      setStatusNote('Anexe ou gere uma imagem primeiro para aplicar esta ferramenta.');
      return;
    }

    setStatusNote(null);
    setBusyTool(tool);

    try {
      // 1. VETORIZAÇÃO REAL (reaproveita 100% do pipeline existente!)
      if (tool === 'vectorize') {
        const progressMsgId = `ai-vec-${Date.now()}`;
        appendMessages([
          {
            id: progressMsgId,
            sender: 'ai',
            text: `Vetorizando "${target.fileName}" com o motor vetorial BARUCH (${
              VECTORIZER_PROFILES.find((p) => p.id === modelProfile)?.label ?? 'Automático'
            })...`,
            time: currentTimeLabel(),
            progress: { stage: 'Preparando imagem...', percent: 8 },
          },
        ]);

        const result = await runRealVectorizationFromUrl(
          target.imageUrl,
          target.fileName,
          modelProfile,
          (ev) => {
            updateMessage(progressMsgId, (m) => ({
              ...m,
              progress: { stage: ev.stageLabel, percent: Math.round(ev.percent) },
            }));
          }
        );

        const mediaId = `med-vec-${Date.now()}`;
        const svgBlob = new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' });
        const svgUrl = URL.createObjectURL(svgBlob);
        const ssim = result.qualityReport
          ? `${result.qualityReport.ssimPct.toFixed(1)}%`
          : null;

        const media: ChatMediaItem = {
          id: mediaId,
          label: `Vetor SVG · ${target.label}`,
          fileName: target.fileName.replace(/\.[a-z0-9]+$/i, '') + '.svg',
          kind: 'vectorized',
          imageUrl: svgUrl,
          beforeUrl: target.imageUrl,
          svgMarkup: result.svg,
          vectorResult: result,
          width: result.originalWidth,
          height: result.originalHeight,
          operationTag: 'Vetorizado (SVG real)',
          resolutionLabel: `${result.reconstructedObjectCount} objetos${ssim ? ` · SSIM ${ssim}` : ''}`,
          productName: activeProduct?.name,
        };

        updateMessage(progressMsgId, (m) => ({
          ...m,
          progress: undefined,
          text: `Vetorização concluída em SVG 100% editável (${result.reconstructedObjectCount} objetos vetoriais${
            result.reconstructedGradientCount > 0
              ? `, ${result.reconstructedGradientCount} gradientes nativos`
              : ''
          }${ssim ? `, fidelidade visual ${ssim}` : ''}). Arraste o divisor para comparar antes e depois.`,
          media,
        }));
        setSelectedMediaId(mediaId);
        return;
      }

      // 2. EXPORTAR SVG
      if (tool === 'export_svg') {
        if (target.svgMarkup) {
          downloadVectorSvg(target.svgMarkup, target.fileName);
          setStatusNote(`SVG exportado: ${target.fileName.replace(/\.[a-z0-9]+$/i, '')}.svg`);
          return;
        }
        // Se ainda não foi vetorizado, vetoriza primeiro automaticamente
        setBusyTool(null);
        await runTool('vectorize', target);
        return;
      }

      // 3. GERAR PDF
      if (tool === 'generate_pdf') {
        const pdfBlob = await buildPdfBlobFromImage(target.imageUrl);
        const pdfUrl = URL.createObjectURL(pdfBlob);
        const pdfName = `${target.fileName.replace(/\.[a-z0-9]+$/i, '')}-baruch.pdf`;
        triggerDownload(pdfBlob, pdfName);
        appendMessages([
          {
            id: `ai-pdf-${Date.now()}`,
            sender: 'ai',
            text: `Arquivo PDF gerado a partir de "${target.label}"${
              activeProduct ? ` para ${activeProduct.name} (${activeProduct.dimensions})` : ''
            }.`,
            time: currentTimeLabel(),
            fileDownload: {
              fileName: pdfName,
              format: 'PDF',
              sizeLabel: formatFileSize(pdfBlob.size),
              blobUrl: pdfUrl,
            },
          },
        ]);
        return;
      }

      // 4. REMOVER FUNDO
      if (tool === 'remove_bg') {
        const out = await removeBackgroundFromImage(target.imageUrl);
        const mediaId = `med-bg-${Date.now()}`;
        appendMessages([
          {
            id: `ai-bg-${Date.now()}`,
            sender: 'ai',
            text: `Fundo removido de "${target.label}" com transparência preservada em PNG.`,
            time: currentTimeLabel(),
            media: {
              id: mediaId,
              label: `Sem fundo · ${target.label}`,
              fileName: `${target.fileName.replace(/\.[a-z0-9]+$/i, '')}-sem-fundo.png`,
              kind: 'processed',
              imageUrl: out.dataUrl,
              beforeUrl: target.imageUrl,
              width: out.width,
              height: out.height,
              operationTag: 'Fundo removido',
              resolutionLabel: `${out.width} × ${out.height} px · PNG transparente`,
            },
          },
        ]);
        setSelectedMediaId(mediaId);
        return;
      }

      // 5. MELHORAR QUALIDADE / AJUSTAR IMAGEM
      if (tool === 'enhance' || tool === 'adjust') {
        const out = await processImageFilter(target.imageUrl, tool);
        const mediaId = `med-flt-${Date.now()}`;
        const tag = tool === 'enhance' ? 'Qualidade melhorada' : 'Imagem ajustada';
        appendMessages([
          {
            id: `ai-flt-${Date.now()}`,
            sender: 'ai',
            text:
              tool === 'enhance'
                ? `Nitidez, contraste e definição aprimorados em "${target.label}".`
                : `Equilíbrio cromático, brilho e saturação ajustados em "${target.label}".`,
            time: currentTimeLabel(),
            media: {
              id: mediaId,
              label: `${tag} · ${target.label}`,
              fileName: `${target.fileName.replace(/\.[a-z0-9]+$/i, '')}-${tool}.png`,
              kind: 'processed',
              imageUrl: out.dataUrl,
              beforeUrl: target.imageUrl,
              width: out.width,
              height: out.height,
              operationTag: tag,
              resolutionLabel: `${out.width} × ${out.height} px`,
            },
          },
        ]);
        setSelectedMediaId(mediaId);
        return;
      }

      // 6. UPSCALE / HD / 4K
      if (tool === 'upscale') {
        const out = await upscaleImage(target.imageUrl, resolution);
        const mediaId = `med-up-${Date.now()}`;
        appendMessages([
          {
            id: `ai-up-${Date.now()}`,
            sender: 'ai',
            text: `Resolução ampliada para ${out.resolutionLabel}.`,
            time: currentTimeLabel(),
            media: {
              id: mediaId,
              label: `Upscale ${resolution} · ${target.label}`,
              fileName: `${target.fileName.replace(/\.[a-z0-9]+$/i, '')}-${resolution.toLowerCase()}.png`,
              kind: 'processed',
              imageUrl: out.dataUrl,
              beforeUrl: target.imageUrl,
              width: out.width,
              height: out.height,
              operationTag: `Upscale ${resolution}`,
              resolutionLabel: out.resolutionLabel,
            },
          },
        ]);
        setSelectedMediaId(mediaId);
        return;
      }

      // 7. GERAR MOCKUP
      if (tool === 'mockup') {
        const out = await generateProductMockup(target.imageUrl, activeProduct);
        const mediaId = `med-mk-${Date.now()}`;
        appendMessages([
          {
            id: `ai-mk-${Date.now()}`,
            sender: 'ai',
            text: activeProduct
              ? `Mockup gerado aplicando a arte em ${activeProduct.name} (${activeProduct.dimensions}).`
              : `Mockup de apresentação gerado para aprovação do cliente.`,
            time: currentTimeLabel(),
            media: {
              id: mediaId,
              label: activeProduct ? `Mockup · ${activeProduct.name}` : 'Mockup de apresentação',
              fileName: `${target.fileName.replace(/\.[a-z0-9]+$/i, '')}-mockup.png`,
              kind: 'processed',
              imageUrl: out.dataUrl,
              width: out.width,
              height: out.height,
              operationTag: 'Mockup',
              resolutionLabel: `${out.width} × ${out.height} px`,
              productName: activeProduct?.name,
            },
          },
        ]);
        setSelectedMediaId(mediaId);
        return;
      }

      // 8. PREPARAR PARA IMPRESSÃO
      if (tool === 'print_prep') {
        const out = await prepareForPrintSheet(target.imageUrl, activeProduct);
        const mediaId = `med-pr-${Date.now()}`;
        appendMessages([
          {
            id: `ai-pr-${Date.now()}`,
            sender: 'ai',
            text: `Arquivo preparado para pré-impressão com sangria de 3 mm, marcas de corte e área de segurança${
              activeProduct ? ` (${activeProduct.dimensions} · template ${activeProduct.templateName})` : ''
            }.`,
            time: currentTimeLabel(),
            media: {
              id: mediaId,
              label: `Pré-impressão · ${target.label}`,
              fileName: `${target.fileName.replace(/\.[a-z0-9]+$/i, '')}-fechamento.png`,
              kind: 'processed',
              imageUrl: out.dataUrl,
              beforeUrl: target.imageUrl,
              width: out.width,
              height: out.height,
              operationTag: 'Pronto p/ impressão',
              resolutionLabel: 'Sangria 3 mm · Marcas de corte · 300 DPI',
              productName: activeProduct?.name,
            },
          },
        ]);
        setSelectedMediaId(mediaId);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro ao processar a operação.';
      appendMessages([
        {
          id: `err-${Date.now()}`,
          sender: 'ai',
          text: `Não foi possível concluir a operação: ${msg}`,
          time: currentTimeLabel(),
        },
      ]);
    } finally {
      setBusyTool(null);
    }
  };

  const filteredMessages = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return activeConv.messages;
    return activeConv.messages.filter(
      (m) =>
        m.text.toLowerCase().includes(q) ||
        m.media?.label.toLowerCase().includes(q) ||
        m.media?.fileName.toLowerCase().includes(q)
    );
  }, [activeConv.messages, globalSearch]);

  return (
    <div
      className="flex gap-5 min-h-[calc(100vh-5.5rem)]"
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
      {/* Área central de conversa (ocupa o máximo de espaço disponível) */}
      <div className="flex-1 min-w-0 flex flex-col relative">
        {dragOver && (
          <div className="absolute inset-0 z-30 rounded-xl border-2 border-dashed border-[#C89B3C] bg-[#071A34]/5 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
            <div className="bg-white border border-[#E4EAF1] rounded-xl px-5 py-4 shadow-sm flex items-center gap-3">
              <Upload className="w-5 h-5 text-[#C89B3C]" />
              <span className="text-[13.5px] font-medium text-[#071A34]">
                Solte imagens ou arquivos para anexar à conversa
              </span>
            </div>
          </div>
        )}

        {/* Faixa superior limpa da conversa (mesmo fundo, sem barra separada) */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <h2 className="text-[16px] font-semibold text-[#071A34] truncate">
              {activeConv.title}
            </h2>
            <span className="text-[11.5px] px-2.5 py-0.5 rounded-full bg-white border border-[#E4EAF1] text-[#5A6B82]">
              {activeClient.company}
            </span>
            {activeProduct && (
              <span className="text-[11.5px] px-2.5 py-0.5 rounded-full bg-[#071A34]/6 text-[#071A34] font-medium">
                {activeProduct.name} · {activeProduct.dimensions}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setDrawerOpen((v) => !v)}
            className={`h-8 px-3 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors ${
              drawerOpen
                ? 'bg-[#071A34] text-white'
                : 'bg-white border border-[#E4EAF1] text-[#0F1E36] hover:border-[#071A34]/30'
            }`}
            title="Abrir ou fechar painel do cliente, projetos e arquivos"
          >
            <PanelRight className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>Cliente e arquivos</span>
          </button>
        </div>

        {/* Fluxo central de mensagens */}
        <div className="flex-1 overflow-y-auto pr-1 pb-6 space-y-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {filteredMessages.map((msg) => {
              const isUser = msg.sender === 'user';
              const media = msg.media;
              const isSelected = Boolean(media && selectedMedia?.id === media.id);

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  {/* Texto da mensagem limpo, sem excesso de caixas */}
                  <div
                    className={`max-w-[85%] text-[13.5px] leading-relaxed ${
                      isUser
                        ? 'bg-[#071A34] text-white px-4 py-2.5 rounded-2xl rounded-br-sm'
                        : 'text-[#0F1E36] py-0.5'
                    }`}
                  >
                    {!isUser && (
                      <div className="flex items-center gap-1.5 mb-1">
                        <Sparkles className="w-3.5 h-3.5 text-[#C89B3C]" />
                        <span className="text-[11.5px] font-semibold text-[#071A34]">
                          BARUCH IA
                        </span>
                        <span className="text-[11px] text-slate-400">{msg.time}</span>
                      </div>
                    )}
                    <p>{msg.text}</p>
                    {isUser && (
                      <div className="text-[10.5px] text-slate-300 text-right mt-1">
                        {msg.time}
                      </div>
                    )}
                  </div>

                  {/* Barra de progresso real (ex.: vetorização no Web Worker) */}
                  {msg.progress && (
                    <div className="mt-2.5 w-full max-w-md bg-white border border-[#E4EAF1] rounded-lg px-3.5 py-2.5 space-y-1.5">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="inline-flex items-center gap-1.5 text-[#071A34] font-medium">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C89B3C]" />
                          {msg.progress.stage}
                        </span>
                        <span className="tabular-nums text-[#5A6B82]">
                          {msg.progress.percent}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-[#EEF2F7] overflow-hidden">
                        <div
                          className="h-full bg-[#071A34] transition-all duration-200"
                          style={{ width: `${Math.max(6, msg.progress.percent)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Anexos não-imagem */}
                  {msg.attachments && msg.attachments.some((a) => !a.isImage) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {msg.attachments
                        .filter((a) => !a.isImage)
                        .map((att) => (
                          <div
                            key={att.id}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-[#E4EAF1] text-[12px] text-[#0F1E36]"
                          >
                            <FileText className="w-3.5 h-3.5 text-[#071A34]" />
                            <span className="font-mono">{att.name}</span>
                            <span className="text-[#5A6B82]">{att.sizeLabel}</span>
                          </div>
                        ))}
                    </div>
                  )}

                  {/* Download de arquivo gerado (ex.: PDF) */}
                  {msg.fileDownload && (
                    <a
                      href={msg.fileDownload.blobUrl}
                      download={msg.fileDownload.fileName}
                      className="mt-2.5 inline-flex items-center gap-2.5 px-3.5 py-2 rounded-lg bg-white border border-[#E4EAF1] hover:border-[#071A34]/35 transition-colors text-[12.5px] text-[#071A34]"
                    >
                      <FileDown className="w-4 h-4 text-[#C89B3C]" />
                      <span className="font-mono font-medium">
                        {msg.fileDownload.fileName}
                      </span>
                      <span className="text-[11.5px] text-[#5A6B82]">
                        {msg.fileDownload.sizeLabel}
                      </span>
                      <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
                    </a>
                  )}

                  {/* Imagem gerada, anexada ou processada + Comparador + Ações contextuais */}
                  {media && (
                    <div
                      onClick={() => setSelectedMediaId(media.id)}
                      className="mt-3 w-full max-w-2xl"
                    >
                      {/* Cabeçalho sutil da mídia */}
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11.5px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-[#071A34] truncate">
                            {media.label}
                          </span>
                          {media.operationTag && (
                            <span className="px-2 py-0.5 rounded-full bg-[#071A34]/8 text-[#071A34] text-[10.5px] font-medium">
                              {media.operationTag}
                            </span>
                          )}
                          {media.approved && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10.5px] font-medium">
                              <CheckCircle2 className="w-3 h-3" />
                              Aprovada
                            </span>
                          )}
                        </div>
                        {media.resolutionLabel && (
                          <span className="text-[#5A6B82] font-mono text-[11px] shrink-0">
                            {media.resolutionLabel}
                          </span>
                        )}
                      </div>

                      {/* Visualização: Antes/Depois com slider horizontal OU imagem ampla */}
                      <div
                        className={`rounded-lg transition-all ${
                          isSelected
                            ? 'ring-2 ring-[#C89B3C]/65 ring-offset-2 ring-offset-[#F6F8FB]'
                            : ''
                        }`}
                      >
                        {media.beforeUrl ? (
                          <BeforeAfterSlider
                            beforeUrl={media.beforeUrl}
                            afterImageUrl={media.svgMarkup ? undefined : media.imageUrl}
                            afterSvgMarkup={media.svgMarkup}
                            beforeLabel="Antes"
                            afterLabel={media.svgMarkup ? 'Vetor SVG' : 'Depois'}
                          />
                        ) : (
                          <div className="rounded-lg overflow-hidden border border-[#E4EAF1] bg-white flex items-center justify-center max-h-[380px] cursor-pointer">
                            <img
                              src={media.imageUrl}
                              alt={media.label}
                              className="w-full max-h-[380px] object-contain bg-[#FAFBFD]"
                            />
                          </div>
                        )}
                      </div>

                      {/* Ações contextuais da imagem */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <ImageActionButton
                          label="Remover fundo"
                          icon={Eraser}
                          disabled={Boolean(busyTool)}
                          onClick={() => void runTool('remove_bg', media)}
                        />
                        <ImageActionButton
                          label="Vetorizar"
                          icon={Waypoints}
                          accent
                          disabled={Boolean(busyTool)}
                          onClick={() => void runTool('vectorize', media)}
                        />
                        <ImageActionButton
                          label="Melhorar"
                          icon={Sparkles}
                          disabled={Boolean(busyTool)}
                          onClick={() => void runTool('enhance', media)}
                        />
                        <ImageActionButton
                          label="Upscale"
                          icon={Maximize2}
                          disabled={Boolean(busyTool)}
                          onClick={() => void runTool('upscale', media)}
                        />
                        <ImageActionButton
                          label="Mockup"
                          icon={Layers}
                          disabled={Boolean(busyTool)}
                          onClick={() => void runTool('mockup', media)}
                        />
                        <ImageActionButton
                          label="Impressão"
                          icon={Printer}
                          disabled={Boolean(busyTool)}
                          onClick={() => void runTool('print_prep', media)}
                        />
                        <ImageActionButton
                          label={media.svgMarkup ? 'Exportar SVG' : `Exportar ${outputFormat}`}
                          icon={FileCode2}
                          disabled={Boolean(busyTool)}
                          onClick={() =>
                            void exportMediaAsFormat(
                              media.imageUrl,
                              media.fileName,
                              media.svgMarkup ? 'SVG' : outputFormat,
                              media.svgMarkup
                            )
                          }
                        />
                        <ImageActionButton
                          label="Baixar"
                          icon={Download}
                          onClick={() => {
                            if (media.svgMarkup) {
                              downloadVectorSvg(media.svgMarkup, media.fileName);
                            } else {
                              triggerDownload(media.imageUrl, media.fileName);
                            }
                          }}
                        />
                        <ImageActionButton
                          label={isSelected ? 'Referência ativa' : 'Usar referência'}
                          icon={Check}
                          active={isSelected}
                          onClick={() => setSelectedMediaId(media.id)}
                        />
                        <ImageActionButton
                          label={media.approved ? 'Aprovada' : 'Aprovar'}
                          icon={CheckCircle2}
                          active={Boolean(media.approved)}
                          onClick={() => toggleApproveMedia(media.id)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={endOfMessagesRef} />
          </div>
        </div>

        {/* Rodapé fixo da área central: Barra de ferramentas visível + Composer */}
        <div className="sticky bottom-0 pt-2 pb-1 bg-[#F6F8FB]">
          <div className="max-w-4xl mx-auto space-y-2">
            {/* Aviso discreto de status */}
            {statusNote && (
              <div className="text-[12px] text-[#071A34] bg-white border border-[#E4EAF1] rounded-lg px-3 py-1.5 flex items-center justify-between">
                <span>{statusNote}</span>
                <button
                  type="button"
                  onClick={() => setStatusNote(null)}
                  className="text-slate-400 hover:text-[#071A34]"
                  aria-label="Fechar aviso"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Barra de ferramentas completa e visível (todas as 14 opções solicitadas) */}
            <div className="flex flex-wrap items-center gap-1.5">
              <ToolChip
                icon={Eraser}
                label="Remover fundo"
                title="Remover o fundo da imagem selecionada com transparência"
                busy={busyTool === 'remove_bg'}
                disabled={Boolean(busyTool)}
                onClick={() => void runTool('remove_bg')}
              />
              <ToolChip
                icon={Waypoints}
                label="Vetorizar"
                title="Converter imagem em SVG 100% vetorial usando o motor BARUCH"
                highlight
                busy={busyTool === 'vectorize'}
                disabled={Boolean(busyTool)}
                onClick={() => void runTool('vectorize')}
              />
              <ToolChip
                icon={Sparkles}
                label="Melhorar qualidade"
                title="Aprimorar nitidez, contraste e definição da imagem"
                busy={busyTool === 'enhance'}
                disabled={Boolean(busyTool)}
                onClick={() => void runTool('enhance')}
              />
              <ToolChip
                icon={Maximize2}
                label="Upscale"
                title="Aumentar resolução da imagem selecionada"
                busy={busyTool === 'upscale'}
                disabled={Boolean(busyTool)}
                onClick={() => void runTool('upscale')}
              />

              {/* HD e 4K */}
              <button
                type="button"
                onClick={() => setResolution(resolution === 'HD' ? 'standard' : 'HD')}
                title="Definir resolução de saída HD (1920px)"
                className={`h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition-colors ${
                  resolution === 'HD'
                    ? 'bg-[#071A34] text-[#E3C16F]'
                    : 'bg-white border border-[#E4EAF1] text-[#5A6B82] hover:text-[#071A34]'
                }`}
              >
                HD
              </button>
              <button
                type="button"
                onClick={() => setResolution(resolution === '4K' ? 'standard' : '4K')}
                title="Definir resolução de saída 4K (3840px)"
                className={`h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition-colors ${
                  resolution === '4K'
                    ? 'bg-[#071A34] text-[#E3C16F]'
                    : 'bg-white border border-[#E4EAF1] text-[#5A6B82] hover:text-[#071A34]'
                }`}
              >
                4K
              </button>

              <ToolChip
                icon={SlidersHorizontal}
                label="Ajustar imagem"
                title="Ajustar brilho, cor e contraste da imagem selecionada"
                busy={busyTool === 'adjust'}
                disabled={Boolean(busyTool)}
                onClick={() => void runTool('adjust')}
              />
              <ToolChip
                icon={Layers}
                label="Gerar mockup"
                title="Aplicar a arte em um mockup visual do produto"
                busy={busyTool === 'mockup'}
                disabled={Boolean(busyTool)}
                onClick={() => void runTool('mockup')}
              />
              <ToolChip
                icon={Printer}
                label="Preparar para impressão"
                title="Adicionar sangria de 3 mm, área de segurança e marcas de corte"
                busy={busyTool === 'print_prep'}
                disabled={Boolean(busyTool)}
                onClick={() => void runTool('print_prep')}
              />
              <ToolChip
                icon={FileDown}
                label="Gerar PDF"
                title="Gerar e baixar arquivo PDF pronto para produção"
                busy={busyTool === 'generate_pdf'}
                disabled={Boolean(busyTool)}
                onClick={() => void runTool('generate_pdf')}
              />
              <ToolChip
                icon={FileCode2}
                label="Exportar SVG"
                title="Exportar o resultado vetorial em formato SVG editável"
                busy={busyTool === 'export_svg'}
                disabled={Boolean(busyTool)}
                onClick={() => void runTool('export_svg')}
              />

              {/* Selecionar produto */}
              <div className="inline-flex items-center gap-1 h-7 px-2 rounded-lg bg-white border border-[#E4EAF1] text-[11.5px] text-[#0F1E36]">
                <Package className="w-3.5 h-3.5 text-[#C89B3C] shrink-0" />
                <select
                  value={activeProduct?.id ?? ''}
                  onChange={(e) => handleProductSelect(e.target.value)}
                  aria-label="Selecionar produto"
                  title="Selecionar produto cadastrado para aplicar dimensões e template"
                  className="bg-transparent text-[11.5px] text-[#0F1E36] focus:outline-none max-w-[140px] truncate"
                >
                  <option value="">Produto...</option>
                  {PRODUCTS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.dimensions})
                    </option>
                  ))}
                </select>
              </div>

              {/* Selecionar proporção */}
              <div className="inline-flex items-center gap-1 h-7 px-2 rounded-lg bg-white border border-[#E4EAF1] text-[11.5px] text-[#0F1E36]">
                <Ratio className="w-3.5 h-3.5 text-[#5A6B82] shrink-0" />
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as AspectRatioOption)}
                  aria-label="Selecionar proporção"
                  title="Selecionar proporção da arte"
                  className="bg-transparent text-[11.5px] text-[#0F1E36] focus:outline-none"
                >
                  {ASPECT_RATIOS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Selecionar formato de saída */}
              <select
                value={outputFormat}
                onChange={(e) => setOutputFormat(e.target.value as OutputFormatOption)}
                aria-label="Selecionar formato de saída"
                title="Formato padrão de exportação"
                className="h-7 px-2 rounded-lg bg-white border border-[#E4EAF1] text-[11.5px] font-medium text-[#071A34] focus:outline-none"
              >
                {OUTPUT_FORMATS.map((fmt) => (
                  <option key={fmt} value={fmt}>
                    Saída: {fmt}
                  </option>
                ))}
              </select>
            </div>

            {/* Composer principal */}
            <div className="bg-white border border-[#DCE3EC] rounded-2xl shadow-[0_2px_10px_rgba(7,26,52,0.04)] p-3 space-y-2.5 focus-within:border-[#071A34]/40 transition-colors">
              {/* Pré-visualização de anexos e imagem de referência */}
              {(attachments.length > 0 || selectedMedia) && (
                <div className="flex flex-wrap items-center gap-2 pb-1">
                  {selectedMedia && attachments.length === 0 && (
                    <div className="inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-lg bg-[#F6F8FB] border border-[#E4EAF1] text-[11.5px]">
                      <img
                        src={selectedMedia.imageUrl}
                        alt={selectedMedia.label}
                        className="w-6 h-6 rounded object-cover"
                      />
                      <span className="text-[#5A6B82]">Referência:</span>
                      <span className="font-medium text-[#071A34] max-w-[180px] truncate">
                        {selectedMedia.label}
                      </span>
                    </div>
                  )}

                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className="inline-flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-lg bg-[#F6F8FB] border border-[#DCE3EC] text-[11.5px]"
                    >
                      {att.isImage ? (
                        <img
                          src={att.dataUrl}
                          alt={att.name}
                          className="w-7 h-7 rounded object-cover"
                        />
                      ) : (
                        <FileText className="w-4 h-4 text-[#071A34] ml-1" />
                      )}
                      <div className="leading-tight max-w-[160px]">
                        <div className="font-medium text-[#0F1E36] truncate">{att.name}</div>
                        <div className="text-[10px] text-[#5A6B82]">{att.sizeLabel}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAttachment(att.id)}
                        className="p-0.5 rounded text-slate-400 hover:text-rose-600"
                        aria-label={`Remover ${att.name}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Campo de texto */}
              <textarea
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendMessage(false);
                  }
                }}
                placeholder="Descreva a arte, peça ajustes, arraste uma imagem ou selecione uma ferramenta acima..."
                className="w-full resize-none bg-transparent text-[13.5px] text-[#0F1E36] placeholder:text-slate-400 focus:outline-none leading-relaxed px-1"
              />

              {/* Barra inferior do composer */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf,.svg"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) {
                        void ingestFiles(e.target.files);
                      }
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-8 px-2.5 rounded-md border border-[#E4EAF1] bg-[#FAFBFD] text-[#334155] hover:text-[#071A34] hover:bg-[#F1F5F9] text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors"
                    title="Anexar imagens ou arquivos (PNG, JPG, WebP, SVG, PDF)"
                  >
                    <Paperclip className="w-3.5 h-3.5" strokeWidth={1.75} />
                    <span>Anexar</span>
                  </button>

                  {/* Perfil de IA / Vetorização (reaproveita VECTORIZER_PROFILES) */}
                  <select
                    value={modelProfile}
                    onChange={(e) => setModelProfile(e.target.value as ChatModelProfile)}
                    aria-label="Perfil de IA e vetorização"
                    title="Perfil do motor de vetorização e criação"
                    className="h-8 px-2.5 rounded-lg border border-[#E4EAF1] bg-[#FAFBFD] text-[12px] text-[#334155] focus:outline-none focus:border-[#071A34]/35"
                  >
                    {VECTORIZER_PROFILES.map((prof) => (
                      <option key={prof.id} value={prof.id}>
                        Perfil: {prof.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={Boolean(busyTool)}
                    onClick={() => void handleSendMessage(true)}
                    className="h-8 px-3 rounded-md border border-[#DCE3EC] bg-white text-[#071A34] hover:bg-[#F6F8FB] text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    title="Gerar arte com o produto, proporção e resolução selecionados"
                  >
                    <Wand2 className="w-3.5 h-3.5 text-[#C89B3C]" />
                    <span>Gerar</span>
                  </button>

                  <button
                    type="button"
                    disabled={Boolean(busyTool) || (!prompt.trim() && attachments.length === 0)}
                    onClick={() => void handleSendMessage(false)}
                    className="h-8 px-3.5 rounded-md bg-[#071A34] text-white hover:bg-[#0D284D] text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-40"
                  >
                    {busyTool ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E3C16F]" />
                    ) : (
                      <Send className="w-3.5 h-3.5 text-[#E3C16F]" />
                    )}
                    <span>Enviar</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Gaveta lateral direita opcional (abre e fecha sem duplicar sidebar) */}
      <ClientDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        client={activeClient}
        onChangeClient={handleChangeClient}
        conversations={conversations}
        activeConversationId={activeConv.id}
        onSelectConversation={(id) => {
          setActiveConvId(id);
          setSelectedMediaId(null);
        }}
        onNewConversation={handleNewConversation}
        mediaItems={conversationMedia}
        onSelectMediaAsRef={(media) => setSelectedMediaId(media.id)}
      />
    </div>
  );
}

function ToolChip({
  icon: Icon,
  label,
  title,
  highlight = false,
  busy = false,
  disabled = false,
  onClick,
}: {
  icon: typeof Sparkles;
  label: string;
  title: string;
  highlight?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-7 px-2.5 rounded-md text-[11.5px] font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
        highlight
          ? 'bg-[#071A34] text-white hover:bg-[#0D284D]'
          : 'bg-white border border-[#E4EAF1] text-[#334155] hover:text-[#071A34] hover:border-[#071A34]/30'
      }`}
    >
      {busy ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E3C16F]" />
      ) : (
        <Icon
          className={`w-3.5 h-3.5 ${highlight ? 'text-[#E3C16F]' : 'text-[#5A6B82]'}`}
          strokeWidth={1.75}
        />
      )}
      <span>{label}</span>
    </button>
  );
}

function ImageActionButton({
  icon: Icon,
  label,
  accent = false,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: typeof Sparkles;
  label: string;
  accent?: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`h-7 px-2.5 rounded-md text-[11.5px] font-medium inline-flex items-center gap-1 transition-colors disabled:opacity-50 ${
        active
          ? 'bg-[#071A34]/10 text-[#071A34] border border-[#071A34]/25'
          : accent
            ? 'bg-[#071A34] text-white hover:bg-[#0D284D]'
            : 'bg-white border border-[#E4EAF1] text-[#334155] hover:text-[#071A34] hover:border-[#071A34]/30'
      }`}
    >
      <Icon
        className={`w-3 h-3 ${accent ? 'text-[#E3C16F]' : 'text-[#5A6B82]'}`}
        strokeWidth={1.75}
      />
      <span>{label}</span>
    </button>
  );
}
