import { useState } from "react";
import { History, Image, SlidersHorizontal } from "lucide-react";
import { ControlPanel } from "../../components/panel/ControlPanel";
import { Toolbar } from "../../components/canvas/Toolbar";
import { SourceStrip } from "../../components/canvas/SourceStrip";
import { CanvasStage } from "../../components/canvas/CanvasStage";
import { StatusBar } from "../../components/canvas/StatusBar";
import { HistoryRail } from "../../components/history/HistoryRail";

export function DesktopShell({
  fullscreen,
}: {
  fullscreen: boolean;
}) {
  const [compactPane, setCompactPane] = useState<"compose" | "canvas" | "history">("compose");

  return (
    <div
      className={`studio ${fullscreen ? "fullscreen" : ""}`}
      data-compact-pane={compactPane}
    >
      <nav className="compact-pane-nav" aria-label="窄屏工作区">
        <CompactPaneButton
          active={compactPane === "compose"}
          label="创作"
          onClick={() => setCompactPane("compose")}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </CompactPaneButton>
        <CompactPaneButton
          active={compactPane === "canvas"}
          label="画布"
          onClick={() => setCompactPane("canvas")}
        >
          <Image className="h-3.5 w-3.5" />
        </CompactPaneButton>
        <CompactPaneButton
          active={compactPane === "history"}
          label="历史"
          onClick={() => setCompactPane("history")}
        >
          <History className="h-3.5 w-3.5" />
        </CompactPaneButton>
      </nav>
      <ControlPanel />
      <div className="canvas-shell" data-audit-area="canvas">
        <Toolbar />
        <SourceStrip />
        <CanvasStage />
        <StatusBar />
      </div>
      <HistoryRail />
    </div>
  );
}

function CompactPaneButton({
  active,
  children,
  label,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="compact-pane-button"
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}
