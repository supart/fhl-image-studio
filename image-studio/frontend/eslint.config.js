import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const tsRecommendedRules = Object.assign(
  {},
  ...tseslint.configs.recommended.map((config) => config.rules || {}),
);

const legacyStateBoundaryFiles = [
  "src/state/autoAspectSizing.ts",
  "src/state/materialLibrary.ts",
  "src/state/sharedEditAutoAspect.ts",
  "src/state/studioStore.ts",
];

const legacyAndroidBridgeConsumers = [
  "src/state/studioStore.media.ts",
  "src/state/studioStore.images.ts",
  "src/components/panel/FAQModal.tsx",
  "src/components/panel/AboutImageStudioModal.tsx",
  "src/components/panel/FHLAPIChoiceModal.tsx",
  "src/components/panel/APIMartAPIChoiceModal.tsx",
  "src/components/panel/ResultDetailDrawer.tsx",
  "src/components/panel/RunningHubAPIChoiceModal.tsx",
  "src/components/panel/SettingsPanel.tsx",
  "src/components/layout/AppHeader.tsx",
  "src/components/layout/AppHeaderBrand.tsx",
  "src/components/layout/FooterBar.tsx",
];

const legacyWholeStoreSubscribers = [
  "src/components/panorama/PanoramaStudioEntryModal.tsx",
  "src/platform/android/AndroidPadComposePanel.tsx",
  "src/platform/android/AndroidPhoneComposePanel.tsx",
  "src/platform/android/canvas/AndroidCanvasStage.tsx",
  "src/platform/android/canvas/AndroidCanvasWorkspace.tsx",
  "src/components/canvas/Toolbar.tsx",
  "src/components/canvas/StatusBar.tsx",
  "src/components/canvas/CanvasStage.tsx",
  "src/platform/android/upstream/useAndroidUpstreamConfig.ts",
  "src/components/panel/FHLImagesPoolConfig.tsx",
  "src/components/panel/ControlPanel.tsx",
  "src/components/panel/SettingsPresetsRow.tsx",
  "src/components/layout/AppHeader.tsx",
  "src/components/panel/SettingsPanel.tsx",
  "src/components/layout/FooterBar.tsx",
  "src/components/panel/UpstreamConfigModal.tsx",
  "src/components/layout/WorkspaceBar.tsx",
  "src/components/history/HistoryRail.tsx",
  "src/components/history/MaterialManagerModal.tsx",
  "src/components/history/HistoryTimelineModal.tsx",
];

const androidBridgeRestriction = {
  patterns: [{
    group: ["**/platform/android/bridge", "**/platform/android/bridge.ts"],
    message: "Use the runtime host facade instead of importing the Android bridge directly.",
  }],
};

const stateBoundaryRestriction = {
  patterns: [
    ...androidBridgeRestriction.patterns,
    {
      group: ["**/components/**", "**/app/dev/**"],
      message: "State and library modules must not depend on UI or development-only modules.",
    },
  ],
};

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "test-results/**", "wailsjs/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2024 },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsRecommendedRules,
      "no-undef": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-constant-binary-expression": "warn",
      "no-constant-condition": "warn",
      "no-control-regex": "warn",
      "no-useless-escape": "warn",
      "no-unused-vars": "off",
      "prefer-const": "warn",
      "prefer-rest-params": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-restricted-imports": ["error", androidBridgeRestriction],
      "no-restricted-syntax": ["error", {
        selector: "CallExpression[callee.name='useStudioStore'][arguments.length=0]",
        message: "Subscribe with a selector (and useShallow when selecting multiple fields).",
      }],
    },
  },
  {
    files: ["src/state/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", stateBoundaryRestriction],
    },
  },
  {
    files: [...legacyStateBoundaryFiles, ...legacyAndroidBridgeConsumers],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: legacyWholeStoreSubscribers,
    rules: {
      "no-restricted-syntax": "off",
    },
  },
];
