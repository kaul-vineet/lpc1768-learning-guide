import { useEffect, useMemo, useState } from "react";

type MachineState = "normal" | "warning" | "critical";
type LinkState = "ready" | "offline" | "error";
type OperatingMode = "normal" | "boost" | "maintenance";
type Trend = "rising" | "falling" | "stable" | "unknown";

interface Analysis {
  headroom: number;
  loadTrend: Trend;
  coolingTrend: Trend;
  temperatureTrend: Trend;
  deficitDurationSeconds: number;
  pattern: "balanced" | "transient-deficit" | "sustained-deficit";
  risk: MachineState;
}

interface Telemetry {
  deviceId: string;
  loadPercent: number;
  coolingPercent: number;
  mode: OperatingMode;
  temperatureC: number | null;
  temperatureValid: boolean;
  state: MachineState;
  sequence: number;
  timestamp: string;
  source: "board" | "simulator";
  analysis: Analysis;
}

interface Explanation {
  assessment: string;
  contributingFactors: string[];
  recommendedAction: string;
  expectedRecovery: string;
  limitation: string;
  promptVersion: string;
}

interface Incident {
  id: string;
  timestamp: string;
  event: "state-change" | "mode-change";
  from: MachineState;
  to: MachineState;
  loadPercent: number;
  coolingPercent: number;
  mode: OperatingMode;
  headroom: number;
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
    coolingPercent: 0,
    mode: "normal",
    temperatureC: null,
    temperatureValid: false,
    state: "normal",
    sequence: 0,
    timestamp: new Date().toISOString(),
    source: "simulator",
    analysis: {
      headroom: 0,
      loadTrend: "unknown",
      coolingTrend: "unknown",
      temperatureTrend: "unknown",
      deficitDurationSeconds: 0,
      pattern: "balanced",
      risk: "normal"
    }
  },
  history: [],
  incidents: [],
  logs: [],
  links: { board: "offline", iotHub: "offline", foundry: "offline" },
  cloud: { lastSentAt: null, lastError: null, messagesSent: 0 }
};

