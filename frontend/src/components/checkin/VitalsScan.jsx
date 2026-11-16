import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, Sun, Hand, ScanFace, ShieldCheck } from "lucide-react";
import { api, API_BASE } from "../../api/client.js";
import { SCAN_SECONDS, readSample, summariseScan } from "../../lib/vitalsSummary.js";

// If VitalLens hasn't produced a heart rate by this many seconds, we assume
// the API is unreachable and switch to the open-source on-device method.
const API_WATCHDOG_SEC = 12;

const pct = (c) => (c == null ? "—" : `${Math.round(c * 100)}%`);

export function VitalTile({ label, unit, metric, t, emptyText }) {
  const conf = metric?.confidence;
  const tone = conf == null ? "gray" : conf >= 0.8 ? "green" : conf >= 0.7 ? "amber" : "red";
  return (
    <div className="card checkin-vital">
      <div className="muted checkin-vital-label">{label}</div>
      {metric ? (
        <>
          <div className="checkin-vital-value">
            {Math.round(metric.value)} <span>{unit}</span>
          </div>
          <span className={"badge " + tone}>{t("confidence")} {pct(conf)}</span>
        </>
      ) : (
        <div className="muted checkin-vital-empty">{emptyText || t("notAvailable")}</div>
      )}
    </div>
  );
}

/**
 * 30-second camera vitals scan.
 * Primary: VitalLens API through our backend proxy (the key never reaches the browser).
 * Fallback: VitalLens' open-source on-device POS method when the key is missing or the API fails.
 */
