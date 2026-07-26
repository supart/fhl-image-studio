import { lazy, Suspense } from "react";
import { usePlatform } from "../../platform/context";
import { useStudioStore } from "../../state/studioStore";

const StarPromptModal = lazy(() => import("../../components/common/StarPromptModal").then((module) => ({ default: module.StarPromptModal })));

export function StarPromptGate() {
  const { usesWindowsDesktopUI } = usePlatform();
  const open = useStudioStore((state) => state.starPromptOpen);

  if (!usesWindowsDesktopUI || !open) return null;

  return (
    <Suspense fallback={null}>
      <StarPromptModal open={open} />
    </Suspense>
  );
}
