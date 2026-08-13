import { useEffect, useState } from "react";
import { usePlatform } from "../../platform/context";
import type { AndroidView } from "../../platform/types";

function initialAndroidView(): AndroidView {
  if (typeof window === "undefined") return "compose";
  try {
    const value = new URLSearchParams(window.location.search).get("compatView");
    if (value === "canvas" || value === "history" || value === "compose") return value;
  } catch {
    // Ignore malformed URLs and keep the normal default.
  }
  return "compose";
}

export function useAndroidView() {
  const { isAndroid, isAndroidPad } = usePlatform();
  const [androidView, setAndroidView] = useState<AndroidView>(() => initialAndroidView());

  useEffect(() => {
    if (!isAndroid) return;
    setAndroidView((current) => {
      if (isAndroidPad) return current;
      return current === "history" ? "history" : "compose";
    });
  }, [isAndroid, isAndroidPad]);

  return {
    androidView,
    setAndroidView,
  };
}
