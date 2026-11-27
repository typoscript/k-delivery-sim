/** Width-limited canvas text: long names (OSM shop / apartment names run up to ~40 characters) end in "…" */

type Measure = { measureText(text: string): { width: number } };

/**
 * `prefix + name + suffix`, shortening only `name` (with "…") until it fits `maxWidth` with the context's
 * current font. Keeps the prefix (emoji) and suffix (order number) intact.
 */
export function fitName(ctx: Measure, prefix: string, name: string, suffix: string, maxWidth: number): string {
  const full = `${prefix}${name}${suffix}`;
  if (ctx.measureText(full).width <= maxWidth) return full;
  const chars = [...name];
  let lo = 0;
  let hi = chars.length;
  // Longest name prefix that still fits with the ellipsis
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const text = `${prefix}${chars.slice(0, mid).join('').trimEnd()}…${suffix}`;
    if (ctx.measureText(text).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${prefix}${chars.slice(0, lo).join('').trimEnd()}…${suffix}`;
}
