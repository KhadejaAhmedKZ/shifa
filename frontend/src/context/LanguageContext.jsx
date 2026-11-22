import { createContext, useContext } from "react";
import { useLocalStorage } from "../hooks/useLocalStorage.js";
import { defaultLang } from "../data/checkinStrings.js";

// One shared app language ("en" | "ar"). The top-bar switch and the in-page
// English/العربية buttons all read and write this, so they stay in sync.
const LanguageContext = createContext({ lang: "en", setLang: () => {} });

export function LanguageProvider({ children }) {
  const [lang, setLang] = useLocalStorage("shifa_checkin_lang", defaultLang());
  return <LanguageContext.Provider value={{ lang, setLang }}>{children}</LanguageContext.Provider>;
}

/** Drop-in replacement for the per-page useLocalStorage language state: returns [lang, setLang]. */
export const useLang = () => {
  const { lang, setLang } = useContext(LanguageContext);
  return [lang, setLang];
};
