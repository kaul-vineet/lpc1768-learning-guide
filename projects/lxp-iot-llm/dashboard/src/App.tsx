import { useEffect, useMemo, useState } from "react";

type MachineState = "normal" | "warning" | "critical";
type LinkState = "ready" | "offline" | "error";

interface Telemetry {
  deviceId: string;
  loadPercent: number;
  state: MachineState;
  sequence: number;
  timestamp: string;
  source: "board" | "simulator";
}

interface Explanation {
  verifiedFacts: unknown;
  possibleCause: string;
  suggestedCheck: string;
  limitation: string;
}

interface Incident {
  id: string;
  timestamp: string;
  from: MachineState;
  to: MachineState;
  loadPercent: number;
  explanation?: Explanation;
}

interface DashboardState {
  telemetry: Telemetry;
  history: Telemetry[];
  incidents: Incident[];
  logs: string[];
  links: { board: LinkState; iotHub: LinkState; foundry: LinkState };
  cloud: { lastSentAt: string | null; lastError: string | null; messagesSent: number };
}

const emptyState: DashboardState = {
  telemetry: {
    deviceId: "lpc1768-01",
    loadPercent: 0,
    state: "normal",
    sequence: 0,
    timestamp: new Date().toISOString(),
    source: "simulator"
  },
  history: [],
  incidents: [],
  logs: [],
  links: { board: "offline", iotHub: "offline", foundry: "offline" },
  cloud: { lastSentAt: null, lastError: null, messagesSent: 0 }
};

function formatTime(value?: string | null): string {
  if (!value) return "--:--:--";
  return new Date(value).toLocaleTimeString([], { hour12: false });
}

function Lamp({ label, state }: { label: string; state: LinkState }) {
  return (
    <div className="lamp-group">
      <span className={`lamp lamp-${state}`} aria-hidden="true" />
      <span>{label}</span>
      <strong>{state.toUpperCase()}</strong>
    </div>
  );
}

function SignalChart({ history }: { history: Telemetry[] }) {
  const points = useMemo(() => {
    if (history.length < 2) return "";
    return history
      .map((item, index) => {
        const x = (index / (history.length - 1)) * 100;
        const y = 100 - item.loadPercent;
        return `${x},${y}`;
      })
      .join(" ");
  }, [history]);

  return (
    <div className="scope">
      <div className="threshold threshold-critical">85</div>
      <div className="threshold threshold-warning">70</div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Recent load signal">
        <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function factsText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? {}, null, 2);
}

