import { Link } from "react-router-dom";
import { ScanFace, Armchair, Sparkles, Lock, AlertTriangle, Users, ArrowLeft } from "lucide-react";
import { useLocalStorage } from "../hooks/useLocalStorage.js";
import { defaultLang } from "../data/checkinStrings.js";

const COPY = {
  en: {
    title: "How the Daily Check-in works — and its limits",
    sub: "Short, honest, and in plain language.",
    back: "Back to Daily Check-in",
    cards: [
      { icon: ScanFace, title: "Camera vitals", body: "A 30-second face scan estimates heart rate and breathing rate from tiny colour changes in your skin (VitalLens API). Heart rate variability appears only when the service provides it. Every number comes with a confidence value; if confidence is low we ask you to retry and save nothing." },
      { icon: Armchair, title: "Posture & movement", body: "MediaPipe Pose runs inside your browser to notice slouching or a forward head, remind you to move after sitting, and count two gentle moves — chair sit-to-stand and shoulder rolls — with form tips." },
      { icon: Sparkles, title: "Your companion explains", body: "Shifa' compares today's numbers with YOUR OWN usual baseline (not an average person), explains them in Arabic or English, and suggests one small habit for the week." },
      { icon: Users, title: "Your care circle", body: "Your Primary Carer and doctor can see the trend. If a reading drifts from your baseline they get a gentle alert — at most once a day." },
    ],
    privacyTitle: "Privacy",
    privacy: [
      "Posture and movement video is processed on this device only. It is never uploaded and never stored.",
      "For camera vitals, short bursts of small face frames are sent securely to the VitalLens service to compute the estimate. Shifa' does not store video or images — only the resulting numbers and a timestamp.",
      "If VitalLens is unavailable, an open-source method runs on your device instead (heart rate only).",
      "The camera is only on while a scan or check is running, and you can stop at any time.",
    ],
    limitsTitle: "Limits — please read",
    limits: [
      "These are wellness estimates, not a medical diagnosis, and Shifa' is not a medical device.",
      "We do not measure blood pressure, blood oxygen or blood sugar.",
      "Lighting, movement, make-up, skin tone and camera quality all affect accuracy.",
      "Posture checks use a single front camera, so they are approximate.",
      "A change from your baseline is a prompt to pay attention — not a conclusion. Never change medication because of a check-in.",
      "If you feel chest pain, severe breathlessness, fainting or sudden weakness, call 999 immediately.",
    ],
  },
  ar: {
    title: "كيف يعمل الفحص اليومي — وما حدوده",
    sub: "شرح قصير وصريح وبلغة بسيطة.",
    back: "العودة إلى الفحص اليومي",
    cards: [
      { icon: ScanFace, title: "قياسات الكاميرا", body: "فحص للوجه لمدة ٣٠ ثانية يقدّر نبض القلب ومعدل التنفس من تغيّرات لونية دقيقة في البشرة (خدمة VitalLens). يظهر تقلب نبض القلب فقط إذا وفّرته الخدمة. كل رقم يأتي مع درجة ثقة؛ وإذا كانت الثقة منخفضة نطلب إعادة المحاولة ولا نحفظ شيئاً." },
      { icon: Armchair, title: "الجلسة والحركة", body: "يعمل MediaPipe Pose داخل المتصفح ليلاحظ انحناء الظهر أو ميل الرأس للأمام، ويذكّرك بالحركة بعد الجلوس الطويل، ويعدّ حركتين خفيفتين — الجلوس والوقوف من الكرسي وتدوير الكتفين — مع نصائح للأداء." },
      { icon: Sparkles, title: "شفاء تشرح لك", body: "تقارن شفاء أرقام اليوم بمعدلك الشخصي المعتاد (وليس بمتوسط الناس)، وتشرحها بالعربية أو الإنجليزية، وتقترح عادة صغيرة واحدة للأسبوع." },
      { icon: Users, title: "دائرة رعايتك", body: "يستطيع مرافقك وطبيبك رؤية الاتجاه. وإذا ابتعدت قراءة عن معدلك المعتاد يصلهم تنبيه لطيف — مرة واحدة في اليوم على الأكثر." },
    ],
    privacyTitle: "الخصوصية",
    privacy: [
      "فيديو الجلسة والحركة يُعالَج على هذا الجهاز فقط. لا يُرفع ولا يُحفظ أبداً.",
      "لقياسات الكاميرا، تُرسل لقطات صغيرة وقصيرة للوجه بشكل آمن إلى خدمة VitalLens لحساب التقدير. شفاء لا تحفظ فيديو ولا صوراً — فقط الأرقام الناتجة ووقت القياس.",
      "إذا لم تتوفر خدمة VitalLens، تعمل طريقة مفتوحة المصدر على جهازك (نبض القلب فقط).",
      "الكاميرا تعمل فقط أثناء الفحص، ويمكنك الإيقاف في أي وقت.",
    ],
    limitsTitle: "الحدود — يرجى القراءة",
    limits: [
      "هذه تقديرات للعافية وليست تشخيصاً طبياً، وشفاء ليست جهازاً طبياً.",
      "لا نقيس ضغط الدم ولا أكسجين الدم ولا سكر الدم.",
      "الإضاءة والحركة والمكياج ولون البشرة وجودة الكاميرا كلها تؤثر على الدقة.",
      "فحص الجلسة يعتمد على كاميرا أمامية واحدة، لذلك فهو تقريبي.",
      "التغيّر عن معدلك المعتاد دعوة للانتباه — وليس استنتاجاً. لا تغيّر أدويتك أبداً بسبب فحص.",
      "إذا شعرت بألم في الصدر أو ضيق شديد في التنفس أو إغماء أو ضعف مفاجئ، اتصل بـ 999 فوراً.",
    ],
  },
};

export default function HowItWorks() {
  const [lang, setLang] = useLocalStorage("shifa_checkin_lang", defaultLang());
  const c = COPY[lang] || COPY.en;
  return (
    <div className="grid checkin" style={{ gap: 20 }} dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
      <div className="page-head row between" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        <div>
          <h1>ℹ️ {c.title}</h1>
          <p>{c.sub}</p>
        </div>
        <div className="checkin-lang" role="group" aria-label="Language">
          <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>English</button>
          <button className={lang === "ar" ? "active" : ""} onClick={() => setLang("ar")}>العربية</button>
        </div>
      </div>

      <div className="grid cols-2">
        {c.cards.map((card) => (
          <div className="card" key={card.title}>
            <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
              <div className="stat-icon" style={{ background: "var(--primary-100)", flexShrink: 0 }}><card.icon size={18} /></div>
              <div>
                <div style={{ fontWeight: 800 }}>{card.title}</div>
                <div className="muted" style={{ fontSize: ".9rem", lineHeight: 1.6 }}>{card.body}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid cols-2">
        <div className="card" style={{ background: "var(--secondary-100)", borderColor: "var(--secondary)" }}>
          <h3 className="card-title"><Lock size={18} style={{ verticalAlign: "-3px" }} /> {c.privacyTitle}</h3>
          <ul className="checkin-list">{c.privacy.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
        <div className="card" style={{ background: "var(--warning-100)", borderColor: "var(--warning)" }}>
          <h3 className="card-title"><AlertTriangle size={18} style={{ verticalAlign: "-3px" }} /> {c.limitsTitle}</h3>
          <ul className="checkin-list">{c.limits.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      </div>

      <Link className="btn secondary" to="/check-in" style={{ justifySelf: "start" }}><ArrowLeft size={16} /> {c.back}</Link>
    </div>
  );
}
