import { useEffect, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { ShieldCheck } from "lucide-react";
import { api } from "../../api/client.js";

/** Line chart of eyelid redness score over time, with the personal baseline. */
export function PallorChart({ readings, analysis, lang = "en", height = 200, baselineLabel = "baseline" }) {
  const data = (readings || []).map((r) => ({
    when: new Date(r.created_at + "Z").toLocaleDateString(lang === "ar" ? "ar-AE" : undefined, { month: "short", day: "numeric" }),
    score: r.relative_index,
  }));
  if (!data.length) return null;
  return (
    <div dir="ltr">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="when" tick={{ fontSize: 11 }} minTickGap={16} />
          <YAxis tick={{ fontSize: 11 }} domain={["dataMin - 4", "dataMax + 4"]} allowDecimals={false} />
          <Tooltip />
          {analysis?.ready && (
            <ReferenceLine y={analysis.baseline} stroke="#64748b" strokeDasharray="5 4"
              label={{ value: `${baselineLabel} ${Math.round(analysis.baseline)}`, fontSize: 11, fill: "#64748b", position: "insideTopLeft" }} />
          )}
          <Line type="monotone" dataKey="score" name="Eyelid redness" stroke="#e11d48" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Self-fetching card for the Primary Carer and doctor dashboards. */
export default function PallorTrendCard({ patientId, patientName }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setData(null); setError("");
    const load = () => api.pallorHistory(patientId).then((d) => alive && setData(d)).catch((e) => alive && setError(e.message));
    load();
    const id = setInterval(load, 20000);
    return () => { alive = false; clearInterval(id); };
  }, [patientId]);

  const a = data?.analysis;
  return (
    <div className="card">
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <div>
          <h3 className="card-title">👁️ Eyelid colour trend</h3>
          <p className="card-sub">{patientName ? `${patientName} · ` : ""}inner-eyelid redness vs their own baseline (anemia prompt)</p>
        </div>
        {a && (
          <span className={"badge " + (!a.ready ? "gray" : a.has_concern ? "red" : "green")}>
            {!a.ready ? `Learning baseline (${a.count}/${a.needed})` : a.has_concern ? "Paler than usual" : "Within baseline"}
          </span>
        )}
      </div>
      {error && <p className="muted">⚠️ {error}</p>}
      {!data && !error && <p className="muted pulse">Loading…</p>}
      {data && (
        <>
          {a?.alert && <div className="checkin-alert concern">⚠️ {a.alert.message_en}</div>}
          {data.readings.length ? <PallorChart readings={data.readings} analysis={a} /> : <p className="muted">No eyelid checks yet.</p>}
          <div className="checkin-disclaimer"><ShieldCheck size={15} /> Wellness prompt, not a diagnosis — only a blood test (CBC) can confirm anemia.</div>
        </>
      )}
    </div>
  );
}
