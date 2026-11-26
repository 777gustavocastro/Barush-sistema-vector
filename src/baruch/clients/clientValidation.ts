import type { ClientFieldErrors, ClientProfile } from './clientTypes';

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function validateClient(client: ClientProfile, others: ClientProfile[]): ClientFieldErrors {
  const errors: ClientFieldErrors = {};
  if (client.kind === 'pf' && !client.name.trim()) errors.name = 'Informe o nome.';
  if (client.kind === 'pj' && !client.company.trim()) errors.company = 'Informe a razão social.';
  if (client.kind === 'pf' && !client.company.trim()) {
    // pessoa física usa o nome como identificação principal
  }
  const email = client.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'E-mail inválido.';
  const digits = digitsOnly(client.document);
  if (digits) {
    const expected = client.kind === 'pf' ? 11 : 14;
    if (digits.length !== expected) {
      errors.document = client.kind === 'pf' ? 'O CPF precisa ter 11 dígitos.' : 'O CNPJ precisa ter 14 dígitos.';
    } else if (others.some((item) => item.id !== client.id && digitsOnly(item.document) === digits)) {
      errors.document = 'Já existe um cliente com este documento.';
    }
  }
  return errors;
}

export function hasClientErrors(errors: ClientFieldErrors): boolean {
  return Boolean(errors.name || errors.company || errors.document || errors.email);
}

export function displayName(client: ClientProfile): string {
  if (client.kind === 'pj') return client.company.trim() || client.name.trim();
  return client.name.trim() || client.company.trim();
}

export function initialsOf(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || 'CL';
}
