import { keyringUserFor } from "./profiles.ts";

export const FHL_TEXT_API_CREDENTIAL_ID = "fhl-text-assistant";
export const FHL_TEXT_API_KEYRING_USER = keyringUserFor(FHL_TEXT_API_CREDENTIAL_ID);
export const LEGACY_API_KEY_USERS = ["responses", "images"] as const;
