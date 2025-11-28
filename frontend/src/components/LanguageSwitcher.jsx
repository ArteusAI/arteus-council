import { useEffect, useRef, useState } from 'react';
import './LanguageSwitcher.css';

const flagByCode = {
  en: '🇬🇧',
  ru: '🇷🇺',
  el: '🇬🇷',
};

export default function LanguageSwitcher({ language, onChangeLanguage, languages }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const currentFlag = flagByCode[language] || '🏳️';

  return (
    <div className="language-switcher" ref={ref}>
      <button
        type="button"
        className="language-toggle"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label="Change language"
      >
        {currentFlag}
      </button>
      {open && (
        <div className="language-menu">
          {languages.map((lang) => (
            <button
              key={lang.code}
              type="button"
              className={`language-option ${language === lang.code ? 'active' : ''}`}
              onClick={() => {
                onChangeLanguage(lang.code);
                setOpen(false);
              }}
            >
              <span className="language-flag">{flagByCode[lang.code] || '🏳️'}</span>
              <span className="language-label">{lang.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
