type CacheWindow = Window & {
  __workshopCacheRegistration?: Promise<unknown>;
  __workshopCacheFailure?: Promise<unknown>;
};

/**
 * Give the static cache a short, bounded chance to claim the first page.
 * Registration failure or an unsupported browser resolves immediately; a
 * stalled activation falls through after the timeout instead of blocking open.
 */
export function waitForWorkshopCache(timeoutMs = 800): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve();
  if (typeof window === 'undefined') return Promise.resolve();
  const cacheWindow = window as CacheWindow;
  if (!cacheWindow.__workshopCacheRegistration && !cacheWindow.__workshopCacheFailure)
    return Promise.resolve();
  const failure = cacheWindow.__workshopCacheFailure;
  let listener: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    const check = () => {
      if (navigator.serviceWorker.controller?.scriptURL.endsWith('/workshop-cache-worker.js')) resolve();
    };
    listener = check;
    navigator.serviceWorker.addEventListener('controllerchange', check);
    check();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  const pending = failure ? [ready, failure, timeout] : [ready, timeout];
  return Promise.race(pending).then(
    () => {
      clearTimeout(timer);
      if (listener) navigator.serviceWorker.removeEventListener('controllerchange', listener);
    },
    () => {
      clearTimeout(timer);
      if (listener) navigator.serviceWorker.removeEventListener('controllerchange', listener);
    },
  );
}
