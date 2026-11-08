import { useEffect } from "react";
import { useStudioStore } from "../../state/studioStore";

let bootstrapPromise: Promise<void> | null = null;

export function bootstrapStudioOnce(bootstrap: () => Promise<void>): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrap().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  return bootstrapPromise;
}

export function useStudioBootstrap() {
  const bootstrap = useStudioStore((state) => state.bootstrap);

  useEffect(() => {
    void bootstrapStudioOnce(bootstrap).catch((error) => {
      if (typeof console !== "undefined") console.error("studio bootstrap failed", error);
    });
  }, [bootstrap]);
}
