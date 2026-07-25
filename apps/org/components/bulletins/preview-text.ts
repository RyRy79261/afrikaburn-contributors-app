// Plain-text preview of a markdown bulletin body — the 2-line clamp inside a
// BulletinCard (list rows + the compose "how recipients see it" preview).
// Deliberately a light strip rather than a parser: MarkdownView renders the
// real thing, this only has to read cleanly as one sentence of prose. Pure and
// dependency-free, so both the server list and the client composer can use it.

const RULES: readonly [RegExp, string][] = [
  [/```[\s\S]*?```/g, " "], // fenced code
  [/`([^`]*)`/g, "$1"], // inline code
  [/!\[[^\]]*\]\([^)]*\)/g, " "], // images
  [/\[([^\]]*)\]\([^)]*\)/g, "$1"], // links → their text
  [/^\s{0,3}#{1,6}\s+/gm, ""], // headings
  [/^\s{0,3}>\s?/gm, ""], // block quotes
  [/^\s{0,3}([-*+]|\d+\.)\s+/gm, ""], // list bullets
  [/(\*\*|__|\*|_|~~)/g, ""], // emphasis marks
  [/\s+/g, " "], // collapse whitespace
];

/** Strip markdown to a single-line preview, truncated to `max` characters. */
export function plainPreview(markdown: string, max = 220): string {
  const text = RULES.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    markdown,
  ).trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}
