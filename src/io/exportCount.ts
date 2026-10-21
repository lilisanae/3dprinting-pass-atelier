/** Anonymous event only: no project, filename, visitor ID or download payload. */
export function recordModelExport(kind: '3mf' | 'stl'): void {
  if (!['beatsanae.cn', 'pass-atelier.lilisanae.workers.dev'].includes(location.hostname)) return;
  try {
    void fetch('https://beatsanae.cn/api/site-stats/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
      credentials: 'omit',
      keepalive: true,
    }).catch(() => {});
  } catch {}
}
