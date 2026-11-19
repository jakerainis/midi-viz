/** "22–31 34 93": ascending notes with runs of three or more collapsed into ranges. */
export function formatNotes(notes: number[]) {
  const ns = [...new Set(notes)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < ns.length; ) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    if (j - i >= 2) parts.push(`${ns[i]}–${ns[j]}`);
    else for (let k = i; k <= j; k++) parts.push(String(ns[k]));
    i = j + 1;
  }
  return parts.join(' ');
}
