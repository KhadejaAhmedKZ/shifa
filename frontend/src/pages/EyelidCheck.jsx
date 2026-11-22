import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, ShieldCheck, Lock, Info, Users, Sun, Hand, Eye } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../api/client.js";
import { useLocalStorage } from "../hooks/useLocalStorage.js";
import { defaultLang } from "../data/checkinStrings.js";
import { greyWorldGains, regionLab, pallorReading } from "../lib/pallorMetrics.js";
import { PallorChart } from "../components/pallor/PallorTrend.jsx";
import { ErrorNote } from "../components/ui.jsx";

const S = {
  en: {
    title: "Eyelid Colour Check",
    subtitle: "A 1-minute camera check of your inner lower eyelid — an early prompt to ask about anemia.",
    disclaimer: "Wellness prompt, not a diagnosis — only a blood test (CBC) can confirm anemia",
    why: "Why this matters for healthy ageing",
    whyBody: "Low haemoglobin (anemia) is common in older adults and is linked to tiredness, falls and memory problems. A paler inner eyelid can be an early sign. Shifa' compares you only with your own usual colour, so a change is noticed early and you can ask your doctor for a simple blood test.",
    how1: "Sit facing a window or a white lamp — no coloured light.",
    how2: "Gently pull your lower eyelid down with one finger so the pink inner rim shows.",
    how3: "Take the photo, then tap the pink inner rim, then tap your cheek.",
    start: "Start camera", capture: "Take photo in 3 s", retake: "Retake photo",
    tapLid: "Tap the pink inner rim of your lower eyelid", tapSkin: "Now tap your cheek, just below the eye",
    analysing: "Analysing on this device…",
    onDevice: "The photo is analysed on this device only — it is never uploaded or stored.",
    score: "Eyelid redness score", quality: "Photo quality",
    vsBaseline: "Compared with your usual", learning: "Learning your usual colour — {n} more check(s) needed.",
    paler: "Paler than your usual", redder: "Redder than your usual", steady: "Close to your usual",
    palerAdvice: "Your inner eyelid looks paler than usual. This is not a diagnosis, but it is worth asking your doctor about a simple blood test (CBC) to check for anemia.",
    steadyAdvice: "Your eyelid colour is close to your usual. Keep eating iron-rich foods (lentils, leafy greens, meat or fish) and check again next week.",
    learningAdvice: "Thanks — this reading is saved. Do the check once a week in similar light so Shifa' can learn your usual colour.",
    careShared: "Your Primary Carer and doctor can see this trend.",
    careAlerted: "This change was shared with your care team.",
    retryTitle: "Let's retake that photo",
    issue_small: "Tap closer to the middle of the pink rim, and hold the camera a little closer.",
    issue_glare: "There is glare — turn slightly away from the light.",
    issue_dark: "The photo is too dark — face a window or turn on a white light.",
    issue_bright: "The photo is too bright — move out of direct light.",
    issue_not_eyelid: "That spot didn't look like the inner eyelid. Pull the lid down a bit more and tap the pink rim.",
    issue_no_region: "We couldn't read that spot — please tap again.",
    saved: "Saved", again: "Check again", trend: "Your eyelid colour over time",
    simulate: "No camera? Use a simulated reading (demo only)", simulated: "Simulated reading — demo only",
    cameraError: "Camera unavailable. Please allow camera access and try again.",
    readAloud: "Read aloud",
  },
  ar: {
    title: "فحص لون الجفن",
    subtitle: "فحص بالكاميرا لمدة دقيقة لباطن الجفن السفلي — تنبيه مبكر للسؤال عن فقر الدم.",
    disclaimer: "تنبيه للعافية وليس تشخيصاً — فقط تحليل الدم (CBC) يؤكد فقر الدم",
    why: "لماذا هذا مهم للشيخوخة الصحية",
    whyBody: "انخفاض الهيموغلوبين (فقر الدم) شائع لدى كبار السن ويرتبط بالتعب والسقوط ومشاكل الذاكرة. قد يكون شحوب باطن الجفن علامة مبكرة. تقارنك شفاء فقط بلونك المعتاد، فيُلاحظ التغيّر مبكراً ويمكنك سؤال طبيبك عن تحليل دم بسيط.",
    how1: "اجلس مقابل نافذة أو مصباح أبيض — دون إضاءة ملوّنة.",
    how2: "اسحب جفنك السفلي بلطف بإصبع واحد ليظهر الطرف الداخلي الوردي.",
    how3: "التقط الصورة، ثم اضغط على الطرف الوردي، ثم اضغط على خدّك.",
    start: "تشغيل الكاميرا", capture: "التقاط الصورة خلال ٣ ثوانٍ", retake: "إعادة التصوير",
    tapLid: "اضغط على الطرف الداخلي الوردي للجفن السفلي", tapSkin: "الآن اضغط على خدّك أسفل العين مباشرة",
    analysing: "جارٍ التحليل على هذا الجهاز…",
    onDevice: "تُحلَّل الصورة على هذا الجهاز فقط — لا تُرفع ولا تُحفظ أبداً.",
    score: "درجة احمرار الجفن", quality: "جودة الصورة",
    vsBaseline: "مقارنةً بالمعتاد لديك", learning: "نتعرّف على لونك المعتاد — نحتاج {n} فحص/فحوصات إضافية.",
    paler: "أفتح من المعتاد", redder: "أكثر احمراراً من المعتاد", steady: "قريب من المعتاد",
    palerAdvice: "يبدو باطن جفنك أفتح من المعتاد. هذا ليس تشخيصاً، لكن من المفيد سؤال طبيبك عن تحليل دم بسيط (CBC) للتحقق من فقر الدم.",
    steadyAdvice: "لون جفنك قريب من المعتاد. استمر في تناول الأطعمة الغنية بالحديد (العدس والخضار الورقية واللحم أو السمك) وافحص مجدداً الأسبوع القادم.",
    learningAdvice: "شكراً — تم حفظ القراءة. قم بالفحص مرة أسبوعياً في إضاءة مشابهة لتتعرف شفاء على لونك المعتاد.",
    careShared: "يستطيع مرافقك وطبيبك رؤية هذا الاتجاه.",
    careAlerted: "تمت مشاركة هذا التغيّر مع فريق رعايتك.",
    retryTitle: "لنُعِد التقاط الصورة",
    issue_small: "اضغط أقرب إلى منتصف الطرف الوردي، وقرّب الكاميرا قليلاً.",
    issue_glare: "هناك لمعان — استدر قليلاً بعيداً عن الضوء.",
    issue_dark: "الصورة مظلمة — واجه نافذة أو شغّل ضوءاً أبيض.",
    issue_bright: "الصورة ساطعة جداً — ابتعد عن الضوء المباشر.",
    issue_not_eyelid: "تلك النقطة لا تبدو باطن الجفن. اسحب الجفن أكثر قليلاً واضغط على الطرف الوردي.",
    issue_no_region: "لم نتمكن من قراءة تلك النقطة — اضغط مرة أخرى.",
    saved: "تم الحفظ", again: "افحص مجدداً", trend: "لون جفنك مع الوقت",
    simulate: "لا توجد كاميرا؟ استخدم قراءة تجريبية (للعرض فقط)", simulated: "قراءة تجريبية — للعرض فقط",
    cameraError: "الكاميرا غير متاحة. اسمح باستخدام الكاميرا ثم حاول مجدداً.",
    readAloud: "اقرأ بصوت",
  },
};

