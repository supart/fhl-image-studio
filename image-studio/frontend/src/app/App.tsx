import { AppHeader } from "../components/layout/AppHeader";
import { WorkspaceBar } from "../components/layout/WorkspaceBar";
import { FooterBar } from "../components/layout/FooterBar";
import { ToastContainer } from "../components/common/ToastContainer";
import { usePlatform } from "../platform/context";
import { useStudioStore } from "../state/studioStore";
import { DropImportOverlay } from "./components/DropImportOverlay";
import { PlatformWorkspace } from "./components/PlatformWorkspace";
import { HistoryTimelineModal } from "../components/history/HistoryTimelineModal";
import { ResultDetailGate } from "./gates/ResultDetailGate";
import { SettingsPanelGate } from "./gates/SettingsPanelGate";
import { StarPromptGate } from "./gates/StarPromptGate";
import { UpstreamConfigGate } from "./gates/UpstreamConfigGate";
import { useAndroidView } from "./hooks/useAndroidView";
import { useGlobalImageImport } from "./hooks/useGlobalImageImport";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useInteractionAudit } from "./hooks/useInteractionAudit";
import { useStudioBootstrap } from "./hooks/useStudioBootstrap";

export default function App() {
  const fullscreen = useStudioStore((state) => state.fullscreen);
  const importImageFile = useStudioStore((state) => state.importImageFile);
  const settingsOpen = useStudioStore((state) => state.settingsOpen);
  const openSettings = useStudioStore((state) => state.openSettings);
  const closeSettings = useStudioStore((state) => state.closeSettings);
  const { isMac } = usePlatform();
  const { androidView, setAndroidView } = useAndroidView();
  const { dragHover } = useGlobalImageImport(importImageFile);

  useStudioBootstrap();
  useGlobalShortcuts({ isMac });
  useInteractionAudit();

  return (
    <div className="app-root relative" data-audit-area="app">
      <div className="liquid-ambient" aria-hidden="true" />

      <AppHeader onOpenSettings={openSettings} />
      <WorkspaceBar />
      <PlatformWorkspace
        fullscreen={fullscreen}
        androidView={androidView}
        onChangeAndroidView={setAndroidView}
      />
      <ToastContainer />
      {dragHover ? <DropImportOverlay /> : null}
      <FooterBar />
      <UpstreamConfigGate />
      <SettingsPanelGate open={settingsOpen} onClose={closeSettings} />
      <HistoryTimelineModal />
      <ResultDetailGate />
      <StarPromptGate />
    </div>
  );
}
