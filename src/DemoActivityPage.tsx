import { useEffect, useMemo, useState } from "react";

type ActivityEvent = { id: string; title: string; description: string | null; created_at: string };

function iconFor(title: string) {
  const value = title.toLowerCase();
  if (value.includes("settled") || value.includes("confirmed") || value.includes("completed")) return { glyph: "✓", tone: "green" };
  if (value.includes("dispute") || value.includes("reject") || value.includes("refund")) return { glyph: "⚑", tone: "rust" };
  if (value.includes("swap") || value.includes("execution") || value.includes("fund")) return { glyph: "⇄", tone: "brass" };
  return { glyph: "◈", tone: "brass" };
}

export default function DemoActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/dashboard", { credentials: "include" });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || "Unable to load activity");
        setEvents(Array.isArray(body.activity) ? body.activity : []);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to load activity");
      }
    })();
  }, []);

  const orderedEvents = useMemo(() => [...events].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [events]);

  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8 font-body text-ink">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Activity / Audit trail</span>
          <h1 className="mt-2 font-display text-[28px] font-bold tracking-tight">What changed, and when.</h1>
        </div>
        <b className="shrink-0 font-mono text-[10.5px] text-inksoft">{orderedEvents.length} EVENTS</b>
      </div>
      {error && <div className="mb-4 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[12px] text-rust">{error}</div>}
      <section className="card-asym border border-line bg-paperhi p-[18px]">
        {orderedEvents.map((event, index) => {
          const meta = iconFor(event.title);
          return (
            <div key={event.id} className={`flex gap-3 py-3.5 ${index < orderedEvents.length - 1 ? "border-b border-linesoft" : ""}`}>
              <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${meta.tone === "green" ? "bg-greensoft text-green" : meta.tone === "rust" ? "bg-rustsoft text-rust" : "bg-brasssoft text-brass"} text-[11px]`}>{meta.glyph}</div>
              <div className="min-w-0 flex-1">
                <strong className="block text-[12.5px] font-bold">{event.title}</strong>
                <p className="my-0.5 text-[10.5px] text-inksoft">{event.description || "AgentMarket event"}</p>
                <small className="font-mono text-[9.5px] text-[#9aa3b1]">{new Date(event.created_at).toLocaleString()}</small>
              </div>
              <span className="hidden shrink-0 self-center font-mono text-[8.5px] uppercase tracking-wide text-[#9aa3b1] sm:block">{meta.tone === "green" ? "verified" : meta.tone === "rust" ? "attention" : "recorded"}</span>
            </div>
          );
        })}
        {!orderedEvents.length && !error && <div className="py-8 text-[12px] text-inksoft">No activity records yet.</div>}
      </section>
    </main>
  );
}
