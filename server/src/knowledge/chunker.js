const HEADER_LINE = /^(Doc ID|Audience|Version):/;

/**
 * Splits a knowledge-base Markdown document into section chunks at each "## " heading.
 * The "# " title and the metadata header lines are not part of any chunk. Empty sections are dropped.
 * Text before the first heading becomes a chunk with a null heading.
 *
 * @param {string} content full Markdown text
 * @returns {Array<{ ord: number, heading: string | null, content: string }>}
 */
export function chunkDocument(content) {
  const chunks = [];
  let heading = null;
  let lines = [];

  const flush = () => {
    const text = lines.join('\n').trim();
    if (text) {
      chunks.push({ heading, content: text });
    }
    lines = [];
  };

  for (const line of content.split(/\r?\n/)) {
    if (/^# /.test(line) || HEADER_LINE.test(line)) {
      continue;
    }
    if (/^## /.test(line)) {
      flush();
      heading = line.replace(/^##\s+/, '').trim();
      continue;
    }
    lines.push(line);
  }
  flush();

  return chunks.map((chunk, ord) => ({ ord, ...chunk }));
}
