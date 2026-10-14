export const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export const createId = (): string => crypto.randomUUID();

export function formatRelativeTime(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (elapsed < 60_000) return "방금 전";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}분 전`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}시간 전`;
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(
    new Date(iso),
  );
}

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
