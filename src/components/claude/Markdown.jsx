// Markdown for Claude's replies, rendered as React elements (never as HTML),
// covering what it actually writes: paragraphs, bold/italic/code, links,
// lists, headings, code blocks and tables.

function inline(text, keyBase) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('[')) {
      const [, label, href] = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      out.push(<a key={k} href={href} target="_blank" rel="noreferrer noopener">{label}</a>);
    } else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isTableRule = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
const isListItem = (l) => /^\s*([-*•]|\d+[.)])\s+/.test(l);
const startsBlock = (l) => isListItem(l) || /^#{1,4}\s/.test(l) || isTableRow(l) || /^\s*```/.test(l);

export default function Markdown({ text }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = blocks.length;

    if (/^\s*```/.test(line)) {
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i += 1;
      blocks.push(<pre key={key}><code>{body.join('\n')}</code></pre>);
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.endsWith(':') ? 'right' : 'left'));
      const rows = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div className="ccm-table" key={key}>
          <table>
            <thead><tr>{head.map((h, j) => <th key={j} style={{ textAlign: align[j] }}>{inline(h, `h${key}${j}`)}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j} style={{ textAlign: align[j] }}>{inline(c, `c${key}${ri}${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push(<h4 key={key}>{inline(heading[2], `hd${key}`)}</h4>);
      i += 1;
      continue;
    }

    if (isListItem(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items = [];
      while (i < lines.length && (isListItem(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (isListItem(lines[i])) items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i += 1;
      }
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(<Tag key={key}>{items.map((it, j) => <li key={j}>{inline(it, `li${key}${j}`)}</li>)}</Tag>);
      continue;
    }

    if (!line.trim()) { i += 1; continue; }

    const para = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={key}>{inline(para.join('\n'), `p${key}`)}</p>);
  }
  return <div className="ccm">{blocks}</div>;
}
