import { useEffect, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Legend } from "recharts";
import { TrendingUp, TrendingDown, Minus, ShieldCheck } from "lucide-react";
import { api } from "../../api/client.js";
import { strings } from "../../data/checkinStrings.js";

const DIR_ICON = { up: TrendingUp, down: TrendingDown, steady: Minus };

/** Baseline chips: the person compared with THEIR OWN usual numbers. */
export function BaselineChips({ analysis, t }) {
  const rows = [
    ["heart_rate", t("heartRate"), t("bpm")],
    ["respiratory_rate", t("breathing"), t("brpm")],
    ["hrv_sdnn", t("hrv"), t("ms")],
  ].filter(([k]) => analysis?.metrics?.[k]);
  const ready = rows.filter(([k]) => analysis.metrics[k].ready);
  if (!ready.length) {
    const m = analysis?.metrics?.heart_rate;
    const n = m ? Math.max(1, (m.needed || 5) - (m.count || 0)) : 5;
    return <p className="muted" style={{ margin: 0 }}>{t("baselineLearning", { n })}</p>;
  }
  return (
    <div className="checkin-baselines">
      {ready.map(([k, label, unit]) => {
        const m = analysis.metrics[k];
        const Icon = DIR_ICON[m.direction];
        const tone = m.direction === "steady" ? "green" : m.concerning ? "red" : "amber";
        return (
          <div key={k} className="checkin-baseline">
            <div style={{ fontWeight: 700 }}>{label}</div>
            <div className="muted" style={{ fontSize: ".82rem" }}>
              {t("baseline")} {Math.round(m.baseline)} · {t("recent")} {Math.round(m.recent)} {unit}
            </div>
            <span className={"badge " + tone}>
              <Icon size={13} style={{ verticalAlign: "-2px" }} /> {t(m.direction)}
              {m.direction !== "steady" ? ` (${m.delta > 0 ? "+" : ""}${Math.round(m.delta)})` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Line chart of check-ins over time with the personal heart-rate baseline. */
export function TrendChart({ checkins, analysis, t, lang = "en", height = 240 }) {
  const data = (checkins || []).map((c) => ({
    when: new Date(c.created_at + (c.created_at.endsWith("Z") ? "" : "Z")).toLocaleDateString(lang === "ar" ? "ar-AE" : undefined, { month: "short", day: "numeric" }),
    hr: c.heart_rate, rr: c.respiratory_rate, posture: c.posture_score,
  }));
  if (!data.length) return <p className="muted">{t("noHistory")}</p>;
  const base = analysis?.metrics?.heart_rate?.ready ? analysis.metrics.heart_rate.baseline : null;
  return (
    <div dir="ltr">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: -18, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="when" tick={{ fontSize: 11 }} minTickGap={18} />
          <YAxis yAxisId="hr" tick={{ fontSize: 11, fill: "#ef4444" }} domain={["dataMin - 6", "dataMax + 6"]} allowDecimals={false} />
          <YAxis yAxisId="rr" orientation="right" tick={{ fontSize: 11, fill: "#2563eb" }} domain={["dataMin - 6", "dataMax + 6"]} allowDecimals={false} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {base != null && (
            <ReferenceLine yAxisId="hr" y={base} stroke="#64748b" strokeDasharray="5 4" label={{ value: `${t("baseline")} ${Math.round(base)}`, fontSize: 11, fill: "#64748b", position: "insideTopLeft" }} />
          )}
          <Line yAxisId="hr" type="monotone" dataKey="hr" name={`${t("heartRate")} (${t("bpm")})`} stroke="#ef4444" strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
          <Line yAxisId="rr" type="monotone" dataKey="rr" name={`${t("breathing")} (${t("brpm")})`} stroke="#2563eb" strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Self-fetching card for the Primary Carer and doctor dashboards:
 * the patient's check-in trend plus any drift from their own baseline.
 */
export default function CheckinTrendCard({ patientId, patientName }) {
  const t = strings("en");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setData(null); setError("");
    const load = () => api.checkinHistory(patientId).then((d) => alive && setData(d)).catch((e) => alive && setError(e.message));
    load();
    const id = setInterval(load, 20000); // pick up a new check-in while the dashboard is open
    return () => { alive = false; clearInterval(id); };
  }, [patientId]);

  const alerts = data?.analysis?.alerts || [];
  const last = data?.checkins?.[data.checkins.length - 1];
  return (
    <div className="card">
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <div>
          <h3 className="card-title">📷 Daily Check-in trend</h3>
          <p className="card-sub">
            {patientName ? `${patientName} · ` : ""}camera wellness estimates vs their own baseline
            {last ? ` · last check-in ${new Date(last.created_at + "Z").toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
          </p>
        </div>
        {data && (
          <span className={"badge " + (data.analysis.has_concern ? "red" : alerts.length ? "amber" : "green")}>
            {data.analysis.has_concern ? "Drifting from baseline" : alerts.length ? "Changed from baseline" : "Within baseline"}
          </span>
        )}
      </div>

      {error && <p className="muted">⚠️ {error}</p>}
      {!data && !error && <p className="muted pulse">Loading…</p>}
      {data && (
        <>
          {alerts.map((a) => (
            <div key={a.metric} className={"checkin-alert" + (a.concerning ? " concern" : "")}>
              {a.concerning ? "⚠️" : "ℹ️"} {a.message_en}
            </div>
          ))}
          <TrendChart checkins={data.checkins} analysis={data.analysis} t={t} />
          {data.checkins.length > 0 && <BaselineChips analysis={data.analysis} t={t} />}
          <div className="checkin-disclaimer"><ShieldCheck size={15} /> {t("disclaimer")}</div>
        </>
      )}
    </div>
  );
}
