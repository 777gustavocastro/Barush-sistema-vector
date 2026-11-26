import type { Options as VTracerOptions } from '@visioncortex/vtracer';

interface VTracerBinding {
  convertPixels: (rgba: Uint8Array, width: number, height: number, options?: VTracerOptions) => string;
  convertBuffer: (encodedBytes: Uint8Array, options?: VTracerOptions) => string;
}

interface RawWasmExports {
  memory: WebAssembly.Memory;
  __wbindgen_start: () => void;
  __wbindgen_malloc: (size: number, align: number) => number;
  __wbindgen_realloc: (ptr: number, oldSize: number, newSize: number, align: number) => number;
  __wbindgen_free: (ptr: number, size: number, align: number) => void;
  __wbindgen_externrefs: WebAssembly.Table;
  __externref_table_alloc: () => number;
  __externref_table_dealloc: (idx: number) => void;
  __wbindgen_exn_store: (idx: number) => void;
  vectorize_bytes: (ptr: number, len: number, options: unknown) => [number, number, number, number];
  vectorize_rgba: (
    ptr: number,
    len: number,
    width: number,
    height: number,
    options: unknown
  ) => [number, number, number, number];
}

let cachedBindingPromise: Promise<VTracerBinding> | null = null;

function isNodeRuntime(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    Boolean((globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node) &&
    typeof window === 'undefined'
  );
}

/**
 * Instancia o binário WebAssembly oficial do @visioncortex/vtracer diretamente a partir de seus bytes
 * usando os imports do wasm-bindgen (sem dependência de node:fs), pronto para Navegador e Web Worker.
 */
