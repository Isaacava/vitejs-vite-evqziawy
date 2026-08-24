import { useEffect, useState } from "react";

type ActivityEvent = { id: string; title: string; description: string | null; created_at: string };

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

  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8 font-body text-ink">
      <div className="mb-4 flex items-center justify-between gap-4">
        <span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Activity / Audit trail</span>
        <b className="shrink-0 font-mono text-[10.5px] text-inksoft">{events.length} EVENTS</b>
      </div>
      {error && <div className="mb-4 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[12px] text-rust">{error}</div>}
      <section className="card-asym border border-line bg-paperhi p-[18px]">
        {events.map((event, index) => (
          <div key={event.id} className={`grid min-w-0 grid-cols-1 gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4 ${index < events.length - 1 ? "border-b border-linesoft" : ""}`}>
            <div className="min-w-0">
              <strong className="block text-[12.5px] font-bold">{event.title}</strong>
              <p className="my-0.5 mb-1.5 text-[10.5px] text-inksoft">{event.description || "AgentMarket event"}</p>
              <i className="block h-[3px] overflow-hidden rounded-full bg-linesoft"><u className="bar-fill block h-full rounded-full" style={{ width: `${Math.max(20, 100 - index * 15)}%` }} /></i>
            </div>
            <small className="font-mono text-[9.5px] text-[#9aa3b1] sm:whitespace-nowrap">{new Date(event.created_at).toLocaleString()}</small>
          </div>
        ))}
        {!events.length && !error && <div className="py-8 text-[12px] text-inksoft">No activity records yet.</div>}
      </section>
    </main>
  );
}