export default function VitalsScan({ t, onDone, onSkip }) {
  const videoRef = useRef(null);
  const run = useRef({ vl: null, stream: null, timer: null, samples: [], started: 0, method: "", gotHr: false, face: false });
  const [phase, setPhase] = useState("idle"); // idle | preparing | scanning | result | retry | error
  const [left, setLeft] = useState(SCAN_SECONDS);
  const [face, setFace] = useState(false);
  const [live, setLive] = useState(null);
  const [summary, setSummary] = useState(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const [error, setError] = useState("");

  async function teardown() {
    const r = run.current;
    clearInterval(r.timer);
    r.timer = null;
    try { r.vl?.stopVideoStream(); } catch { /* ignore */ }
    try { await r.vl?.close(); } catch { /* ignore */ }
    r.vl = null;
    r.stream?.getTracks().forEach((tr) => tr.stop());
    r.stream = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }
  useEffect(() => () => { teardown(); }, []);

  async function startEngine(method) {
    const r = run.current;
    const { VitalLens } = await import("vitallens");
    const options =
      method === "vitallens"
        ? { method: "vitallens", proxyUrl: new URL(`${API_BASE}/checkin/vitallens`, window.location.origin).href }
        : { method: "pos" };
    const vl = new VitalLens(options);
    vl.addEventListener("vitals", (result) => {
      const sample = readSample(result, (performance.now() - r.started) / 1000);
      if (sample.heart_rate) r.gotHr = true;
      r.samples.push(sample);
      setLive(sample);
    });
    vl.addEventListener("faceDetected", (f) => { r.face = !!f; setFace(!!f); });
    vl.addEventListener("status", (s) => {
      if (s?.stage === "startFailed" || s?.stage === "detectorFailed") r.failed = true;
    });
    await vl.setVideoStream(r.stream, videoRef.current);
    vl.startVideoStream();
    r.vl = vl;
    r.method = method;
    r.samples = [];
    r.gotHr = false;
    r.failed = false;
    r.started = performance.now();
  }

  async function switchToFallback() {
    const r = run.current;
    try { r.vl?.stopVideoStream(); await r.vl?.close(); } catch { /* ignore */ }
    r.vl = null;
    setUsedFallback(true);
    setLive(null);
    await startEngine("pos");
    setLeft(SCAN_SECONDS);
  }

  async function start() {
    const r = run.current;
    setError(""); setSummary(null); setLive(null); setFace(false); setUsedFallback(false);
    setPhase("preparing");
    try {
      r.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
      });
      videoRef.current.srcObject = r.stream;
      await videoRef.current.play().catch(() => {});

      let method = "pos";
      try { if ((await api.checkinConfig()).vitallens) method = "vitallens"; } catch { /* backend down → fallback */ }
      if (method === "pos") setUsedFallback(true);
      try {
        await startEngine(method);
      } catch (e) {
        if (method !== "vitallens") throw e;
        await switchToFallback();
      }

      setLeft(SCAN_SECONDS);
      setPhase("scanning");
      r.timer = setInterval(async () => {
        const elapsed = (performance.now() - r.started) / 1000;
        if (r.method === "vitallens" && (r.failed || (elapsed > API_WATCHDOG_SEC && !r.gotHr && r.face))) {
          clearInterval(r.timer);
          try { await switchToFallback(); r.timer = setInterval(tick, 250); } catch { finish(); }
          return;
        }
        tick();
      }, 250);
    } catch (e) {
      await teardown();
      setError(e?.name === "NotAllowedError" || e?.name === "NotFoundError" ? t("cameraError") : `${t("cameraError")} (${e?.message || e})`);
      setPhase("error");
    }
  }

  function tick() {
    const r = run.current;
    const remaining = Math.max(0, SCAN_SECONDS - (performance.now() - r.started) / 1000);
    setLeft(Math.ceil(remaining));
    if (remaining <= 0) finish();
  }

  async function finish() {
    const r = run.current;
    const result = summariseScan(r.samples, { source: r.method === "vitallens" ? "vitallens" : "pos-fallback" });
    await teardown();
    setSummary(result);
    setPhase(result.ok ? "result" : "retry");
  }

  function simulate() {
    // Clearly-labelled demo reading for machines without a camera. Never mixed
    // into a real scan: it is stored with source "demo".
    const jitter = (base, spread) => Math.round((base + (Math.random() - 0.5) * spread) * 10) / 10;
    const result = {
      heart_rate: { value: jitter(77, 4), confidence: 0.9 },
      respiratory_rate: { value: jitter(16, 2), confidence: 0.86 },
      hrv_sdnn: null, source: "demo", ok: true, reason: null,
    };
    setSummary(result);
    setPhase("result");
  }

  const scanning = phase === "scanning" || phase === "preparing";
  const progress = phase === "scanning" ? ((SCAN_SECONDS - left) / SCAN_SECONDS) * 100 : 0;

  return (
    <div className="grid cols-2 checkin-split">
      <div className="card">
        <h3 className="card-title"><ScanFace size={18} style={{ verticalAlign: "-3px" }} /> {t("scanTitle")}</h3>
        <p className="card-sub">{t("scanIntro")}</p>

        <div className="checkin-stage">
          <video ref={videoRef} muted playsInline className="checkin-video" style={{ opacity: scanning ? 1 : 0.15 }} />
          {phase === "scanning" && (
            <>
              <div className="checkin-oval" data-ok={face ? "1" : "0"} />
              <div className="checkin-countdown">{left}</div>
              <div className="checkin-stage-foot">
                <span className={"badge " + (face ? "green" : "amber")}>{face ? t("faceFound") : t("faceMissing")}</span>
                <span className="badge gray">{left} {t("secondsLeft")}</span>
              </div>
              <div className="checkin-progress"><div style={{ width: `${progress}%` }} /></div>
            </>
          )}
          {phase === "preparing" && <div className="checkin-stage-msg pulse">{t("preparing")}</div>}
          {!scanning && (
            <div className="checkin-stage-msg">
              <Camera size={34} />
            </div>
          )}
        </div>

        <div className="checkin-disclaimer"><ShieldCheck size={15} /> {t("disclaimer")}</div>

        {!scanning && phase !== "result" && (
          <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <button className="btn gradient lg" onClick={start}>
              {phase === "retry" || phase === "error" ? <><RotateCcw size={17} /> {t("retry")}</> : <><Camera size={17} /> {t("startScan")}</>}
            </button>
            <button className="btn ghost" onClick={onSkip}>{t("skip")}</button>
          </div>
        )}
        {!scanning && phase !== "result" && (
          <button className="checkin-link" onClick={simulate}>{t("simulate")}</button>
        )}
      </div>

      <div className="grid" style={{ gap: 14, alignContent: "start" }}>
        {phase === "scanning" && (
          <div className="card">
            <div className="muted" style={{ fontSize: ".82rem" }}>{t("scanning")}</div>
            <div className="checkin-live">
              <div><b>{live?.heart_rate ? Math.round(live.heart_rate.value) : "—"}</b> {t("bpm")}</div>
              <div><b>{live?.respiratory_rate ? Math.round(live.respiratory_rate.value) : "—"}</b> {t("brpm")}</div>
            </div>
            <div className="muted" style={{ fontSize: ".78rem" }}>
              {usedFallback ? t("engineFallback") : t("engineApi")}
            </div>
          </div>
        )}

        {phase === "error" && <div className="card checkin-warn">⚠️ {error}</div>}

        {phase === "retry" && summary && (
          <div className="card checkin-warn">
            <h3 className="card-title">{t("lowTitle")}</h3>
            {summary.reason === "no_face" ? (
              <p style={{ margin: 0 }}>{t("noFace")}</p>
            ) : (
              <>
                <p style={{ marginTop: 0 }}>
                  {t("lowBody")} <span className="badge red">{t("confidence")} {pct(summary.heart_rate?.confidence)}</span>
                </p>
                <ul className="checkin-tips">
                  <li><Sun size={16} /> {t("tipLight")}</li>
                  <li><Hand size={16} /> {t("tipStill")}</li>
                  <li><ScanFace size={16} /> {t("tipClose")}</li>
                </ul>
              </>
            )}
          </div>
        )}

        {phase === "result" && summary && (
          <>
            <div className="grid cols-3 checkin-vitals">
              <VitalTile t={t} label={t("heartRate")} unit={t("bpm")} metric={summary.heart_rate} />
              <VitalTile t={t} label={t("breathing")} unit={t("brpm")} metric={summary.respiratory_rate} />
              <VitalTile t={t} label={t("hrv")} unit={t("ms")} metric={summary.hrv_sdnn} emptyText={t("hrvUnavailable")} />
            </div>
            {summary.source === "pos-fallback" && <div className="card checkin-note">ℹ️ {t("fallbackNote")}</div>}
            {summary.source === "demo" && <div className="card checkin-note">🧪 {t("simulated")}</div>}
            <div className="checkin-disclaimer"><ShieldCheck size={15} /> {t("disclaimer")}</div>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <button className="btn gradient lg" onClick={() => onDone(summary)}>{t("useReading")} →</button>
              <button className="btn ghost" onClick={start}><RotateCcw size={16} /> {t("retry")}</button>
            </div>
          </>
        )}

        {(phase === "idle") && (
          <div className="card">
            <ul className="checkin-tips">
              <li><Sun size={16} /> {t("tipLight")}</li>
              <li><Hand size={16} /> {t("tipStill")}</li>
              <li><ScanFace size={16} /> {t("tipClose")}</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
