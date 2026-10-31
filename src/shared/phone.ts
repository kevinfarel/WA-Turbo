/** +6281255401180 → +62 812-5540-1180 (Indonesian layout); other countries stay as digits. */
export function formatPhone(p: string): string {
  if (!p) return '';
  const m = /^\+62(\d{3})(\d{4})(\d{3,5})$/.exec(p);
  if (m) return `+62 ${m[1]}-${m[2]}-${m[3]}`;
  const s = /^\+65(\d{4})(\d{4})$/.exec(p);
  if (s) return `+65 ${s[1]}-${s[2]}`;
  return p;
}
