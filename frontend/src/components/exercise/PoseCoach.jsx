import { speechLang } from "../../i18n/translator.js";
import { useEffect, useRef, useState } from "react";
import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { Video, Square, Lock } from "lucide-react";
import { EXERCISES, newState, emptyStats, summarise } from "../../lib/exerciseEngine.js";

// MediaPipe Pose runs fully in the browser (WASM). Frames never leave the device.
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const LINKS = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28]];
const TONE = { good: "green", partial: "amber", none: "gray" };
const mmss = (ms) => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

/** Live camera coach for one exercise: rep counter, joint angle, form cues. */
export default function PoseCoach({ exerciseId, t, lang, onFinish }) {
  const ex = EXERCISES[exerciseId];
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const live = useRef({ landmarker: null, stream: null, raf: 0, d: newState(), stats: emptyStats(), side: "left", started: 0, lastUi: 0, lastSpoken: "", ended: false });
  const [state, setState] = useState("idle"); // idle | loading | running | error
  const [side, setSide] = useState("left");
  const [hud, setHud] = useState({ reps: 0, angle: null, status: "none", elapsed: 0 });
  const [cue, setCue] = useState("");

  const say = (text) => {
    const L = live.current;
    if (!text || !window.speechSynthesis || text === L.lastSpoken) return;
    L.lastSpoken = text;
    const u = new SpeechSynthesisUtterance(text.replace("✓", ""));
    u.lang = speechLang(lang);
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
  }
  useEffect(() => () => { stop(); window.speechSynthesis?.cancel(); }, []);
  useEffect(() => { live.current.side = side; }, [side]);

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
      L.d = newState(); L.stats = emptyStats(); L.started = performance.now(); L.ended = false;
      setCue("ready");
      setState("running");
      L.raf = requestAnimationFrame(loop);
    } catch {
      stop();
      setState("error");
    }
  }

  function draw(lm, tone, required) {
    const c = canvasRef.current, v = videoRef.current;
    if (!c || !v) return;
    if (c.width !== v.videoWidth) { c.width = v.videoWidth || 640; c.height = v.videoHeight || 480; }
    const g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    if (!lm) return;
    g.lineWidth = 4;
    g.strokeStyle = tone === "green" ? "#4ade80" : tone === "amber" ? "#fbbf24" : "#94a3b8";
    for (const [a, b] of LINKS) {
      const p = lm[a], q = lm[b];
      if (!p || !q || (p.visibility ?? 1) < 0.5 || (q.visibility ?? 1) < 0.5) continue;
      g.beginPath(); g.moveTo(p.x * c.width, p.y * c.height); g.lineTo(q.x * c.width, q.y * c.height); g.stroke();
    }
    g.fillStyle = "#ffffff";
    for (const i of required) {
      const p = lm[i];
      if (!p || (p.visibility ?? 1) < 0.5) continue;
      g.beginPath(); g.arc(p.x * c.width, p.y * c.height, 6, 0, Math.PI * 2); g.fill();
    }
  }

  function loop() {
    const L = live.current, v = videoRef.current;
    if (!L.landmarker || !v || L.ended) return;
    const now = performance.now();
    let lm;
    if (v.readyState >= 2 && v.videoWidth) {
      try { lm = L.landmarker.detectForVideo(v, now).landmarks?.[0]; } catch { lm = undefined; }
    }
    const reading = ex.read(lm, L.side);
    const step = ex.step(L.d, reading.input, now);
    L.d = step.d;
    L.stats.totalFrames += 1;
    if (reading.input !== null) L.stats.reliableFrames += 1;
    if (step.event === "lost") L.stats.lostEvents += 1;
    if (step.event) {
      const key = ex.cue(step.event, L.d);
      if (key) { setCue(key); say(step.event === "rep" || step.event === "swing" ? `${L.d.reps}` : t(key)); }
    }
    draw(lm, TONE[reading.status], ex.required(L.side));
    if (now - L.lastUi > 150) {
      L.lastUi = now;
      setHud({ reps: L.d.reps, angle: reading.angle, status: reading.status, elapsed: now - L.started });
    }
    if (L.d.reps >= ex.targetReps) { say(t("done")); finish(); return; }
    L.raf = requestAnimationFrame(loop);
  }

  function finish() {
    const L = live.current;
    if (L.ended) return;
    L.ended = true;
    const summary = summarise(exerciseId, L.d, L.stats, performance.now() - L.started, L.side);
    stop();
    setState("idle");
    onFinish(summary);
  }

  const running = state === "running";
  const cueGood = cue.startsWith("cue_") && ["cue_depth", "cue_rep", "cue_curl", "cue_inview", "cue_alternate"].includes(cue);

  return (
    <div className="card">
      <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <h3 className="card-title">{ex.icon} {t(ex.id)}</h3>
          <p className="card-sub">{t(`${ex.id}_frame`)}</p>
        </div>
        {ex.usesSide && (
          <div className="checkin-lang" role="group" aria-label={t("arm")}>
            <button className={side === "left" ? "active" : ""} onClick={() => setSide("left")}>{t("left")}</button>
            <button className={side === "right" ? "active" : ""} onClick={() => setSide("right")}>{t("right")}</button>
          </div>
        )}
      </div>

      <div className="checkin-stage exercise-stage">
        <video ref={videoRef} muted playsInline className="checkin-video" style={{ opacity: running ? 1 : 0.15 }} />
        <canvas ref={canvasRef} className="checkin-canvas" />
        {state === "loading" && <div className="checkin-stage-msg pulse">{t("loading")}</div>}
        {state === "idle" && <div className="checkin-stage-msg"><Video size={34} /></div>}
        {state === "error" && <div className="checkin-stage-msg">⚠️ {t("cameraError")}</div>}
        {running && (
          <>
            <div className="exercise-reps"><b>{hud.reps}</b><span>/ {ex.targetReps} {t("reps")}</span></div>
            <div className="checkin-stage-foot">
              <span className={"badge " + TONE[hud.status]}>{t(`status_${hud.status}`)}</span>
              <span className="badge gray">{t(ex.angleKey)} {hud.angle == null ? "—" : `${Math.round(hud.angle)}°`}</span>
              <span className="badge gray">{t("time")} {mmss(hud.elapsed)}</span>
            </div>
          </>
        )}
      </div>

      {running && <div className={"checkin-cue" + (cueGood ? " good" : "")} aria-live="polite">{cue ? t(cue) : "…"}</div>}
      <div className="checkin-disclaimer" style={{ color: "var(--muted)", fontWeight: 600 }}><Lock size={15} /> {t("onDevice")}</div>

      <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        {!running ? (
          <button className="btn gradient lg" onClick={start} disabled={state === "loading"}><Video size={17} /> {t("start")}</button>
        ) : (
          <button className="btn secondary" onClick={finish}><Square size={15} /> {t("end")}</button>
        )}
      </div>
    </div>
  );
}
