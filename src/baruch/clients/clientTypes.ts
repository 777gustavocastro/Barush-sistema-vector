export type ClientKind = 'pf' | 'pj';
export type ClientLifecycle = 'ativo' | 'arquivado';

export interface ClientAvatar {
  id: string;
  dataUrl: string;
}

export interface ClientProfile {
  id: string;
  kind: ClientKind;
  name: string;
  company: string;
  document: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  city: string;
  avatar: ClientAvatar | null;
  initials: string;
  accentColor: string;
  notes: string;
  extra: string;
  status: ClientLifecycle;
  createdAt: string;
  updatedAt: string;
}

export interface ClientActivity {
  clientId: string;
  conversationId: string;
  updatedAt: string;
  preview: string;
  arts: Array<{
    id: string;
    name: string;
    format: string;
  }>;
}

export interface ClientFieldErrors {
  name?: string;
  company?: string;
  document?: string;
  email?: string;
}
