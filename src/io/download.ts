export type DownloadSource = 'cache' | 'network';
export type DownloadProgress = { loaded: number; total: number; source?: DownloadSource };

/** A slow but progressing transfer is allowed; stalled transfers fail cleanly. */
export async function downloadBuffer(url: string, label: string, expected = 0,
  progress?: (p: DownloadProgress) => void, retry = false): Promise<ArrayBuffer> {
  const controller = new AbortController();
  let idle: ReturnType<typeof setTimeout>;
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(), 30000);
  };
  const deadline = setTimeout(() => controller.abort(), 180000);
  touch();
  let source: DownloadSource = 'network';
  try {
    const response = await fetch(url, { signal: controller.signal, ...(retry ? { cache: 'reload' as const } : {}) });
    if (!response.ok) throw new Error(`${label}读取失败（${response.status}），请重试。`);
    // The workshop service worker marks Cache Storage hits explicitly; a normal
    // network/HTTP-cache response is still reported as a network read.
    source = response.headers.get('x-workshop-cache') === 'hit' ? 'cache' : 'network';
    const total = Number(response.headers.get('Content-Length')) || expected;
    progress?.({ loaded: 0, total, source });
    if (!response.body) {
      const buffer = await response.arrayBuffer();
      progress?.({ loaded: buffer.byteLength, total: buffer.byteLength, source });
      return buffer;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        chunks.push(result.value);
        loaded += result.value.byteLength;
        touch();
        progress?.({ loaded, total: Math.max(total, loaded), source });
      }
    } finally { reader.releaseLock(); }
    const output = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    progress?.({ loaded, total: loaded, source });
    return output.buffer;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${label}读取暂时中断，请点击重试。`);
    throw error;
  } finally { clearTimeout(idle!); clearTimeout(deadline); }
}
