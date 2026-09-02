import { useEffect, useMemo, useState } from "react";

type ActivityEvent = { id: string; title: string; description: string | null; created_at: string };

function iconFor(title: string) {
  const value = title.toLowerCase();
  if (value.includes("settled") || value.includes("confirmed") || value.includes("completed")) return { glyph: "✓", tone: "green" };
  if (value.includes("dispute") || value.includes("reject") || value.includes("refund")) return { glyph: "!", tone: "rust" };
  if (value.includes("swap") || value.includes("execution") || value.includes("fund")) return { glyph: "→", tone: "brass" };
  return { glyph: "•", tone: "brass" };
}

function humanEventTitle(title: string) {
  return title.replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanDescription(event: ActivityEvent) {
  if (event.description) return event.description;
  const title = event.title.toLowerCase();
  if (title.includes("fund")) return "Payment has been reserved for this mission.";
  if (title.includes("submit")) return "The agent sent its work for review.";
  if (title.includes("complete") || title.includes("settle")) return "This mission has finished successfully.";
  if (title.includes("reject")) return "This mission could not continue.";
  return "A change was recorded in your workspace.";
}

export default function DemoActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/dashboard", { credentials: "include" });
        const body = await response.json();
        if (!response.ok) throw new Error("Unable to load activity");
        setEvents(Array.isArray(body.activity) ? body.activity : []);
      } catch {
        setError(true);
      }
    })();
  }, []);

  const orderedEvents = useMemo(() => [...events].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [events]);

  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8 font-body text-ink">
      <header className="mb-7 border-b border-dashed border-[#c8c0af] pb-5">
        <span className="am-kicker">Activity / What changed</span>
        <h1 className="mt-2 font-display text-[31px] font-bold tracking-tight md:text-[40px]">A simple history of your work.</h1>
        <p className="mt-2 max-w-[600px] text-[12.5px] leading-relaxed text-inksoft">Every important change is collected here so you can understand what happened without reading the underlying system logs.</p>
      </header>

      {error && <div className="mb-5 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[12px] text-rust"><strong>We couldn't load your activity.</strong> Refresh the page and try again.</div>}

      <section className="card-asym border border-line bg-paperhi p-[18px]">
        <div className="mb-1 flex items-center justify-between border-b border-dashed border-line pb-3">
          <span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Recent changes</span>
          <b className="font-mono text-[9.5px] uppercase tracking-wide text-inksoft">{orderedEvents.length} records</b>
        </div>
        {orderedEvents.map((event, index) => {
          const meta = iconFor(event.title);
          return (
            <div key={event.id} className={`flex gap-3 py-4 ${index < orderedEvents.length - 1 ? "border-b border-linesoft" : ""}`}>
              <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px_6px_10px_7px] ${meta.tone === "green" ? "bg-greensoft text-green" : meta.tone === "rust" ? "bg-rustsoft text-rust" : "bg-brasssoft text-brass"} text-[11px] font-bold`}>{meta.glyph}</div>
              <div className="min-w-0 flex-1">
                <strong className="block text-[12.5px] font-bold">{humanEventTitle(event.title)}</strong>
                <p className="my-1 text-[10.5px] leading-relaxed text-inksoft">{humanDescription(event)}</p>
                <small className="font-mono text-[9.5px] text-[#8a8477]">{new Date(event.created_at).toLocaleString()}</small>
              </div>
              <span className={`hidden shrink-0 self-center font-mono text-[8.5px] uppercase tracking-wide sm:block ${meta.tone === "green" ? "text-green" : meta.tone === "rust" ? "text-rust" : "text-[#8a8477]"}`}>{meta.tone === "green" ? "done" : meta.tone === "rust" ? "attention" : "recorded"}</span>
            </div>
          );
        })}
        {!orderedEvents.length && !error && <div className="py-12 text-center"><strong className="font-display text-[21px]">Nothing has happened yet.</strong><p className="mt-2 text-[12px] text-inksoft">Once you create or run a mission, its important changes will appear here.</p></div>}
      </section>
    </main>
  );
}
