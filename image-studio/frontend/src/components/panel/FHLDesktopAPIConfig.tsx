import { APICredentialLibrary } from "./APICredentialLibrary";
import { FHLImagesPoolConfig } from "./FHLImagesPoolConfig";
import { FHLTextAPIConfig } from "./FHLTextAPIConfig";

export function FHLDesktopAPIConfig({
  active,
  onClose,
  onOpenAdvanced,
}: {
  active: boolean;
  onClose?: () => void;
  onOpenAdvanced?: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <APICredentialLibrary />
      <div className="border-t border-black/[0.08] dark:border-white/[0.08]" />
      <FHLTextAPIConfig active={active} />
      <div className="border-t border-black/[0.08] dark:border-white/[0.08]" />
      <FHLImagesPoolConfig
        active={active}
        onClose={onClose}
        onOpenAdvanced={onOpenAdvanced}
      />
    </div>
  );
}