export function App() {
  const [state, setState] = useState<DashboardState>(emptyState);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    fetch("/api/status")
      .then((response) => response.json())
      .then(setState)
      .catch(() => undefined);

    const events = new EventSource("/events");
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.onmessage = (event) => setState(JSON.parse(event.data) as DashboardState);
    return () => events.close();
  }, []);

  const latestIncident = state.incidents.find((incident) => incident.explanation);
  const telemetry = state.telemetry;

  return (
    <main className={`console state-${telemetry.state}`}>
      <div className="scanlines" aria-hidden="true" />
      <header className="masthead">
        <div>
          <p className="eyebrow">LXP INDUSTRIAL SYSTEMS / 1986</p>
          <h1>EDGEOPS-86</h1>
          <p className="subtitle">EQUIPMENT TELEMETRY AND INCIDENT CONSOLE</p>
        </div>
        <div className="clock">
          <span>SESSION LINK</span>
          <strong>{connected ? "LOCKED" : "SEARCHING"}</strong>
          <time>{formatTime(telemetry.timestamp)}</time>
        </div>
      </header>

      {telemetry.source === "simulator" && (
        <div className="simulation-banner">
          SIMULATOR INPUT ACTIVE / CONNECT LPC1768 ETHERNET TO USE PHYSICAL CONTROL P19
        </div>
      )}

      <section className="status-rack panel">
        <Lamp label="BOARD" state={state.links.board} />
        <Lamp label="IOT HUB" state={state.links.iotHub} />
        <Lamp label="FOUNDRY" state={state.links.foundry} />
        <div className="data-cell">
          <span>DEVICE</span>
          <strong>{telemetry.deviceId}</strong>
        </div>
        <div className="data-cell">
          <span>CLOUD TX</span>
          <strong>{state.cloud.messagesSent.toString().padStart(4, "0")}</strong>
        </div>
      </section>

      <section className="primary-grid">
        <article className="panel state-panel">
          <div className="panel-label">MACHINE STATE</div>
          <div className={`annunciator annunciator-${telemetry.state}`}>
            <span>{telemetry.state.toUpperCase()}</span>
          </div>
          <p className="state-reason">
            {telemetry.state === "critical"
              ? "LOAD LIMIT EXCEEDED"
              : telemetry.state === "warning"
                ? "LOAD APPROACHING LIMIT"
                : "OPERATING WITHIN LIMIT"}
          </p>
          <div className="sequence">SEQ {String(telemetry.sequence).padStart(6, "0")}</div>
        </article>

        <article className="panel gauge-panel">
          <div className="panel-label">SIMULATED LOAD / CONTROL P19</div>
          <div className="digital-value">
            {String(telemetry.loadPercent).padStart(3, "0")}
            <small>%</small>
          </div>
          <div className="gauge-track">
            <div className="gauge-warning" />
            <div className="gauge-critical" />
            <div className="gauge-fill" style={{ width: `${telemetry.loadPercent}%` }} />
          </div>
          <div className="gauge-scale">
            <span>000</span>
            <span>WARN 070</span>
            <span>CRIT 085</span>
            <span>100</span>
          </div>
        </article>

        <article className="panel scope-panel">
          <div className="panel-label">LIVE SIGNAL / LAST 120 SAMPLES</div>
          <SignalChart history={state.history} />
        </article>
      </section>

      <section className="secondary-grid">
        <article className="panel timeline-panel">
          <div className="panel-label">INCIDENT TIMELINE</div>
          <div className="terminal-list">
            {state.incidents.length === 0 && <p className="muted">NO STATE TRANSITIONS RECORDED</p>}
            {state.incidents.map((incident) => (
              <div className="incident-row" key={incident.id}>
                <time>{formatTime(incident.timestamp)}</time>
                <span>{incident.from.toUpperCase()}</span>
                <b>&gt;</b>
                <span className={`text-${incident.to}`}>{incident.to.toUpperCase()}</span>
                <strong>{incident.loadPercent}%</strong>
                <em>{incident.explanation ? "AI READY" : "RECORDED"}</em>
              </div>
            ))}
          </div>
        </article>

        <article className="panel ai-panel">
          <div className="panel-label">AZURE AI FOUNDRY INCIDENT REPORT</div>
          {latestIncident?.explanation ? (
            <div className="report">
              <h3>VERIFIED FACTS</h3>
              <pre>{factsText(latestIncident.explanation.verifiedFacts)}</pre>
              <h3>POSSIBLE CAUSE</h3>
              <p>{latestIncident.explanation.possibleCause}</p>
              <h3>SUGGESTED CHECK</h3>
              <p>{latestIncident.explanation.suggestedCheck}</p>
              <h3>LIMITATION</h3>
              <p>{latestIncident.explanation.limitation}</p>
            </div>
          ) : (
            <div className="awaiting">
              <span className="cursor">_</span>
              AWAITING WARNING OR CRITICAL INCIDENT
            </div>
          )}
        </article>
      </section>

      <section className="panel delivery-panel">
        <div className="panel-label">DEVICE-TO-CLOUD DELIVERY</div>
        <div className="delivery-path">
          <span className="path-node">DEVICE</span>
          <i />
          <span className="path-node">GATEWAY</span>
          <i />
          <span className={`path-node ${state.links.iotHub}`}>IOT HUB</span>
          <i />
          <span className={`path-node ${state.links.foundry}`}>FOUNDRY</span>
          <i />
          <span className="path-node">DISPLAY</span>
        </div>
        <p>
          LAST CLOUD TX: {formatTime(state.cloud.lastSentAt)}
          {state.cloud.lastError ? ` / ERROR: ${state.cloud.lastError}` : ""}
        </p>
      </section>

      <section className="panel log-panel">
        <div className="panel-label">SYSTEM LOG</div>
        <div className="log-lines">
          {state.logs.map((entry, index) => (
            <div key={`${entry}-${index}`}>
              <span>&gt;</span> {entry}
            </div>
          ))}
        </div>
      </section>

      <footer>
        LOCAL DISPLAY ONLY / NO CLOUD-TO-DEVICE CONTROL / NO PERSISTENT STORAGE
      </footer>
    </main>
  );
}
