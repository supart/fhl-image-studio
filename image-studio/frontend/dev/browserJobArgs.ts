export function browserJobBackgroundCLIArgs(value: unknown): [string, "standard" | "transparent"] {
  return ["--background-mode", value === "transparent" ? "transparent" : "standard"];
}
