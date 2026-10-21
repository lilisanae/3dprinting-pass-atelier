let pending: Promise<typeof import('../components/ThreePreview')> | undefined;

export async function previewDeadline<T>(promise: Promise<T>, milliseconds = 60000) {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('三维预览下载暂时没有响应，请重试。')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
export function loadPreview() {
  return (pending ??= previewDeadline(import('../components/ThreePreview')).catch((error) => {
    pending = undefined;
    throw error;
  }));
}
