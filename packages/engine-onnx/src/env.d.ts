interface ImportMetaEnv {
  readonly VITE_MODEL_ID_DE_EN?: string;
  readonly VITE_MODEL_ID_EN_DE?: string;
  readonly VITE_MODEL_ID_FR_EN?: string;
  readonly VITE_MODEL_ID_EN_FR?: string;
  readonly VITE_MODEL_ID_ES_EN?: string;
  readonly VITE_MODEL_ID_EN_ES?: string;
  readonly VITE_MODEL_ID_IT_EN?: string;
  readonly VITE_MODEL_ID_EN_IT?: string;
  readonly VITE_MODEL_ID_NL_EN?: string;
  readonly VITE_MODEL_ID_EN_NL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
