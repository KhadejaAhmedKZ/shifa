import { createContext, useContext, useEffect } from "react";
import { useLocalStorage } from "../hooks/useLocalStorage.js";
import { applyLanguage } from "../i18n/translator.js";

export const LANGUAGES = [
  { code: "en", label: "English", short: "EN" },
  { code: "ar", label: "العربية", short: "ع" },
  { code: "ur", label: "اردو", short: "اردو" },
];

const initial = () => {
  const n = (typeof navigator !== "undefined" && navigator.language || "").toLowerCase();
  return n.startsWith("ar") ? "ar" : n.startsWith("ur") ? "ur" : "en";
};

// One shared app language for the WHOLE site. The top-bar menu and the in-page
// language buttons all read and write this, and the site-wide translator
// (i18n/translator.js) re-renders every page in that language.
const LanguageContext = createContext({ lang: "en", setLang: () => {} });

export function LanguageProvider({ children }) {
  const [lang, setLang] = useLocalStorage("shifa_checkin_lang", initial());
  const safe = LANGUAGES.some((l) => l.code === lang) ? lang : "en";
  useEffect(() => { applyLanguage(safe); }, [safe]);
  return <LanguageContext.Provider value={{ lang: safe, setLang }}>{children}</LanguageContext.Provider>;
}

/** Returns [lang, setLang]. */
export const useLang = () => {
  const { lang, setLang } = useContext(LanguageContext);
  return [lang, setLang];
};
