import { speechLang } from "../../i18n/translator.js";
import { useEffect, useRef, useState } from "react";
import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { Armchair, PersonStanding, RefreshCw, Timer, Video, Lock, BellRing } from "lucide-react";
import {
  postureFeatures, averageFeatures, classifyPosture, createRepCounter, createSittingTimer,
  sitToStandSignal, sitToStandFeedback, shoulderRollSignal, shoulderRollFeedback,
  SIT_TO_STAND, SHOULDER_ROLL,
} from "../../lib/poseMetrics.js";

// MediaPipe Pose runs fully in the browser (WASM). Frames never leave the device.
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const LINKS = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16], [7, 8], [0, 7], [0, 8]];
const SIT_LIMITS = [30, 20 * 60, 30 * 60, 45 * 60]; // seconds; first one is for demos
const STATUS_TONE = { good: "green", slouch: "red", forward_head: "red", uneven: "amber", none: "gray" };

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function MovementCheck({ t, lang, onDone, onSkip }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const live = useRef({
    landmarker: null, stream: null, raf: 0, mode: "posture", baseline: null, calib: null,
    good: 0, total: 0, smooth: null, issueSince: 0, lastIssue: "good",
    sts: createRepCounter(SIT_TO_STAND), rolls: createRepCounter({ ...SHOULDER_ROLL, minRepMs: 400 }),
    maxLean: 0, maxTilt: 0, sit: createSittingTimer({ limitSec: SIT_LIMITS[0] }), lastSpoken: "", lastUi: 0,
  });
  const [state, setState] = useState("idle"); // idle | loading | running | error
  const [mode, setMode] = useState("posture");
  const [calibrated, setCalibrated] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [posture, setPosture] = useState("none");
  const [score, setScore] = useState(null);
  const [reps, setReps] = useState({ sts: 0, rolls: 0 });
  const [cue, setCue] = useState("");
  const [sitSec, setSitSec] = useState(0);
  const [sitLimit, setSitLimit] = useState(SIT_LIMITS[0]);
  const [breakDue, setBreakDue] = useState(false);

  const say = (text) => {
    const L = live.current;
    if (!text || text === L.lastSpoken || !window.speechSynthesis) return;
    L.lastSpoken = text;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = speechLang(lang);
    u.rate = 0.95;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };

  function stop() {
    const L = live.current;
    cancelAnimationFrame(L.raf);
    L.stream?.getTracks().forEach((tr) => tr.stop());
    L.stream = null;
    try { L.landmarker?.close(); } catch { /* ignore */ }
    L.landmarker = null;
    window.speechSynthesis?.cancel();
  }
  useEffect(() => stop, []);
  useEffect(() => { live.current.mode = mode; setCue(""); live.current.maxLean = 0; live.current.maxTilt = 0; }, [mode]);
  useEffect(() => {
    live.current.sit = createSittingTimer({ limitSec: sitLimit });
    setBreakDue(false); setSitSec(0);
  }, [sitLimit]);

  async function start() {
    const L = live.current;
    setState("loading");
    try {
      L.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
      });
      videoRef.current.srcObject = L.stream;
      await videoRef.current.play().catch(() => {});
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      L.landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate: "GPU" },
        runningMode: "VIDEO", numPoses: 1,
      });
      setState("running");
      L.raf = requestAnimationFrame(loop);
    } catch {
      stop();
      setState("error");
    }
  }

  function calibrate() {
    live.current.calib = { samples: [], until: performance.now() + 2000 };
    setCalibrating(true);
  }

  function draw(lm, tone) {
    const c = canvasRef.current, v = videoRef.current;
    if (!c || !v) return;
    if (c.width !== v.videoWidth) { c.width = v.videoWidth || 640; c.height = v.videoHeight || 480; }
    const g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    if (!lm) return;
    g.lineWidth = 4;
    g.strokeStyle = tone === "green" ? "#4ade80" : tone === "red" ? "#f87171" : "#fbbf24";
    g.fillStyle = "#ffffff";
    for (const [a, b] of LINKS) {
      const p = lm[a], q = lm[b];
      if (!p || !q || (p.visibility ?? 1) < 0.5 || (q.visibility ?? 1) < 0.5) continue;
      g.beginPath(); g.moveTo(p.x * c.width, p.y * c.height); g.lineTo(q.x * c.width, q.y * c.height); g.stroke();
    }
    for (const i of [0, 7, 8, 11, 12]) {
      const p = lm[i];
      if (!p || (p.visibility ?? 1) < 0.5) continue;
      g.beginPath(); g.arc(p.x * c.width, p.y * c.height, 5, 0, Math.PI * 2); g.fill();
    }
  }

  function loop() {
    const L = live.current;
    const v = videoRef.current;
    if (!L.landmarker || !v) return;
    const now = performance.now();
    let lm = null;
    if (v.readyState >= 2 && v.videoWidth) {
      try { lm = L.landmarker.detectForVideo(v, now).landmarks?.[0] || null; } catch { lm = null; }
    }
    const raw = postureFeatures(lm);
    // light smoothing so one noisy frame doesn't flip the status
    if (raw) {
      L.smooth = L.smooth
        ? Object.fromEntries(Object.keys(raw).map((k) => [k, raw[k] == null || L.smooth[k] == null ? raw[k] : L.smooth[k] * 0.7 + raw[k] * 0.3]))
        : raw;
    }
    const f = raw ? L.smooth : null;

    if (L.calib) {
      if (f) L.calib.samples.push(f);
      if (now >= L.calib.until) {
        const base = averageFeatures(L.calib.samples);
        L.calib = null;
        setCalibrating(false);
        if (base) {
          L.baseline = base; L.good = 0; L.total = 0;
          L.sts.reset(); L.rolls.reset(); setReps({ sts: 0, rolls: 0 });
          setCalibrated(true);
        }
      }
    }

    let status = "none";
    const rise = sitToStandSignal(f, L.baseline);
    const standing = rise != null && rise > SIT_TO_STAND.upAt;

    if (f) {
      if (L.mode === "posture") {
        status = classifyPosture(f, L.baseline)?.status || "none";
        if (standing) status = "good";
        // only count toward the score once calibrated and seated
        if (L.baseline && !standing) { L.total += 1; if (status === "good") L.good += 1; }
        if (status !== "good" && status !== "none") {
          if (L.lastIssue !== status) { L.lastIssue = status; L.issueSince = now; }
          else if (now - L.issueSince > 4000) { say(t(`posture_${status}`)); L.issueSince = now + 20000; }
        } else { L.lastIssue = "good"; }
      } else if (L.baseline) {
        status = "good";
        L.maxLean = Math.max(L.maxLean, Math.abs(f.lean - (L.baseline.lean || 0)));
        L.maxTilt = Math.max(L.maxTilt, f.tilt - (L.baseline.tilt || 0));
        if (L.mode === "sts") {
          const rep = L.sts.update(rise, now);
          if (rep) {
            const key = sitToStandFeedback(rep, L.maxLean);
            L.maxLean = 0;
            setReps((r) => ({ ...r, sts: rep.count })); setCue(key); say(`${rep.count}. ${t(key)}`);
          }
        } else {
          const rep = L.rolls.update(shoulderRollSignal(f, L.baseline), now);
          if (rep) {
            const key = shoulderRollFeedback(rep, L.maxTilt);
            L.maxTilt = 0;
            setReps((r) => ({ ...r, rolls: rep.count })); setCue(key); say(`${rep.count}. ${t(key)}`);
          }
        }
      }
    } else if (L.mode === "sts" && L.sts.phase === "up") {
      status = "good"; // stood up out of frame — keep waiting for the sit
    }

    // Sitting timer: seated = visible and not standing, in posture mode.
    const seated = !!f && !standing && L.mode === "posture";
    const due = L.sit.update(seated ? "seated" : "away", now);

    draw(lm, STATUS_TONE[status]);
    if (now - L.lastUi > 300) {
      L.lastUi = now;
      setPosture(status);
      setScore(L.total > 30 ? Math.round((L.good / L.total) * 100) : null);
      setSitSec(L.sit.seatedSec);
      setBreakDue((was) => { if (due && !was) say(t("breakTitle")); return due; });
    }
    L.raf = requestAnimationFrame(loop);
  }

  function finish() {
    const L = live.current;
    const result = {
      posture_score: L.total > 30 ? Math.round((L.good / L.total) * 100) : null,
      sit_to_stand_reps: L.sts.count || null,
      shoulder_roll_reps: L.rolls.count || null,
    };
    stop();
    onDone(result);
  }

  const running = state === "running";
  const limitLabel = (s) => (s < 60 ? t("demo30") : `${s / 60} ${t("min")}`);

  return (
    <div className="grid cols-2 checkin-split">
      <div className="card">
        <h3 className="card-title"><Armchair size={18} style={{ verticalAlign: "-3px" }} /> {t("moveTitle")}</h3>
        <p className="card-sub">{t("moveIntro")}</p>

        <div className="checkin-stage">
          <video ref={videoRef} muted playsInline className="checkin-video" style={{ opacity: running ? 1 : 0.15 }} />
          <canvas ref={canvasRef} className="checkin-canvas" />
          {state === "loading" && <div className="checkin-stage-msg pulse">{t("loadingPose")}</div>}
          {state === "idle" && <div className="checkin-stage-msg"><Video size={34} /></div>}
          {state === "error" && <div className="checkin-stage-msg">⚠️ {t("cameraError")}</div>}
          {running && (
            <div className="checkin-stage-foot">
              <span className={"badge " + STATUS_TONE[posture]}>
                {mode === "posture" ? t(`posture_${posture}`) : calibrated ? (cue ? t(cue) : t(mode === "sts" ? "modeSts" : "modeRolls")) : t("needCalibration")}
              </span>
            </div>
          )}
          {running && mode !== "posture" && (
            <div className="checkin-countdown">{mode === "sts" ? reps.sts : reps.rolls}</div>
          )}
        </div>
        <div className="checkin-disclaimer"><Lock size={15} /> {t("onDevice")}</div>

        {!running ? (
          <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <button className="btn gradient lg" onClick={start} disabled={state === "loading"}>
              <Video size={17} /> {t("startCamera")}
            </button>
            <button className="btn ghost" onClick={onSkip}>{t("skip")}</button>
          </div>
        ) : (
          <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <button className={"btn " + (calibrated ? "secondary" : "gradient lg")} onClick={calibrate} disabled={calibrating}>
              <RefreshCw size={16} /> {calibrating ? t("calibrating") : calibrated ? t("recalibrate") : t("calibrateBtn")}
            </button>
            {calibrated && <button className="btn gradient" onClick={finish}>{t("finishMove")} →</button>}
          </div>
        )}
      </div>

      <div className="grid" style={{ gap: 14, alignContent: "start" }}>
        {running && !calibrated && <div className="card checkin-note">👉 {t("calibrate")}</div>}

        {breakDue && (
          <div className="card checkin-break">
            <h3 className="card-title"><BellRing size={18} style={{ verticalAlign: "-3px" }} /> {t("breakTitle")}</h3>
            <p style={{ margin: "4px 0 12px" }}>{t("breakBody")}</p>
            <button className="btn sm" onClick={() => { live.current.sit.reset(); setBreakDue(false); }}>{t("breakDone")}</button>
          </div>
        )}

        <div className="card">
          <div className="tabs" role="tablist">
            {[["posture", t("modePosture")], ["sts", t("modeSts")], ["rolls", t("modeRolls")]].map(([k, label]) => (
              <button key={k} role="tab" aria-selected={mode === k} className={"tab" + (mode === k ? " active" : "")} onClick={() => setMode(k)}>
                {label}
              </button>
            ))}
          </div>

          {mode === "posture" && (
            <div style={{ marginTop: 14 }}>
              <div className="checkin-live">
                <div><b>{score == null ? "—" : `${score}%`}</b> {t("uprightTime")}</div>
                <div><Timer size={16} style={{ verticalAlign: "-2px" }} /> {t("sittingFor")} <b>{mmss(sitSec)}</b></div>
              </div>
              <label className="muted" style={{ fontSize: ".82rem", display: "block", marginTop: 12 }}>
                {t("remindAfter")}{" "}
                <select value={sitLimit} onChange={(e) => setSitLimit(Number(e.target.value))} className="checkin-select">
                  {SIT_LIMITS.map((s) => <option key={s} value={s}>{limitLabel(s)}</option>)}
                </select>
              </label>
            </div>
          )}

          {mode !== "posture" && (
            <div style={{ marginTop: 14 }}>
              <p style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
                <PersonStanding size={17} style={{ verticalAlign: "-3px" }} /> {t(mode === "sts" ? "stsHow" : "rollsHow")}
              </p>
              <div className="checkin-live">
                <div><b>{mode === "sts" ? reps.sts : reps.rolls}</b> / 5 {t("reps")}</div>
              </div>
              <div className={"checkin-cue" + (cue && cue.endsWith("_good") ? " good" : "")}>
                {!calibrated ? t("needCalibration") : cue ? t(cue) : "…"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
