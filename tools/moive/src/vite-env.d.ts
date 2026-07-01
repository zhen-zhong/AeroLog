/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CMS_API_BASE?: string;
  readonly VITE_TRANSLATE_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