export default function EyelidCheck() {
  const { user } = useAuth();
  const [lang, setLang] = useLocalStorage("shifa_checkin_lang", defaultLang());
  const T = S[lang] || S.en;
  const t = (k, v) => { let s = T[k] ?? S.en[k] ?? k; if (v) for (const [a, b] of Object.entries(v)) s = s.replace(`{${a}}`, b); return s; };

  const videoRef = useRef(null);
  const photoRef = useRef(null);
  const frame = useRef(null);   // { data, width, height, gains }
  const streamRef = useRef(null);
  const [phase, setPhase] = useState("idle"); // idle | live | countdown | tapLid | tapSkin | result | retry | error
  const [count, setCount] = useState(3);
  const [taps, setTaps] = useState([]);
  const [reading, setReading] = useState(null);
  const [saved, setSaved] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState("");

  const loadHistory = () => api.pallorHistory(user.id).then(setHistory).catch(() => {});
  useEffect(() => { loadHistory(); return () => stopCamera(); }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function stopCamera() {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }

  async function startCamera() {
    setError(""); setReading(null); setSaved(null); setTaps([]);
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      setPhase("live");
      requestAnimationFrame(async () => {
        videoRef.current.srcObject = streamRef.current;
        await videoRef.current.play().catch(() => {});
      });
    } catch {
      setPhase("error");
    }
  }

  function countdownCapture() {
    setPhase("countdown");
    let n = 3; setCount(n);
    const id = setInterval(() => {
      n -= 1; setCount(n);
      if (n <= 0) { clearInterval(id); capture(); }
    }, 1000);
  }

  function capture() {
    const v = videoRef.current;
    const w = v.videoWidth, h = v.videoHeight;
    if (!w) { setPhase("error"); return; }
    const c = photoRef.current;
    c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(v, 0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    frame.current = { data: img.data, width: w, height: h, gains: greyWorldGains(img.data), image: img };
    stopCamera();
    setTaps([]);
    setPhase("tapLid");
  }

  function redraw(points) {
    const f = frame.current, c = photoRef.current;
    if (!f || !c) return;
    const g = c.getContext("2d");
    g.putImageData(f.image, 0, 0);
    const r = radius();
    points.forEach((p, i) => {
      g.lineWidth = Math.max(3, f.width / 300);
      g.strokeStyle = i === 0 ? "#f43f5e" : "#0ea5e9";
      g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.stroke();
    });
  }
  const radius = () => Math.max(6, Math.round(Math.min(frame.current.width, frame.current.height) * 0.018));

  function onPhotoTap(e) {
    if (phase !== "tapLid" && phase !== "tapSkin") return;
    const c = photoRef.current, rect = c.getBoundingClientRect();
    // The photo is shown mirrored (like the live preview), so flip x back.
    const x = (1 - (e.clientX - rect.left) / rect.width) * c.width;
    const y = ((e.clientY - rect.top) / rect.height) * c.height;
    const next = [...taps, { x, y }];
    setTaps(next);
    redraw(next);
    if (next.length === 1) { setPhase("tapSkin"); return; }
    const f = frame.current, r = radius();
    const lid = regionLab(f.data, f.width, f.height, next[0].x, next[0].y, r, f.gains);
    const skin = regionLab(f.data, f.width, f.height, next[1].x, next[1].y, r * 1.6, f.gains);
    const result = pallorReading(lid, skin);
    setReading({ ...result, source: "camera" });
    if (result.ok) save({ ...result, source: "camera" });
    else setPhase("retry");
  }

  async function save(r) {
    setPhase("result");
    try {
      const res = await api.savePallor({
        patient_id: user.id, eyelid_index: r.eyelid_index, skin_index: r.skin_index,
        relative_index: r.relative_index, quality: r.quality, source: r.source,
      });
      setSaved(res);
      loadHistory();
    } catch (e) { setError(e.message); }
  }

  function simulate() {
    // Clearly-labelled demo value near this person's own baseline (or a typical
    // value when there is none yet). Stored with source "demo".
    const base = history?.analysis?.ready ? history.analysis.baseline : 17;
    const rel = Math.round((base + (Math.random() - 0.5) * 2) * 10) / 10;
    const r = { ok: true, eyelid_index: Math.round((14 + rel) * 10) / 10, skin_index: 14, relative_index: rel, quality: 0.9, source: "demo" };
    setReading(r); setTaps([]);
    save(r);
  }

  function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === "ar" ? "ar-SA" : "en-US";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  }

  const a = saved?.analysis;
  const advice = !a ? "" : !a.ready ? t("learningAdvice") : a.has_concern ? t("palerAdvice") : t("steadyAdvice");
  const showPhoto = ["tapLid", "tapSkin", "retry"].includes(phase) || (phase === "result" && taps.length === 2);
  const live = phase === "live" || phase === "countdown";

  return (
    <div className="grid checkin" style={{ gap: 20 }} dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
      <div className="page-head row between" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        <div>
          <h1>👁️ {t("title")}</h1>
          <p>{t("subtitle")}</p>
        </div>
        <div className="checkin-lang" role="group" aria-label="Language">
          <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>English</button>
          <button className={lang === "ar" ? "active" : ""} onClick={() => setLang("ar")}>العربية</button>
        </div>
      </div>

      <div className="checkin-banner"><ShieldCheck size={17} /> {t("disclaimer")}</div>
      <ErrorNote message={error} />

      <div className="grid cols-2 checkin-split">
        <div className="card">
          <div className="checkin-stage eyelid-stage">
            <video ref={videoRef} muted playsInline className="checkin-video" style={{ display: live ? "block" : "none" }} />
            <canvas ref={photoRef} className="eyelid-photo" onClick={onPhotoTap}
              style={{ display: showPhoto ? "block" : "none", cursor: phase.startsWith("tap") ? "crosshair" : "default" }} />
            {live && <div className="eyelid-guide" aria-hidden="true"><span /></div>}
            {phase === "countdown" && <div className="checkin-countdown">{count}</div>}
            {(phase === "tapLid" || phase === "tapSkin") && (
              <div className="checkin-stage-foot">
                <span className={"badge " + (phase === "tapLid" ? "red" : "")} style={phase === "tapSkin" ? { background: "#0ea5e9", color: "#fff" } : undefined}>
                  {phase === "tapLid" ? `1 · ${t("tapLid")}` : `2 · ${t("tapSkin")}`}
                </span>
              </div>
            )}
            {!live && !showPhoto && phase !== "error" && <div className="checkin-stage-msg"><Eye size={36} /></div>}
            {phase === "error" && <div className="checkin-stage-msg">⚠️ {t("cameraError")}</div>}
          </div>
          <div className="checkin-disclaimer" style={{ color: "var(--muted)", fontWeight: 600 }}><Lock size={15} /> {t("onDevice")}</div>

          <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            {(phase === "idle" || phase === "error") && <button className="btn gradient lg" onClick={startCamera}><Camera size={17} /> {t("start")}</button>}
            {phase === "live" && <button className="btn gradient lg" onClick={countdownCapture}><Camera size={17} /> {t("capture")}</button>}
            {["tapLid", "tapSkin", "retry", "result"].includes(phase) && (
              <button className="btn secondary" onClick={startCamera}><RotateCcw size={16} /> {phase === "result" ? t("again") : t("retake")}</button>
            )}
          </div>
          {(phase === "idle" || phase === "error") && <button className="checkin-link" onClick={simulate}>{t("simulate")}</button>}
        </div>

        <div className="grid" style={{ gap: 14, alignContent: "start" }}>
          {(phase === "idle" || live || phase === "error") && (
            <div className="card">
              <ol className="eyelid-steps">
                <li><Sun size={18} /> {t("how1")}</li>
                <li><Hand size={18} /> {t("how2")}</li>
                <li><Eye size={18} /> {t("how3")}</li>
              </ol>
            </div>
          )}

          {phase === "retry" && reading && (
            <div className="card checkin-warn">
              <h3 className="card-title">{t("retryTitle")}</h3>
              <p style={{ margin: 0 }}>{t(`issue_${reading.reason || "no_region"}`)}</p>
            </div>
          )}

          {phase === "result" && reading && (
            <>
              <div className="card">
                <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
                  <div className="muted checkin-vital-label">{t("score")}</div>
                  {saved && <span className="badge green">✓ {t("saved")}</span>}
                </div>
                <div className="checkin-vital-value">{Math.round(reading.relative_index)}</div>
                <span className="badge gray">{t("quality")} {Math.round(reading.quality * 100)}%</span>
                {reading.source === "demo" && <p className="muted" style={{ fontSize: ".8rem", marginBottom: 0 }}>🧪 {t("simulated")}</p>}
                {a && (
                  <div style={{ marginTop: 12 }}>
                    <div className="muted" style={{ fontSize: ".82rem", fontWeight: 700 }}>{t("vsBaseline")}</div>
                    {a.ready ? (
                      <span className={"badge " + (a.has_concern ? "red" : a.direction === "steady" ? "green" : "amber")}>
                        {t(a.direction)} ({a.delta > 0 ? "+" : ""}{Math.round(a.delta)})
                      </span>
                    ) : (
                      <p className="muted" style={{ margin: "4px 0 0" }}>{t("learning", { n: Math.max(1, a.needed - a.count) })}</p>
                    )}
                  </div>
                )}
              </div>
              {advice && (
                <div className={"card " + (a?.has_concern ? "checkin-warn" : "checkin-habit")}>
                  <p className="checkin-explain" style={{ marginTop: 0 }}>{advice}</p>
                  <div className="row between" style={{ gap: 8, flexWrap: "wrap" }}>
                    <span className="checkin-care" style={{ margin: 0 }}><Users size={15} /> {a?.has_concern ? t("careAlerted") : t("careShared")}</span>
                    <button className="btn secondary sm" onClick={() => speak(advice)}>🔊 {t("readAloud")}</button>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="card">
            <h3 className="card-title"><Info size={17} style={{ verticalAlign: "-3px" }} /> {t("why")}</h3>
            <p className="muted" style={{ margin: 0, lineHeight: 1.65 }}>{t("whyBody")}</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">{t("trend")}</h3>
        <p className="card-sub">{t("careShared")}</p>
        {history?.readings?.length
          ? <PallorChart readings={history.readings} analysis={history.analysis} lang={lang} baselineLabel={lang === "ar" ? "المعتاد" : "your usual"} />
          : <p className="muted">{t("learning", { n: 3 })}</p>}
      </div>
    </div>
  );
}
