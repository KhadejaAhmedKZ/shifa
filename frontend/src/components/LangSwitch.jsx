import { LANGUAGES, useLang } from "../context/LanguageContext.jsx";

/** English / العربية / اردو segmented switch (changes the whole site). */
export default function LangSwitch({ onChange }) {
  const [lang, setLang] = useLang();
  return (
    <div className="checkin-lang" role="group" aria-label="Language" translate="no">
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          className={lang === l.code ? "active" : ""}
          aria-pressed={lang === l.code}
          onClick={() => { setLang(l.code); onChange?.(l.code); }}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
