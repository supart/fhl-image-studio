/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PACKAGE_VERSION?: string;
  readonly IMAGE_STUDIO_SERVICE_INSTANCE_ID?: string;
  readonly IMAGE_STUDIO_STORAGE_NAMESPACE?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_TARGET_PLATFORM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
