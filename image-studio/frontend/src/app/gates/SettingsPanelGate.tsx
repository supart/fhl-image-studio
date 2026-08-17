import { lazy, Suspense } from "react";

const SettingsPanel = lazy(() => import("../../components/panel/SettingsPanel").then((module) => ({ default: module.SettingsPanel })));

export function SettingsPanelGate({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <Suspense fallback={null}>
      <SettingsPanel open onClose={onClose} />
    </Suspense>
  );
}
