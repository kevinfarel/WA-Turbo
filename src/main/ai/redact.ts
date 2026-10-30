// Phone numbers and WhatsApp IDs are swapped for stable aliases before text leaves the Mac,
// and swapped back in Claude's output for display. Aliases come from the `aliases` table.

// +62 812-5540-118 · +65 8123-4490 · 0812 3456 789 · 6281255401180. Not IPs, amounts or invoice numbers.
const PHONE = /(?<![\w.+/-])(?:\+\d{1,3}[\s-]?\d{2,4}|0\d{2,4}|62\d{8,11})(?:[\s-]?\d{3,4})(?:[\s-]?\d{3,5})?(?![\w.]|-\d)/g;
const JID = /\b\d{6,20}(?::\d+)?@(?:s\.whatsapp\.net|lid|c\.us)\b/g;

export type AliasFor = (digits: string) => string;

export function digitsOf(s: string): string {
  let d = s.replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1); // local Indonesian format → country code
  return d;
}

export function redact(text: string, aliasFor: AliasFor): string {
  return text
    .replace(JID, m => aliasFor(digitsOf(m.split('@')[0].split(':')[0])))
    .replace(PHONE, m => {
      const d = digitsOf(m);
      return d.length >= 9 && d.length <= 15 ? aliasFor(d) : m;
    });
}

/** Map aliases in Claude's output back to something readable. */
export function restore(text: string, display: Map<string, string>): string {
  if (!display.size) return text;
  return text.replace(/\bContact-\d{2,}\b/g, a => display.get(a) ?? a);
}

/** In-memory alias table backed by a loader/saver, so aliases stay stable across runs. */
export class AliasBook {
  private byDigits = new Map<string, string>();
  private next = 1;

  constructor(rows: { real: string; alias: string }[] = []) {
    for (const r of rows) {
      this.byDigits.set(r.real, r.alias);
      const n = Number(r.alias.replace('Contact-', ''));
      if (n >= this.next) this.next = n + 1;
    }
  }

  readonly added: { real: string; alias: string }[] = [];

  aliasFor: AliasFor = digits => {
    let a = this.byDigits.get(digits);
    if (!a) {
      a = 'Contact-' + String(this.next++).padStart(2, '0');
      this.byDigits.set(digits, a);
      this.added.push({ real: digits, alias: a });
    }
    return a;
  };

  displayMap(): Map<string, string> {
    const m = new Map<string, string>();
    for (const [d, a] of this.byDigits) m.set(a, '+' + d);
    return m;
  }
}
