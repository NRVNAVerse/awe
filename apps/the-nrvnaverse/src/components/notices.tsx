import type { AppNotice } from "@/lib/app-state";

/** Non-fatal application notices (unknown destination, dropped parameters, …). */
export function Notices({ notices }: { notices: AppNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" aria-label="notices">
      {notices.map((notice, i) => (
        <li key={`${notice.code}-${i}`} className="rounded border border-amber-700 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
          <code className="mr-2 text-xs text-amber-400">{notice.code}</code>
          {notice.message}
        </li>
      ))}
    </ul>
  );
}
