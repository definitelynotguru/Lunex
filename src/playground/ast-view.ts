export function renderAst(node: unknown, depth = 0): string {
  if (node === null || node === undefined) return `<span class="k">nil</span>`;
  if (typeof node !== 'object') return escape(String(node));
  if (Array.isArray(node)) {
    if (!node.length) return '[]';
    return node.map((n) => renderAst(n, depth)).join('');
  }
  const n = node as Record<string, unknown>;
  const type = String(n.type ?? 'node');
  const skip = new Set(['type']);
  const kids: string[] = [];
  for (const [k, v] of Object.entries(n)) {
    if (skip.has(k) || v === undefined) continue;
    if (v && typeof v === 'object') {
      kids.push(`<div class="tree-node"><span class="k">${escape(k)}</span>: ${renderAst(v, depth + 1)}</div>`);
    } else {
      kids.push(`<div class="tree-node"><span class="k">${escape(k)}</span>: ${escape(String(v))}</div>`);
    }
  }
  return `<div><strong>${escape(type)}</strong>${kids.join('')}</div>`;
}

function escape(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderLocals(locals: Record<string, unknown>): string {
  const rows = Object.entries(locals).map(([k, v]) => {
    let show: string;
    if (v === null || v === undefined) show = 'nil';
    else if (typeof v === 'object') show = v && (v as any).__luaClosure ? 'function' : 'table';
    else show = String(v);
    return `<tr><td>${escape(k)}</td><td>${escape(show)}</td></tr>`;
  });
  if (!rows.length) return '<span class="hint">No locals at this PC.</span>';
  return `<table><thead><tr><th>name</th><th>value</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}
