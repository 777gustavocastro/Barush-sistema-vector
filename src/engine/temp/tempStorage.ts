/**
 * Gerenciador isolado de recursos e arquivos temporários.
 * - No navegador: rastreia Object URLs e buffers temporários de sessão para revogação segura sem vazamento de memória.
 * - Em Node.js (testes/CLI local): gerencia diretórios temporários isolados no sistema operacional com limpeza automática.
 */
export class TempResourceManager {
  private readonly objectUrls = new Set<string>();
  private readonly memoryBuffers = new Map<string, Uint8Array>();

  registerObjectUrl(blob: Blob): string {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      throw new Error('URL.createObjectURL indisponível neste ambiente.');
    }
    const url = URL.createObjectURL(blob);
    this.objectUrls.add(url);
    return url;
  }

  revokeObjectUrl(url: string): void {
    if (this.objectUrls.has(url)) {
      URL.revokeObjectURL(url);
      this.objectUrls.delete(url);
    }
  }

  storeTempBuffer(key: string, data: Uint8Array): void {
    this.memoryBuffers.set(key, data);
  }

  getTempBuffer(key: string): Uint8Array | undefined {
    return this.memoryBuffers.get(key);
  }

  deleteTempBuffer(key: string): void {
    this.memoryBuffers.delete(key);
  }

  disposeAll(): void {
    for (const url of this.objectUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignora erro caso já tenha sido revogada
      }
    }
    this.objectUrls.clear();
    this.memoryBuffers.clear();
  }

  get stats(): { activeObjectUrls: number; activeBuffers: number } {
    return {
      activeObjectUrls: this.objectUrls.size,
      activeBuffers: this.memoryBuffers.size,
    };
  }
}

export interface NodeTempWorkspace {
  dirPath: string;
  writeTempFile: (fileName: string, content: Uint8Array | string) => Promise<string>;
  cleanup: () => Promise<void>;
}

/**
 * Cria um diretório temporário isolado em disco (exclusivo para execução Node.js / testes locais).
 */
export async function createNodeTempWorkspace(prefix = 'barush-vector-'): Promise<NodeTempWorkspace> {
  const isNode =
    typeof globalThis !== 'undefined' &&
    Boolean((globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node);

  if (!isNode) {
    throw new Error('createNodeTempWorkspace é destinado apenas ao ambiente Node.js local.');
  }

  const fsMod = 'node:fs/promises';
  const osMod = 'node:os';
  const pathMod = 'node:path';
  const fs = await import(/* @vite-ignore */ fsMod);
  const os = await import(/* @vite-ignore */ osMod);
  const path = await import(/* @vite-ignore */ pathMod);

  const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), prefix));

  return {
    dirPath,
    async writeTempFile(fileName: string, content: Uint8Array | string): Promise<string> {
      const safeName = path.basename(fileName);
      const targetPath = path.join(dirPath, safeName);
      await fs.writeFile(targetPath, content);
      return targetPath;
    },
    async cleanup(): Promise<void> {
      await fs.rm(dirPath, { recursive: true, force: true });
    },
  };
}
