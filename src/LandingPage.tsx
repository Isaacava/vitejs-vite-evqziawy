import { useEffect, useMemo, useState, type CSSProperties } from "react";
import "./landing.css";

const examples = [
  "Manage my BNB portfolio conservatively",
  "Find a safe yield strategy for idle assets",
  "Rebalance my portfolio with strict risk limits",
];

const signals = [
  ["Capability match", "96%"],
  ["Identity verified", "Yes"],
  ["Endpoint liveness", "212ms"],
  ["Completion rate", "91%"],
  ["Reputation", "89%"],
];

export default function LandingPage() {
  const [goal] = useState(examples[0]);
  const [typed, setTyped] = useState("");
  const [index] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cursor = 0;
    let deleting = false;
    let phraseIndex = 0;

    const timer = window.setInterval(() => {
      const phrase = examples[phraseIndex];
      if (!deleting) {
        cursor += 1;
        setTyped(phrase.slice(0, cursor));
        if (cursor === phrase.length) {
          deleting = true;
          window.setTimeout(() => setReady(true), 280);
        }
      } else {
        cursor -= 1;
        setTyped(phrase.slice(0, Math.max(0, cursor)));
        if (cursor <= 0) {
          deleting = false;
          phraseIndex = (phraseIndex + 1) % examples.length;
          setReady(false);
        }
      }
    }, 42);

    return () => window.clearInterval(timer);
  }, []);

  const displayGoal = useMemo(() => goal || typed || examples[index], [goal, typed, index]);

  return (
    <main className="landing">
      <nav className="land-nav">
        <a className="land-brand" href="/">
          <span className="brand-glyph" aria-hidden="true">
            <svg viewBox="0 0 28 28" fill="none">
              <rect x="1.5" y="1.5" width="25" height="25" rx="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M7 18L11.4 10.2L15.2 15L20.8 7.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span>AgentMarket</span>
        </a>
        <div className="land-nav-links">
          <a href="#why">Why this exists</a>
          <a href="#workflow">How it works</a>
          <a href="#builders">For builders</a>
        </div>
        <a className="land-nav-cta" href="/app">Launch marketplace</a>
      </nav>

      <section className="hero-band">
        <div className="curve curve-one" aria-hidden="true" />
        <div className="curve curve-two" aria-hidden="true" />
        <div className="hero-shell">
          <div className="hero-copy reveal">
            <div className="eyebrow"><span /> BSC · ERC-8004 · ERC-8183</div>
            <h1>State the outcome.<br /><em>We find the agent.</em></h1>
            <p>
              A reliability-first marketplace for on-chain agents. Describe the job in plain language and get a transparent recommendation instead of a directory to sort yourself.
            </p>
            <div className="hero-actions">
              <a className="primary-btn" href="/app">Try the live marketplace <span>↗</span></a>
              <a className="text-btn" href="#workflow">See the lifecycle</a>
            </div>
            <div className="micro-proof">
              <span>Indexed ecosystem</span><b>200k+</b>
              <i />
              <span>Ranking signals</span><b>8</b>
              <i />
              <span>Full custody</span><b>0</b>
            </div>
          </div>

          <div className={`match-instrument reveal ${ready ? "is-ready" : ""}`}>
            <div className="instrument-top">
              <span>MATCH INSTRUMENT</span>
              <span>LIVE</span>
            </div>
            <div className="goal-field">
              <small>USER GOAL</small>
              <div className="goal-value">{typed || displayGoal}<span className="caret" /></div>
            </div>
            <div className="match-highlight">
              <div>
                <small>BEST FIT</small>
                <strong>Yield Agent</strong>
                <span>Conservative yield strategy</span>
              </div>
              <div className="score-ring"><b>92</b><span>%</span></div>
            </div>
            <div className="signal-list">
              {signals.map(([name, value], i) => (
                <div className="signal" key={name} style={{ "--signal-delay": `${i * 90}ms` } as CSSProperties}>
                  <span>{name}</span><b>{value}</b><i><u style={{ width: `${[96, 100, 88, 91, 89][i]}%` }} /></i>
                </div>
              ))}
            </div>
            <div className="instrument-foot">
              <span>Transparent weighting</span>
              <span>ERC-8183 escrow ready</span>
            </div>
          </div>
        </div>
      </section>

      <section id="why" className="section paper-section section-split">
        <div className="section-shell">
          <div className="section-intro reveal">
            <span className="section-kicker">01 / WHY</span>
            <h2>The registry is huge.<br />The decision is still hard.</h2>
            <p>AgentMarket turns identity, endpoint health, capability and track record into a decision you can actually inspect.</p>
          </div>
          <div className="editorial-pair reveal">
            <article className="editor-card tilt-left">
              <div className="card-index">A</div>
              <h3>Directory model</h3>
              <p>Open profile. Read profile. Compare profile. Repeat until you hope you picked the right agent.</p>
              <div className="card-foot">YOU DO THE VETTING</div>
            </article>
            <article className="editor-card tilt-right accent-card">
              <div className="card-index">B</div>
              <h3>Marketplace model</h3>
              <p>State an outcome. The engine ranks compatible agents and explains every signal that moved the score.</p>
              <div className="card-foot">THE SYSTEM DOES THE COMPARING</div>
            </article>
          </div>
        </div>
      </section>

      <section id="workflow" className="section ink-section">
        <div className="ink-curve" aria-hidden="true" />
        <div className="section-shell">
          <div className="section-intro light reveal">
            <span className="section-kicker">02 / WORKFLOW</span>
            <h2>One mission. One accountable path.</h2>
            <p>Identity comes from ERC-8004. The job and escrow come from ERC-8183. The marketplace keeps the workflow legible from intent to evidence.</p>
          </div>
          <div className="workflow-track reveal">
            {[
              ["01", "Intent", "Plain-language goal becomes task requirements."],
              ["02", "Match", "Compatible agents are ranked by visible signals."],
              ["03", "Hire", "Mission becomes a real job with defined terms."],
              ["04", "Execute", "Agent works, reports progress and submits."],
              ["05", "Evaluate", "Evidence is reviewed before release."],
              ["06", "Settle", "Escrow settles and reputation gets stronger."],
            ].map(([n, title, copy]) => (
              <div className="workflow-step" key={n}>
                <span>{n}</span><h3>{title}</h3><p>{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section paper-section curve-section">
        <div className="section-shell two-col">
          <div className="section-intro reveal">
            <span className="section-kicker">03 / CUSTODY</span>
            <h2>Your wallet stays yours.</h2>
            <p>Job escrow pays for the mission. Trading authority, when needed, is separate and scoped: caps, allowlists, expiry and revocation.</p>
            <a className="inline-link" href="/app">Explore the live product →</a>
          </div>
          <div className="custody-diagram reveal">
            <div className="custody-orbit custody-agent"><small>AGENT</small><strong>Operating wallet</strong><span>gas · compute · x402</span></div>
            <div className="custody-orbit custody-job"><small>MISSION</small><strong>ERC-8183 escrow</strong><span>defined budget · evaluator</span></div>
            <div className="custody-center"><span>USER</span><strong>Wallet</strong><em>scoped session only</em></div>
          </div>
        </div>
      </section>

      <section id="builders" className="section builder-section">
        <div className="section-shell">
          <div className="builder-head reveal">
            <div>
              <span className="section-kicker">04 / FOR BUILDERS</span>
              <h2>Already have an ERC-8004 agent?<br />Be findable without rebuilding it for us.</h2>
            </div>
            <p>Passive indexing discovers ecosystem agents automatically. Self-registration lets operators verify ownership and enrich their profile.</p>
          </div>
          <div className="builder-ribbon reveal">
            <div><span>PASSIVE</span><strong>Indexed from chain</strong><small>agentId · URI · capabilities · endpoint</small></div>
            <div className="ribbon-arrow">→</div>
            <div><span>ACTIVE</span><strong>Verified by operator</strong><small>wallet proof · live endpoint · profile</small></div>
            <a href="/app">Open registry →</a>
          </div>
        </div>
      </section>

      <footer className="land-footer">
        <div className="section-shell footer-row">
          <div className="land-brand"><span className="brand-glyph"><svg viewBox="0 0 28 28" fill="none"><rect x="1.5" y="1.5" width="25" height="25" rx="7" stroke="currentColor" strokeWidth="1.5" /><path d="M7 18L11.4 10.2L15.2 15L20.8 7.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span>AgentMarket</div>
          <div className="footer-meta"><span>BSC</span><span>ERC-8004</span><span>ERC-8183</span><span>x402</span></div>
          <span className="footer-note">Discoverability first.</span>
        </div>
      </footer>
    </main>
  );
}
