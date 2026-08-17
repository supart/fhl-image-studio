import { getRuntime } from "./hostBindings.ts";
import { unsupportedMessage } from "./hostContext.ts";

export function ReadClipboardText(): Promise<string> {
  const runtime = getRuntime();
  if (typeof runtime?.ClipboardGetText === "function") {
    try {
      return Promise.resolve(runtime.ClipboardGetText());
    } catch (error) {
      return Promise.reject(error);
    }
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
    return navigator.clipboard.readText();
  }
  return Promise.reject(new Error(unsupportedMessage("ReadClipboardText")));
}
