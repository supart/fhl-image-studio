import type { ReversePromptImage } from "./studioStore.types";

let lastReversePromptImage: ReversePromptImage | null = null;

export function rememberReversePromptImage(image: ReversePromptImage | null) {
  lastReversePromptImage = image;
}

export function getRememberedReversePromptImage(): ReversePromptImage | null {
  return lastReversePromptImage;
}
