// Turns stored message text into safe HTML for the chat view.

export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * WhatsApp formatting for a message: ```code```, `code`, *bold*, _italic_, ~strike~, > quotes,
 * "- " / "* " bullets and links. Line breaks stay as typed (.tx is pre-wrap).
 */
export function fmtText(raw: string): string {
  const kept: string[] = [];
  const hold = (html: string) => '\u0000' + (kept.push(html) - 1) + '\u0000';
  let s = raw
    .replace(/```([\s\S]+?)```/g, (_, code: string) => hold('<code class="blk">' + esc(code.replace(/^\n|\n$/g, '')) + '</code>'))
    .replace(/`([^`\n]+)`/g, (_, code: string) => hold('<code>' + esc(code) + '</code>'))
    .replace(/\bhttps?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'*_~]/g, url => hold('<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a>'))
    .replace(/^> ?(.*)$/gm, '\u0001q$1\u0001/q')
    .replace(/^([-*]) (?=\S)/gm, '• ');
  for (const [mark, tag] of [['\\*', 'b'], ['_', 'i'], ['~', 's']]) {
    s = s.replace(new RegExp('(^|[^\\p{L}\\p{N}])' + mark + '(?=\\S)([^\\n]*?\\S)' + mark + '(?![\\p{L}\\p{N}])', 'gmu'), '$1\u0001' + tag + '$2\u0001/' + tag);
  }
  return esc(s)
    .replace(/\u0001q/g, '<span class="q">').replace(/\u0001\/q/g, '</span>')
    .replace(/\u0001(\/?)([bis])/g, '<$1$2>')
    .replace(/\u0000(\d+)\u0000/g, (_, n: string) => kept[Number(n)]);
}
