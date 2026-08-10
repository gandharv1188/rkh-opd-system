import { useSyncExternalStore } from 'react';
import en from './en.json';
import hi from './hi.json';

export type Locale = 'en' | 'hi';
type Strings = typeof en;

const dictionaries: Record<Locale, Strings> = { en, hi: hi as Strings };

const STORAGE_KEY = 'dis.ui.locale';

let currentLocale: Locale =
  (typeof window !== 'undefined' && (window.localStorage.getItem(STORAGE_KEY) as Locale)) || 'en';
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, locale);
  for (const cb of listeners) cb();
}

export function getLocale(): Locale { return currentLocale; }

export function t(key: keyof Strings, locale: Locale = currentLocale): string {
  return dictionaries[locale][key] ?? String(key);
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, () => currentLocale, () => currentLocale);
}

export function useTranslation(): (key: keyof Strings) => string {
  const loc = useLocale();
  return (key) => t(key, loc);
}
