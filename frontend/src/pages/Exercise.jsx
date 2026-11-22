import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Send, Sparkles, Volume2, Target, RotateCcw } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../api/client.js";
import { useLang } from "../context/LanguageContext.jsx";
import { exerciseStrings } from "../data/exerciseStrings.js";
import { EXERCISE_LIST } from "../lib/exerciseEngine.js";
import PoseCoach from "../components/exercise/PoseCoach.jsx";
import { ErrorNote } from "../components/ui.jsx";

const LEVEL = { squat: "beginner", curl: "beginner", lunge: "intermediate" };
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function Exercise() {
  const { user } = useAuth();
  const [lang, setLang] = useLang();
  const t = exerciseStrings(lang);
  const [selected, setSelected] = useState("squat");
  const [runKey, setRunKey] = useState(0);
  const [summary, setSummary] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState("");
  const [chat, setChat] = useState([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const chatEnd = useRef(null);

  useEffect(() => { api.exerciseSessions(user.id).then(setSessions).catch(() => {}); }, [user.id]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [chat, thinking]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  async function onFinish(result) {
    setSummary(result);
    if (result.reps + result.partial_reps + result.too_fast === 0) return; // nothing happened — don't store an empty session
    try {
      const { notes, ...payload } = result;
      await api.saveExerciseSession({ patient_id: user.id, ...payload });
      setSessions(await api.exerciseSessions(user.id));
    } catch (e) { setError(e.message); }
  }

  async function ask(text) {
    const message = (text ?? draft).trim();
    if (!message || thinking) return;
    setDraft("");
    const history = chat.slice(-8);
    setChat((c) => [...c, { role: "user", text: message }]);
    setThinking(true);
    try {
      const res = await api.exerciseCoach({ patient_id: user.id, message, lang, history });
      setChat((c) => [...c, { role: "coach", text: res.reply }]);
    } catch (e) {
      setChat((c) => [...c, { role: "coach", text: `⚠️ ${e.message}` }]);
    } finally { setThinking(false); }
  }

  function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === "ar" ? "ar-SA" : "en-US";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  }

  const best = (id) => Math.max(-1, ...sessions.filter((s) => s.exercise === id).map((s) => s.form_consistency));
  const pick = (id) => { setSelected(id); setSummary(null); setRunKey((k) => k + 1); };

  return (
    <div className="grid checkin" style={{ gap: 20 }} dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
      <div className="page-head row between" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        <div>
          <h1>🏃 {t("title")}</h1>
          <p>{t("subtitle")}</p>
        </div>
        <div className="checkin-lang" role="group" aria-label="Language">
          <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>English</button>
          <button className={lang === "ar" ? "active" : ""} onClick={() => setLang("ar")}>العربية</button>
        </div>
      </div>

      <div className="checkin-banner"><ShieldCheck size={17} /> {t("disclaimer")}</div>
      <ErrorNote message={error} />

      <div className="grid cols-3">
        {EXERCISE_LIST.map((ex) => {
          const on = selected === ex.id;
          const b = best(ex.id);
          return (
            <button key={ex.id} className={"card exercise-pick" + (on ? " on" : "")} aria-pressed={on} onClick={() => pick(ex.id)}>
              <div className="row between">
                <span className="exercise-pick-icon">{ex.icon}</span>
                <span className={"badge " + (on ? "green" : "gray")}>{on ? t("selected") : t(LEVEL[ex.id])}</span>
              </div>
              <div className="exercise-pick-name">{t(ex.id)}</div>
              <div className="muted" style={{ fontSize: ".86rem" }}>{t(`${ex.id}_sub`)}</div>
              <div className="exercise-pick-meta"><Target size={14} /> {ex.targetReps} {t("reps")}{b >= 0 ? ` · ${t("best")} ${b}%` : ""}</div>
            </button>
          );
        })}
      </div>

      <div className="grid cols-2 checkin-split">
        <div className="grid" style={{ gap: 14, alignContent: "start" }}>
          {!summary ? (
            <PoseCoach key={`${selected}-${runKey}`} exerciseId={selected} t={t} lang={lang} onFinish={onFinish} />
          ) : (
            <div className="card">
              <h3 className="card-title">{t("summary")} · {t(summary.exercise)}</h3>
              <div className="checkin-move-summary" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                <div><b>{summary.reps}/{summary.target_reps}</b><span>{t("reps")}</span></div>
                <div><b>{summary.form_consistency}%</b><span>{t("form")}</span></div>
                <div><b>{summary.tracking_quality}%</b><span>{t("tracking")}</span></div>
                <div><b>{mmss(summary.duration_seconds)}</b><span>{t("duration")}</span></div>
              </div>
              <ul className="checkin-list" style={{ color: "inherit" }}>
                {(summary.notes.length ? summary.notes : ["note_strong"]).map((n) => <li key={n}>{t(n)}</li>)}
              </ul>
              <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                <button
                  className="btn gradient"
                  onClick={() => ask(t("reviewPrompt", { reps: summary.reps, target: summary.target_reps, name: t(summary.exercise), form: summary.form_consistency }))}
                >
                  <Sparkles size={16} /> {t("askCoach")}
                </button>
                <button className="btn secondary" onClick={() => pick(selected)}><RotateCcw size={16} /> {t("again")}</button>
              </div>
            </div>
          )}

          <div className="card">
            <h3 className="card-title">{t("recent")}</h3>
            {sessions.length === 0 ? (
              <p className="muted" style={{ margin: "6px 0 0" }}>{t("noSessions")}</p>
            ) : (
              sessions.slice(0, 6).map((s) => (
                <div key={s.id} className="exercise-row">
                  <div>
                    <div style={{ fontWeight: 700 }}>{t(s.exercise)}</div>
                    <div className="muted" style={{ fontSize: ".78rem" }}>
                      {new Date(s.completed_at + "Z").toLocaleString(lang === "ar" ? "ar-AE" : undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  <div style={{ fontWeight: 700 }}>{s.reps}/{s.target_reps} <span className="muted" style={{ fontWeight: 400 }}>{t("reps")}</span></div>
                  <span className={"badge " + (s.form_consistency >= 75 ? "green" : s.form_consistency >= 50 ? "amber" : "red")}>{t("form")} {s.form_consistency}%</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card exercise-coach">
          <h3 className="card-title"><Sparkles size={18} style={{ verticalAlign: "-3px" }} /> {t("coach")}</h3>
          <p className="card-sub">{t("coachSub")}</p>
          <div className="exercise-chat" aria-live="polite">
            <div className="exercise-msg coach">{t("coachHello")}</div>
            {chat.map((m, i) => (
              <div key={i} className={"exercise-msg " + m.role}>
                {m.text}
                {m.role === "coach" && (
                  <button className="exercise-speak" onClick={() => speak(m.text)} aria-label={t("readAloud")} title={t("readAloud")}><Volume2 size={14} /></button>
                )}
              </div>
            ))}
            {thinking && <div className="exercise-msg coach pulse">{t("thinking")}</div>}
            <div ref={chatEnd} />
          </div>
          <div className="exercise-quick">
            {["q1", "q2", "q3"].map((q) => (
              <button key={q} onClick={() => ask(t(q))} disabled={thinking}>{t(q)}</button>
            ))}
          </div>
          <form className="exercise-input" onSubmit={(e) => { e.preventDefault(); ask(); }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("placeholder")} aria-label={t("placeholder")} maxLength={1000} />
            <button className="btn gradient" type="submit" disabled={thinking || !draft.trim()}><Send size={16} /> {t("send")}</button>
          </form>
        </div>
      </div>
    </div>
  );
}
