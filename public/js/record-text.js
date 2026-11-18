// A record's text as paragraphs, for the record views (/corpus/?id=,
// /executive/?id=). Every source separates paragraphs with a blank line.
//
// Inside a paragraph, line breaks are kept unless they are an edition's, not
// the author's: Project Gutenberg's plain texts are hard-wrapped at about 70
// characters, and the Government Publishing Office's Federal Register text is
// hard-wrapped as typeset. Those paragraphs are reflowed. `keepTables` leaves
// a paragraph's breaks alone when a line in it is laid out in columns (a run
// of spaces between words, or a rule of dashes), since its rows are the
// content: GPO's text sets the few tables in presidential documents that way.

const TABLE_LINE = /\S {3,}\S|^[-_=.\s]{5,}$/;
const isTable = (p) => p.split('\n').some((line) => TABLE_LINE.test(line.trim()));

/**
 * @param {string} text
 * @param {{ reflow?: boolean, keepTables?: boolean }} [opts]
 * @returns {string[]}
 */
export function paragraphs(text, { reflow = false, keepTables = false } = {}) {
  const paras = text.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean);
  if (!reflow) return paras;
  return paras.map((p) => (keepTables && isTable(p) ? p : p.replace(/\s*\n\s*/g, ' ')));
}
