import { createContext, useContext, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { ContentLanguage, TextFn, UiLanguage } from './types';
import { t } from './i18n';
import MoviesPage from './pages/MoviesPage';
import SearchPage from './pages/SearchPage';
import WatchPage from './pages/WatchPage';

interface AppSettings {
  contentLanguage: ContentLanguage;
  setContentLanguage: React.Dispatch<React.SetStateAction<ContentLanguage>>;
  setUiLanguage: React.Dispatch<React.SetStateAction<UiLanguage>>;
  text: TextFn;
  uiLanguage: UiLanguage;
}

const AppSettingsContext = createContext<AppSettings | null>(null);

export function useAppSettings(): AppSettings {
  const settings = useContext(AppSettingsContext);

  if (!settings) {
    throw new Error('useAppSettings must be used inside AppSettingsProvider');
  }

  return settings;
}

function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>('zh');
  const [contentLanguage, setContentLanguage] = useState<ContentLanguage>('original');

  const value = useMemo<AppSettings>(() => ({
    contentLanguage,
    setContentLanguage,
    setUiLanguage,
    text: (key, params) => t(uiLanguage, key, params),
    uiLanguage,
  }), [contentLanguage, uiLanguage]);

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export default function App() {
  return (
    <AppSettingsProvider>
      <Routes>
        <Route element={<MoviesPage />} path="/" />
        <Route element={<MoviesPage />} path="/category/:typeId" />
        <Route element={<SearchPage />} path="/search" />
        <Route element={<WatchPage />} path="/watch/:id" />
        <Route element={<Navigate replace to="/" />} path="*" />
      </Routes>
    </AppSettingsProvider>
  );
}
