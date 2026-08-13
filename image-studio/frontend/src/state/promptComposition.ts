export function buildEffectivePrompt(promptPrefix: string, prompt: string): string {
  const prefix = promptPrefix.trim();
  const main = prompt.trim();
  if (prefix && main) return `${prefix}\n${main}`;
  return prefix || main;
}
