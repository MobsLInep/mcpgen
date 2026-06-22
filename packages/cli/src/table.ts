/**
 * Minimal fixed-width ASCII table renderer. Kept dependency-free — the CLI only
 * needs to print a readable summary, not full terminal table styling.
 */

/** Truncate a cell to `max` chars, adding an ellipsis when cut. */
function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max <= 1) return value.slice(0, max);
  return value.slice(0, max - 1) + "…";
}

/**
 * Render `rows` under `headers` as a bordered table. `maxWidths` optionally caps
 * each column's content width.
 */
export function renderTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  maxWidths?: readonly number[],
): string {
  const cols = headers.length;
  const widths: number[] = headers.map((h, i) => {
    const cap = maxWidths?.[i] ?? Infinity;
    let w = Math.min(h.length, cap);
    for (const row of rows) {
      w = Math.max(w, Math.min((row[i] ?? "").length, cap));
    }
    return w;
  });

  const line = (cells: readonly string[]): string =>
    "│ " +
    cells
      .map((c, i) => clip(c, widths[i] ?? 0).padEnd(widths[i] ?? 0))
      .join(" │ ") +
    " │";

  const border = (left: string, mid: string, right: string): string =>
    left + widths.map((w) => "─".repeat(w + 2)).join(mid) + right;

  const out: string[] = [];
  out.push(border("┌", "┬", "┐"));
  out.push(line(headers));
  out.push(border("├", "┼", "┤"));
  for (const row of rows) {
    out.push(line(Array.from({ length: cols }, (_, i) => row[i] ?? "")));
  }
  out.push(border("└", "┴", "┘"));
  return out.join("\n");
}