export async function instantiateVTracerFromWasmBytes(wasmBytes: BufferSource): Promise<VTracerBinding> {
  let wasm!: RawWasmExports;
  let wasmVectorLen = 0;
  let cachedDataView: DataView | null = null;
  let cachedUint8: Uint8Array | null = null;

  const textDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
  textDecoder.decode();
  const textEncoder = new TextEncoder();

  const getUint8Memory = (): Uint8Array => {
    if (!cachedUint8 || cachedUint8.byteLength === 0) {
      cachedUint8 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8;
  };

  const getDataViewMemory = (): DataView => {
    if (!cachedDataView || cachedDataView.buffer !== wasm.memory.buffer) {
      cachedDataView = new DataView(wasm.memory.buffer);
    }
    return cachedDataView;
  };

  const getStringFromWasm = (ptr: number, len: number): string =>
    textDecoder.decode(getUint8Memory().subarray(ptr >>> 0, (ptr >>> 0) + len));

  const passArray8ToWasm = (arg: Uint8Array): number => {
    const ptr = wasm.__wbindgen_malloc(arg.length, 1) >>> 0;
    getUint8Memory().set(arg, ptr);
    wasmVectorLen = arg.length;
    return ptr;
  };

  const passStringToWasm = (arg: string): number => {
    const buf = textEncoder.encode(arg);
    const ptr = wasm.__wbindgen_malloc(buf.length, 1) >>> 0;
    getUint8Memory().subarray(ptr, ptr + buf.length).set(buf);
    wasmVectorLen = buf.length;
    return ptr;
  };

  const isLikeNone = (val: unknown): val is null | undefined => val === undefined || val === null;

  const addToExternrefTable = (obj: unknown): number => {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
  };

  const takeFromExternrefTable = (idx: number): unknown => {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
  };

  const handleError = <T>(fn: (...fnArgs: unknown[]) => T, args: IArguments | unknown[]): T | undefined => {
    try {
      return fn(...Array.from(args));
    } catch (err) {
      const idx = addToExternrefTable(err);
      wasm.__wbindgen_exn_store(idx);
      return undefined;
    }
  };

  const importBg: Record<string, WebAssembly.ImportValue> = {
    __wbg_Error_92b29b0548f8b746: (arg0: number, arg1: number) => new Error(getStringFromWasm(arg0, arg1)),
    __wbg_Number_9a4e0ecb0fa16705: (arg0: unknown) => Number(arg0),
    __wbg_String_8564e559799eccda: (arg0: number, arg1: unknown) => {
      const ptr = passStringToWasm(String(arg1));
      const dv = getDataViewMemory();
      dv.setInt32(arg0 + 4, wasmVectorLen, true);
      dv.setInt32(arg0, ptr, true);
    },
    __wbg___wbindgen_bigint_get_as_i64_d968e41184ae354f: (arg0: number, arg1: unknown) => {
      const ret = typeof arg1 === 'bigint' ? arg1 : undefined;
      const dv = getDataViewMemory();
      dv.setBigInt64(arg0 + 8, isLikeNone(ret) ? BigInt(0) : ret, true);
      dv.setInt32(arg0, Number(!isLikeNone(ret)), true);
    },
    __wbg___wbindgen_boolean_get_fa956cfa2d1bd751: (arg0: unknown) => {
      const ret = typeof arg0 === 'boolean' ? arg0 : undefined;
      return isLikeNone(ret) ? 0xffffff : ret ? 1 : 0;
    },
    __wbg___wbindgen_debug_string_c25d447a39f5578f: (arg0: number, arg1: unknown) => {
      const ptr = passStringToWasm(String(arg1));
      const dv = getDataViewMemory();
      dv.setInt32(arg0 + 4, wasmVectorLen, true);
      dv.setInt32(arg0, ptr, true);
    },
    __wbg___wbindgen_in_aca499c5de7ff5e5: (arg0: PropertyKey, arg1: object) => arg0 in arg1,
    __wbg___wbindgen_is_bigint_2f76dc55065b4273: (arg0: unknown) => typeof arg0 === 'bigint',
    __wbg___wbindgen_is_function_1ff95bcc5517c252: (arg0: unknown) => typeof arg0 === 'function',
    __wbg___wbindgen_is_null_ea9085d691f535d3: (arg0: unknown) => arg0 === null,
    __wbg___wbindgen_is_object_a27215656b807791: (arg0: unknown) => typeof arg0 === 'object' && arg0 !== null,
    __wbg___wbindgen_is_undefined_c05833b95a3cf397: (arg0: unknown) => arg0 === undefined,
    __wbg___wbindgen_jsval_eq_e659fcf7b0e32763: (arg0: unknown, arg1: unknown) => arg0 === arg1,
    __wbg___wbindgen_jsval_loose_eq_db4c3b15f63fc170: (arg0: unknown, arg1: unknown) => arg0 == arg1,
    __wbg___wbindgen_number_get_394265ed1e1b84ee: (arg0: number, arg1: unknown) => {
      const ret = typeof arg1 === 'number' ? arg1 : undefined;
      const dv = getDataViewMemory();
      dv.setFloat64(arg0 + 8, isLikeNone(ret) ? 0 : ret, true);
      dv.setInt32(arg0, Number(!isLikeNone(ret)), true);
    },
    __wbg___wbindgen_string_get_b0ca35b86a603356: (arg0: number, arg1: unknown) => {
      const ret = typeof arg1 === 'string' ? arg1 : undefined;
      const ptr = isLikeNone(ret) ? 0 : passStringToWasm(ret);
      const len = isLikeNone(ret) ? 0 : wasmVectorLen;
      const dv = getDataViewMemory();
      dv.setInt32(arg0 + 4, len, true);
      dv.setInt32(arg0, ptr, true);
    },
    __wbg___wbindgen_throw_344f42d3211c4765: (arg0: number, arg1: number) => {
      throw new Error(getStringFromWasm(arg0, arg1));
    },
    __wbg_call_8a2dd23819f8a60a: (...args: unknown[]) =>
      handleError((fn, ctx) => (fn as Function).call(ctx), args),
    __wbg_done_89b2b13e91a60321: (arg0: IteratorResult<unknown>) => Boolean(arg0.done),
    __wbg_get_c7eb1f358a7654df: (...args: unknown[]) =>
      handleError((target, key) => Reflect.get(target as object, key as PropertyKey), args),
    __wbg_get_unchecked_6e0ad6d2a41b06f6: (arg0: unknown[], arg1: number) => arg0[arg1 >>> 0],
    __wbg_get_with_ref_key_6412cf3094599694: (arg0: Record<string, unknown>, arg1: string) => arg0[arg1],
    __wbg_instanceof_ArrayBuffer_4480b9e0068a8adb: (arg0: unknown) => arg0 instanceof ArrayBuffer,
    __wbg_instanceof_Uint8Array_309b927aaf7a3fc7: (arg0: unknown) => arg0 instanceof Uint8Array,
    __wbg_isArray_0677c962b281d01a: (arg0: unknown) => Array.isArray(arg0),
    __wbg_isSafeInteger_04f36e4056f1b851: (arg0: unknown) => Number.isSafeInteger(arg0),
    __wbg_iterator_6f722e4a93058b71: () => Symbol.iterator,
    __wbg_length_1f0964f4a5e2c6d8: (arg0: { length: number }) => arg0.length,
    __wbg_length_370319915dc99107: (arg0: { length: number }) => arg0.length,
    __wbg_new_cd45aabdf6073e84: (arg0: ArrayBufferLike) => new Uint8Array(arg0),
    __wbg_next_6dbf2c0ac8cde20f: (arg0: Iterator<unknown>) => arg0.next,
    __wbg_next_71f2aa1cb3d1e37e: (...args: unknown[]) =>
      handleError((iter) => (iter as Iterator<unknown>).next(), args),
    __wbg_prototypesetcall_4770620bbe4688a0: (ptr: number, len: number, src: ArrayLike<number>) => {
      getUint8Memory().subarray(ptr >>> 0, (ptr >>> 0) + len).set(src);
    },
    __wbg_value_a5d5488a9589444a: (arg0: IteratorResult<unknown>) => arg0.value,
    __wbindgen_cast_0000000000000001: (arg0: number, arg1: number) => getStringFromWasm(arg0, arg1),
    __wbindgen_cast_0000000000000002: (arg0: bigint) => BigInt.asUintN(64, arg0),
    __wbindgen_init_externref_table: () => {
      const table = wasm.__wbindgen_externrefs;
      const offset = table.grow(4);
      table.set(0, undefined);
      table.set(offset, undefined);
      table.set(offset + 1, null);
      table.set(offset + 2, true);
      table.set(offset + 3, false);
    },
  };

  const instantiated = await WebAssembly.instantiate(wasmBytes, {
    './vtracer_wasm_bg.js': importBg,
  });

  wasm = instantiated.instance.exports as unknown as RawWasmExports;
  wasm.__wbindgen_start();

  return {
    convertBuffer(encodedBytes: Uint8Array, options: VTracerOptions = {}): string {
      let outPtr = 0;
      let outLen = 0;
      try {
        const ptr = passArray8ToWasm(encodedBytes);
        const len = wasmVectorLen;
        const ret = wasm.vectorize_bytes(ptr, len, options);
        outPtr = ret[0];
        outLen = ret[1];
        if (ret[3]) {
          outPtr = 0;
          outLen = 0;
          throw takeFromExternrefTable(ret[2]);
        }
        return getStringFromWasm(outPtr, outLen);
      } finally {
        if (outLen > 0) {
          wasm.__wbindgen_free(outPtr, outLen, 1);
        }
      }
    },
    convertPixels(rgba: Uint8Array, width: number, height: number, options: VTracerOptions = {}): string {
      let outPtr = 0;
      let outLen = 0;
      try {
        const ptr = passArray8ToWasm(rgba);
        const len = wasmVectorLen;
        const ret = wasm.vectorize_rgba(ptr, len, width, height, options);
        outPtr = ret[0];
        outLen = ret[1];
        if (ret[3]) {
          outPtr = 0;
          outLen = 0;
          throw takeFromExternrefTable(ret[2]);
        }
        return getStringFromWasm(outPtr, outLen);
      } finally {
        if (outLen > 0) {
          wasm.__wbindgen_free(outPtr, outLen, 1);
        }
      }
    },
  };
}

export async function getVTracerBinding(): Promise<VTracerBinding> {
  if (!cachedBindingPromise) {
    cachedBindingPromise = (async () => {
      if (isNodeRuntime()) {
        const modName = 'node:module';
        const nodeModule = await import(/* @vite-ignore */ modName);
        const req = nodeModule.createRequire(import.meta.url);
        return req('@visioncortex/vtracer') as VTracerBinding;
      }
      const wasmAssetModule = await import('@visioncortex/vtracer/pkg/vtracer_wasm_bg.wasm?url');
      const response = await fetch(wasmAssetModule.default);
      const wasmBytes = await response.arrayBuffer();
      return instantiateVTracerFromWasmBytes(wasmBytes);
    })();
  }
  return cachedBindingPromise;
}
