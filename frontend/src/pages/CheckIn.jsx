import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Volume2, Square, Sparkles, Info, Users, RotateCcw } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../api/client.js";
import { useLang } from "../context/LanguageContext.jsx";
import LangSwitch from "../components/LangSwitch.jsx";
import { speechLang } from "../i18n/translator.js";
import { strings } from "../data/checkinStrings.js";
import { toCheckinPayload } from "../lib/vitalsSummary.js";
import VitalsScan, { VitalTile } from "../components/checkin/VitalsScan.jsx";
import MovementCheck from "../components/checkin/MovementCheck.jsx";
import { BaselineChips, TrendChart } from "../components/checkin/CheckinTrend.jsx";
import { ErrorNote } from "../components/ui.jsx";

export default function CheckIn() {
  const { user } = useAuth();
  const [lang, setLang] = useLang();
  const t = strings(lang);
  const [step, setStep] = useState(1);
  const [vitals, setVitals] = useState(null);     // scan summary or null (skipped)
  const [movement, setMovement] = useState(null);
  const [saved, setSaved] = useState(null);       // { checkin, analysis }
  const [history, setHistory] = useState(null);
  const [explain, setExplain] = useState(null);
  const [explaining, setExplaining] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.checkinHistory(user.id).then(setHistory).catch(() => {});
    return () => window.speechSynthesis?.cancel();
  }, [user.id]);

  async function fetchExplanation(id, language) {
    setExplaining(true); setExplain(null);
    try { setExplain(await api.explainCheckin(id, language)); }
    catch (e) { setError(e.message); }
    finally { setExplaining(false); }
  }

  // Steps 1 + 2 are collected on-device; ONE request stores the numbers.
  async function finish(move) {
    setMovement(move);
    setStep(3);
    setError("");
    const payload = { patient_id: user.id, ...(vitals ? toCheckinPayload(vitals) : { source: "posture-only" }), ...(move || {}) };
    const nothing = !vitals && !Object.values(move || {}).some((v) => v != null);
    if (nothing) return;
    try {
      const res = await api.saveCheckin(payload);
      setSaved(res);
      api.checkinHistory(user.id).then(setHistory).catch(() => {});
      fetchExplanation(res.checkin.id, lang);
    } catch (e) { setError(e.message); }
  }

  function switchLang(next) {
    setLang(next);
    window.speechSynthesis?.cancel(); setSpeaking(false);
    if (saved && step === 3) fetchExplanation(saved.checkin.id, next);
  }

  function readAloud() {
    if (!window.speechSynthesis || !explain) return;
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(`${explain.explanation} ${t("habitTitle")}: ${explain.habit}`);
    u.lang = speechLang(lang);
    u.rate = 0.92;
    u.onend = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  }

  function restart() {
    window.speechSynthesis?.cancel();
    setStep(1); setVitals(null); setMovement(null); setSaved(null); setExplain(null); setError("");
  }

  const analysis = saved?.analysis || history?.analysis;
  const steps = [t("step1"), t("step2"), t("step3")];

  return (
    <div className="grid checkin" style={{ gap: 20 }} dir={lang === "en" ? "ltr" : "rtl"} lang={lang}>
      <div className="page-head row between" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        <div>
          <h1>🩺 {t("title")}</h1>
          <p>{t("subtitle")}</p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <LangSwitch onChange={switchLang} />
          <Link className="btn secondary sm" to="/check-in/about"><Info size={15} /> {t("howItWorks")}</Link>
        </div>
      </div>

      <div className="checkin-banner"><ShieldCheck size={17} /> {t("disclaimer")}</div>

      <ol className="checkin-steps">
        {steps.map((label, i) => (
          <li key={label} className={step === i + 1 ? "active" : step > i + 1 ? "done" : ""}>
            <span>{step > i + 1 ? "✓" : i + 1}</span> {label}
          </li>
        ))}
      </ol>

      <ErrorNote message={error} />

      {step === 1 && (
        <VitalsScan t={t} onDone={(s) => { setVitals(s); setStep(2); }} onSkip={() => { setVitals(null); setStep(2); }} />
      )}

      {step === 2 && <MovementCheck t={t} lang={lang} onDone={finish} onSkip={() => finish(null)} />}

      {step === 3 && (
        <>
          <div className="grid cols-2 checkin-split">
            <div className="grid" style={{ gap: 14, alignContent: "start" }}>
              <div className="card">
                <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
                  <h3 className="card-title">{t("resultsTitle")}</h3>
                  {saved && <span className="badge green">✓ {t("saved")}</span>}
                </div>
                <div className="grid cols-3 checkin-vitals" style={{ marginTop: 10 }}>
                  <VitalTile t={t} label={t("heartRate")} unit={t("bpm")} metric={vitals?.heart_rate} />
                  <VitalTile t={t} label={t("breathing")} unit={t("brpm")} metric={vitals?.respiratory_rate} />
                  <VitalTile t={t} label={t("hrv")} unit={t("ms")} metric={vitals?.hrv_sdnn} emptyText={t("hrvUnavailable")} />
                </div>
                {movement && (
                  <div className="checkin-move-summary">
                    <div><b>{movement.posture_score == null ? "—" : `${movement.posture_score}%`}</b><span>{t("posture")} · {t("uprightTime")}</span></div>
                    <div><b>{movement.sit_to_stand_reps ?? 0}</b><span>{t("sitToStand")}</span></div>
                    <div><b>{movement.shoulder_roll_reps ?? 0}</b><span>{t("shoulderRolls")}</span></div>
                  </div>
                )}
                {vitals?.source === "demo" && <p className="muted" style={{ fontSize: ".8rem", marginBottom: 0 }}>🧪 {t("simulated")}</p>}
                {vitals?.source === "pos-fallback" && <p className="muted" style={{ fontSize: ".8rem", marginBottom: 0 }}>ℹ️ {t("fallbackNote")}</p>}
                <div className="checkin-disclaimer"><ShieldCheck size={15} /> {t("disclaimer")}</div>
              </div>

              <div className="card">
                <h3 className="card-title">{t("baselineTitle")}</h3>
                <div style={{ marginTop: 8 }}>{analysis ? <BaselineChips analysis={analysis} t={t} /> : <p className="muted pulse">…</p>}</div>
                <p className="checkin-care">
                  <Users size={15} /> {saved?.analysis?.has_concern ? t("careAlerted") : t("careShared")}
                </p>
              </div>
            </div>

            <div className="grid" style={{ gap: 14, alignContent: "start" }}>
              <div className="card checkin-companion">
                <div className="row between" style={{ gap: 8, flexWrap: "wrap" }}>
                  <h3 className="card-title"><Sparkles size={18} style={{ verticalAlign: "-3px" }} /> {t("companionTitle")}</h3>
                  {explain && (
                    <button className="btn secondary sm" onClick={readAloud}>
                      {speaking ? <><Square size={14} /> {t("stop")}</> : <><Volume2 size={15} /> {t("readAloud")}</>}
                    </button>
                  )}
                </div>
                {explaining && <p className="muted pulse">{t("thinking")}</p>}
                {explain && <p className="checkin-explain">{explain.explanation}</p>}
                {!explaining && !explain && !saved && <p className="muted">{t("noHistory")}</p>}
              </div>
              {explain && (
                <div className="card checkin-habit">
                  <div className="checkin-habit-label">🌱 {t("habitTitle")}</div>
                  <div className="checkin-habit-text">{explain.habit}</div>
                </div>
              )}
              <button className="btn secondary" onClick={restart} style={{ justifySelf: "start" }}>
                <RotateCcw size={16} /> {t("again")}
              </button>
            </div>
          </div>
        </>
      )}

      <div className="card">
        <h3 className="card-title">{t("trendTitle")}</h3>
        <p className="card-sub">{t("careShared")}</p>
        {history ? <TrendChart checkins={history.checkins} analysis={history.analysis} t={t} lang={lang} /> : <p className="muted pulse">…</p>}
      </div>
    </div>
  );
}