function LinkNode({
  title,
  detail,
  state
}: {
  title: string;
  detail: string;
  state: LinkState;
}) {
  return (
    <div className={`story-node story-node-${state}`}>
      <span className={`lamp lamp-${state}`} />
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function Gauge({
  label,
  control,
  value,
  kind
}: {
  label: string;
  control: string;
  value: number;
  kind: "load" | "cooling";
}) {
  return (
    <div className={`demo-gauge demo-gauge-${kind}`}>
      <div className="gauge-title">
        <span>{label}</span>
        <small>{control}</small>
      </div>
      <strong>{value}%</strong>
      <div className="simple-bar">
        <i style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function SignalChart({ history }: { history: Telemetry[] }) {
  const points = useMemo(() => {
    const make = (select: (item: Telemetry) => number) =>
      history.length < 2
        ? ""
        : history
            .map((item, index) => `${(index / (history.length - 1)) * 100},${100 - select(item)}`)
            .join(" ");
    return {
      load: make((item) => item.loadPercent),
      cooling: make((item) => item.coolingPercent)
    };
  }, [history]);

  return (
    <div className="demo-chart">
      <div className="chart-legend">
        <span>LOAD</span>
        <span>COOLING</span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Load and cooling history">
        <polyline className="signal-load" points={points.load} fill="none" vectorEffect="non-scaling-stroke" />
        <polyline className="signal-cooling" points={points.cooling} fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function formatTime(value: string | null): string {
  if (!value) return "WAITING";
  return new Date(value).toLocaleTimeString([], { hour12: false });
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

  const telemetry = state.telemetry;
  const analysis = telemetry.analysis;
  const latestIncident = state.incidents[0];
  const latestExplainedIncident = state.incidents.find((incident) => incident.explanation);
  const explanation = latestExplainedIncident?.explanation;
  const newerAnalysisPending =
    latestIncident !== undefined &&
    latestIncident.explanation === undefined &&
    latestIncident.id !== latestExplainedIncident?.id;
  const headroomText =
    analysis.headroom > 0
      ? `+${analysis.headroom} HEADROOM`
      : analysis.headroom < 0
        ? `${Math.abs(analysis.headroom)} POINT DEFICIT`
        : "BALANCED";

  return (
    <main className={`demo-console state-${telemetry.state}`}>
      <header className="demo-header">
        <div>
          <p>EDGEOPS-86 / IOT + LLM HACKATHON</p>
          <h1>PHYSICAL SIGNAL TO AI EXPLANATION</h1>
        </div>
        <div className="live-badge">
          <span>{connected ? "LIVE" : "CONNECTING"}</span>
          <small>{telemetry.source === "board" ? "PHYSICAL BOARD" : "SIMULATOR"}</small>
        </div>
      </header>

      {telemetry.source === "simulator" && (
        <div className="simulation-banner">SIMULATOR ACTIVE / PHYSICAL BOARD NOT RECEIVING</div>
      )}

      <section className="iot-story">
        <LinkNode title="1. LPC1768 EDGE" detail="Physical controls + deterministic risk" state={state.links.board} />
        <span className="story-arrow">→</span>
        <LinkNode
          title="2. AZURE IOT HUB"
          detail={`${state.cloud.messagesSent} messages / last ${formatTime(state.cloud.lastSentAt)}`}
          state={state.links.iotHub}
        />
        <span className="story-arrow">→</span>
        <LinkNode title="3. AZURE AI FOUNDRY" detail="Evidence-grounded interpretation" state={state.links.foundry} />
      </section>

      <section className="demo-main">
        <article className="demo-card physical-card">
          <div className="section-heading">
            <span>OBSERVE</span>
            <strong>PHYSICAL INPUTS</strong>
          </div>
          <div className="gauge-pair">
            <Gauge label="EQUIPMENT LOAD" control="P19 / LEFT KNOB" value={telemetry.loadPercent} kind="load" />
            <Gauge label="COOLING CAPACITY" control="P20 / RIGHT KNOB" value={telemetry.coolingPercent} kind="cooling" />
          </div>
          <div className="context-row">
            <div>
              <small>MODE</small>
              <strong>{telemetry.mode.toUpperCase()}</strong>
            </div>
            <div>
              <small>TEMPERATURE</small>
              <strong>{telemetry.temperatureValid ? `${telemetry.temperatureC?.toFixed(1)}°C` : "UNAVAILABLE"}</strong>
            </div>
          </div>
          <SignalChart history={state.history} />
        </article>

        <article className={`demo-card risk-card risk-${telemetry.state}`}>
          <div className="section-heading">
            <span>DETECT</span>
            <strong>DETERMINISTIC EDGE DECISION</strong>
          </div>
          <div className="risk-state">{telemetry.state.toUpperCase()}</div>
          <div className="headroom-value">{headroomText}</div>
          <div className="evidence-grid">
            <div>
              <small>LOAD TREND</small>
              <strong>{analysis.loadTrend.toUpperCase()}</strong>
            </div>
            <div>
              <small>COOLING TREND</small>
              <strong>{analysis.coolingTrend.toUpperCase()}</strong>
            </div>
            <div>
              <small>DEFICIT TIME</small>
              <strong>{analysis.deficitDurationSeconds}s</strong>
            </div>
            <div>
              <small>PATTERN</small>
              <strong>{analysis.pattern.toUpperCase().replace("-", " ")}</strong>
            </div>
          </div>
          <p className="authority-note">Calculated in code. The LLM cannot override this state.</p>
        </article>

        <article className="demo-card ai-story-card">
          <div className="section-heading">
            <span>EXPLAIN + RECOVER</span>
            <strong>AZURE AI FOUNDRY STORY</strong>
          </div>
          {explanation ? (
            <div className="ai-story">
              {newerAnalysisPending && (
                <div className="analysis-pending">
                  NEW {latestIncident.to.toUpperCase()} EVENT AWAITING FOUNDRY ANALYSIS
                </div>
              )}
              <div className="analysis-snapshot">
                <span>ANALYZED {latestExplainedIncident.to.toUpperCase()}</span>
                <span>
                  LOAD {latestExplainedIncident.loadPercent}% / COOLING{" "}
                  {latestExplainedIncident.coolingPercent}% /{" "}
                  {latestExplainedIncident.headroom >= 0 ? "+" : ""}
                  {latestExplainedIncident.headroom} HEADROOM
                </span>
                <span>{formatTime(latestExplainedIncident.timestamp)}</span>
              </div>
              <div className="story-line">
                <span>01</span>
                <div>
                  <small>WHAT IS HAPPENING</small>
                  <p>{explanation.assessment}</p>
                </div>
              </div>
              <div className="story-line">
                <span>02</span>
                <div>
                  <small>WHY THE MODEL SAYS THIS</small>
                  <ul>
                    {explanation.contributingFactors.slice(0, 3).map((factor) => (
                      <li key={factor}>{factor}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="story-line">
                <span>03</span>
                <div>
                  <small>SAFE NEXT ACTION</small>
                  <p>{explanation.recommendedAction}</p>
                </div>
              </div>
              <div className="story-line">
                <span>04</span>
                <div>
                  <small>HOW RECOVERY IS PROVEN</small>
                  <p>{explanation.expectedRecovery}</p>
                </div>
              </div>
              <div className="story-line limitation-line">
                <span>!</span>
                <div>
                  <small>LIMITATION</small>
                  <p>{explanation.limitation}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="ai-waiting">
              <strong>
                {latestIncident
                  ? `ANALYZING ${latestIncident.to.toUpperCase()} EVENT`
                  : "WAITING FOR A PHYSICAL INCIDENT"}
              </strong>
              <p>
                Foundry runs after IoT Hub delivery on state transitions and
                relevant mode changes—not every telemetry sample.
              </p>
            </div>
          )}
        </article>
      </section>

      <footer className="demo-footer">
        <span>EDGE DECIDES</span>
        <span>IOT DELIVERS</span>
        <span>LLM EXPLAINS</span>
        <span>HUMAN ACTS</span>
      </footer>
    </main>
  );
}
