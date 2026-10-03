/** Reader order never mutates the data shared with the loader and other sections. */
export function chronological<T>(rows: readonly T[], at: (row: T) => string, order: "desc" | "asc"): T[] {
  return [...rows].sort((a, b) => order === "desc"
    ? Date.parse(at(b)) - Date.parse(at(a))
    : Date.parse(at(a)) - Date.parse(at(b)));
}
