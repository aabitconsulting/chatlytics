/**
 * assets/js/markdown.js
 * Zero-CDN, XSS-safe DOM-based Markdown renderer & dual-format clipboard helper.
 *
 * Security model:
 * - Constructs all elements strictly via document.createElement / createTextNode.
 * - Never assigns raw LLM or user input to innerHTML.
 * - Strictly whitelists http:// and https:// URLs on generated links.
 * - Compatible with real browser DOM and lightweight Node unit-test mock DOMs.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Validates that a link target uses http:// or https:// only.
 * Blocks javascript:, data:, vbscript:, and protocol-relative URLs.
 *
 * @param {string} rawUrl
 * @returns {string|null}
 */
export function sanitizeMarkdownUrl(rawUrl) {
  const clean = String(rawUrl || '').trim();
  if (!clean) return null;
  if (!/^https?:\/\/[^\s<>"]+$/i.test(clean)) return null;
  return clean;
}

/**
 * Creates an SVG icon safely via createElementNS when available,
 * falling back to a plain text span inside minimal test mock DOMs.
 *
 * @param {'rich'|'markdown'|'check'} kind
 * @returns {Element}
 */
function createToolbarIcon(kind) {
  if (typeof document === 'undefined' || typeof document.createElementNS !== 'function') {
    const span = document.createElement('span');
    span.className = 'md-copy-fallback-glyph';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = kind === 'check' ? '✓' : (kind === 'markdown' ? 'MD' : '⧉');
    return span;
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const addEl = (tag, attrs) => {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    svg.appendChild(el);
    return el;
  };

  if (kind === 'check') {
    addEl('polyline', { points: '20 6 9 17 4 12' });
    return svg;
  }

  if (kind === 'markdown') {
    // Document frame + crisp M↓ Markdown glyph
    addEl('rect', { x: '2', y: '4', width: '20', height: '16', rx: '2.5' });
    addEl('path', { d: 'M5.5 15V9l3 3.5L11.5 9v6' });
    addEl('path', { d: 'M16.5 9v6' });
    addEl('polyline', { points: '14.2 12.7 16.5 15 18.8 12.7' });
    return svg;
  }

  // Default: Rich-Text copy icon (overlapping sheets)
  addEl('rect', { x: '9', y: '9', width: '13', height: '13', rx: '2' });
  addEl('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' });
  return svg;
}

/**
 * Parses inline Markdown (inline code, links, bold, italic, strikethrough, bare URLs)
 * and appends safe DOM nodes to `parent`.
 *
 * @param {Element} parent
 * @param {string} text
 */
function appendInlineMarkdown(parent, text) {
  const src = String(text ?? '');
  if (!src) return;

  // Ordered inline token regex:
  // 1) `code`
  // 2) [label](url)
  // 3) ***bold+italic***
  // 4) **bold**
  // 5) ~~strike~~
  // 6) *italic* (non-space inner boundaries)
  // 7) bare https?:// URL
  const tokenRe = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*\n]+)\*|(https?:\/\/[^\s<>)\]]+)/g;

  let lastIndex = 0;
  let match;
  while ((match = tokenRe.exec(src)) !== null) {
    if (match.index > lastIndex) {
      parent.appendChild(document.createTextNode(src.slice(lastIndex, match.index)));
    }

    if (match[1] !== undefined) {
      const code = document.createElement('code');
      code.className = 'md-inline-code';
      code.textContent = match[1];
      parent.appendChild(code);
    } else if (match[2] !== undefined && match[3] !== undefined) {
      const safeUrl = sanitizeMarkdownUrl(match[3]);
      if (safeUrl) {
        const a = document.createElement('a');
        a.className = 'md-link';
        a.href = safeUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        appendInlineMarkdown(a, match[2]);
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(match[2]));
      }
    } else if (match[4] !== undefined) {
      const strong = document.createElement('strong');
      const em = document.createElement('em');
      appendInlineMarkdown(em, match[4]);
      strong.appendChild(em);
      parent.appendChild(strong);
    } else if (match[5] !== undefined) {
      const strong = document.createElement('strong');
      appendInlineMarkdown(strong, match[5]);
      parent.appendChild(strong);
    } else if (match[6] !== undefined) {
      const del = document.createElement('del');
      appendInlineMarkdown(del, match[6]);
      parent.appendChild(del);
    } else if (match[7] !== undefined) {
      const em = document.createElement('em');
      appendInlineMarkdown(em, match[7]);
      parent.appendChild(em);
    } else if (match[8] !== undefined) {
      let rawBare = match[8];
      let trailing = '';
      while (/[.,;:!?]$/.test(rawBare)) {
        trailing = rawBare.slice(-1) + trailing;
        rawBare = rawBare.slice(0, -1);
      }
      const safeBare = sanitizeMarkdownUrl(rawBare);
      if (safeBare) {
        const a = document.createElement('a');
        a.className = 'md-link';
        a.href = safeBare;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = rawBare;
        parent.appendChild(a);
        if (trailing) {
          parent.appendChild(document.createTextNode(trailing));
        }
      } else {
        parent.appendChild(document.createTextNode(match[8]));
      }
    }

    lastIndex = tokenRe.lastIndex;
  }

  if (lastIndex < src.length) {
    parent.appendChild(document.createTextNode(src.slice(lastIndex)));
  }
}

/**
 * Splits a Markdown pipe table row into trimmed cell strings.
 *
 * @param {string} line
 * @returns {string[]}
 */
function splitTableRow(line) {
  let trimmed = String(line || '').trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((cell) => cell.trim());
}

/**
 * Checks if a line is a Markdown table separator (e.g. | --- | :---: | ---: |).
 *
 * @param {string} line
 * @returns {boolean}
 */
function isTableSeparatorLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed.includes('-')) return false;
  return /^\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?$/.test(trimmed);
}

/**
 * Checks if a line starts a new block-level Markdown construct.
 *
 * @param {string} line
 * @returns {boolean}
 */
function isBlockStarter(line) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^```/.test(trimmed)) return true;
  if (/^#{1,6}\s+/.test(trimmed)) return true;
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return true;
  if (/^>\s?/.test(trimmed)) return true;
  if (/^[-*+]\s+/.test(trimmed)) return true;
  if (/^\d+[.)]\s+/.test(trimmed)) return true;
  return false;
}

/**
 * Renders Markdown safely into an existing container Element using DOM APIs only.
 *
 * @param {string} rawMarkdown
 * @param {Element} container
 * @returns {Element}
 */
export function renderMarkdownInto(rawMarkdown, container) {
  const normalized = String(rawMarkdown ?? '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // 1. Fenced code block
    const fenceMatch = trimmed.match(/^```([a-zA-Z0-9_+-]*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || '';
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // consume closing ```

      const pre = document.createElement('pre');
      pre.className = 'md-code-block';
      const code = document.createElement('code');
      if (lang) code.setAttribute('data-lang', lang);
      code.textContent = codeLines.join('\n');
      pre.appendChild(code);
      container.appendChild(pre);
      continue;
    }

    // 2. Headings (# .. ######) -> rendered as h3..h6 for semantic nesting inside answer cards
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const tagLevel = Math.min(6, level + 2);
      const h = document.createElement(`h${tagLevel}`);
      h.className = `md-heading md-h${Math.min(4, level)}`;
      appendInlineMarkdown(h, headingMatch[2]);
      container.appendChild(h);
      i += 1;
      continue;
    }

    // 3. Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      const hr = document.createElement('hr');
      hr.className = 'md-hr';
      container.appendChild(hr);
      i += 1;
      continue;
    }

    // 4. Markdown pipe table (header row + separator row)
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
      const headers = splitTableRow(line);
      const sepCells = splitTableRow(lines[i + 1]);
      const aligns = sepCells.map((cell) => {
        if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
        if (cell.endsWith(':')) return 'right';
        return 'left';
      });
      i += 2;

      const wrap = document.createElement('div');
      wrap.className = 'md-table-wrap';
      const table = document.createElement('table');
      table.className = 'md-table';

      const thead = document.createElement('thead');
      const headTr = document.createElement('tr');
      headers.forEach((cellText, idx) => {
        const th = document.createElement('th');
        if (aligns[idx] && aligns[idx] !== 'left') th.className = `text-${aligns[idx]}`;
        appendInlineMarkdown(th, cellText);
        headTr.appendChild(th);
      });
      thead.appendChild(headTr);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      while (i < lines.length) {
        const rowLine = lines[i].trim();
        if (!rowLine || !rowLine.includes('|')) break;
        const cells = splitTableRow(lines[i]);
        const tr = document.createElement('tr');
        for (let c = 0; c < Math.max(headers.length, cells.length); c += 1) {
          const td = document.createElement('td');
          if (aligns[c] && aligns[c] !== 'left') td.className = `text-${aligns[c]}`;
          appendInlineMarkdown(td, cells[c] ?? '');
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
        i += 1;
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      container.appendChild(wrap);
      continue;
    }

    // 5. Blockquote
    if (/^>\s?/.test(trimmed)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      const bq = document.createElement('blockquote');
      bq.className = 'md-blockquote';
      renderMarkdownInto(quoteLines.join('\n'), bq);
      container.appendChild(bq);
      continue;
    }

    // 6. Unordered list
    if (/^[-*+]\s+/.test(trimmed)) {
      const ul = document.createElement('ul');
      ul.className = 'md-list';
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const li = document.createElement('li');
        const itemText = lines[i].replace(/^\s*[-*+]\s+/, '');
        appendInlineMarkdown(li, itemText);
        ul.appendChild(li);
        i += 1;
      }
      container.appendChild(ul);
      continue;
    }

    // 7. Ordered list
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const ol = document.createElement('ol');
      ol.className = 'md-list md-list-ordered';
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        const li = document.createElement('li');
        const itemText = lines[i].replace(/^\s*\d+[.)]\s+/, '');
        appendInlineMarkdown(li, itemText);
        ol.appendChild(li);
        i += 1;
      }
      container.appendChild(ol);
      continue;
    }

    // 8. Paragraph (group contiguous non-block lines)
    const paraLines = [trimmed];
    i += 1;
    while (i < lines.length) {
      const nextLine = lines[i];
      const nextTrimmed = nextLine.trim();
      if (!nextTrimmed || isBlockStarter(nextLine)) break;
      if (nextTrimmed.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) break;
      paraLines.push(nextTrimmed);
      i += 1;
    }
    const p = document.createElement('p');
    p.className = 'md-paragraph';
    paraLines.forEach((pLine, idx) => {
      if (idx > 0) p.appendChild(document.createElement('br'));
      appendInlineMarkdown(p, pLine);
    });
    container.appendChild(p);
  }

  return container;
}

/**
 * Renders Markdown safely into a DocumentFragment (or div wrapper in minimal mock DOMs).
 *
 * @param {string} rawMarkdown
 * @returns {DocumentFragment|Element}
 */
export function renderMarkdownToFragment(rawMarkdown) {
  const host = typeof document !== 'undefined' && typeof document.createDocumentFragment === 'function'
    ? document.createDocumentFragment()
    : document.createElement('div');
  return renderMarkdownInto(rawMarkdown, host);
}

/**
 * Converts Markdown into clean plain text suitable for plain-text clipboard fallback
 * or Word/Outlook/Slack paste when HTML clipboard is unavailable.
 *
 * @param {string} rawMarkdown
 * @returns {string}
 */
export function markdownToPlainText(rawMarkdown) {
  const normalized = String(rawMarkdown ?? '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const out = [];
  let inCode = false;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (/^```/.test(trimmed)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(raw);
      continue;
    }
    if (isTableSeparatorLine(trimmed)) {
      continue;
    }
    if (trimmed.includes('|') && (trimmed.startsWith('|') || (i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])))) {
      out.push(splitTableRow(trimmed).join('\t'));
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      out.push('---');
      continue;
    }

    let clean = raw
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*>\s?/, '')
      .replace(/^\s*[-*+]\s+/, '• ')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, '$1 ($2)')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/\*([^*\n]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1');

    out.push(clean);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Fallback copy routine using a hidden temporary textarea.
 *
 * @param {string} text
 * @returns {boolean}
 */
function fallbackCopyPlainText(text) {
  if (typeof document === 'undefined' || !document.body || typeof document.execCommand !== 'function') {
    return false;
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = String(text ?? '');
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return Boolean(ok);
  } catch (_) {
    return false;
  }
}

/**
 * Copies the answer as formatted Rich Text (text/html + clean text/plain)
 * for pasting into Word, Google Docs, Outlook, or Notion.
 *
 * @param {string} rawMarkdown
 * @param {Element|null} renderedEl
 * @returns {Promise<boolean>}
 */
export async function copyAnswerAsRichText(rawMarkdown, renderedEl = null) {
  const plain = markdownToPlainText(rawMarkdown);
  let html = '';
  if (renderedEl && typeof renderedEl.innerHTML === 'string' && renderedEl.innerHTML.trim() !== '') {
    html = `<div>${renderedEl.innerHTML}</div>`;
  } else if (typeof document !== 'undefined') {
    const temp = document.createElement('div');
    renderMarkdownInto(rawMarkdown, temp);
    if (typeof temp.innerHTML === 'string' && temp.innerHTML.trim() !== '') {
      html = `<div>${temp.innerHTML}</div>`;
    }
  }

  try {
    if (
      html
      && typeof navigator !== 'undefined'
      && navigator.clipboard
      && typeof navigator.clipboard.write === 'function'
      && typeof ClipboardItem !== 'undefined'
      && typeof Blob !== 'undefined'
    ) {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' })
      });
      await navigator.clipboard.write([item]);
      return true;
    }
  } catch (_) {
    // Fall through to plain-text clipboard write
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(plain);
      return true;
    }
  } catch (_) {
    // Fall through to execCommand fallback
  }

  return fallbackCopyPlainText(plain);
}

/**
 * Copies the exact unaltered raw Markdown (.md) source string.
 *
 * @param {string} rawMarkdown
 * @returns {Promise<boolean>}
 */
export async function copyAnswerAsMarkdown(rawMarkdown) {
  const raw = String(rawMarkdown ?? '');
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(raw);
      return true;
    }
  } catch (_) {
    // Fall through to execCommand fallback
  }
  return fallbackCopyPlainText(raw);
}

/**
 * Builds the complete `.md-answer-box` element containing:
 * - Top-right compact 2-icon copy toolbar:
 *   1. Rich-text copy (`data-copy-mode="rich"`)
 *   2. Raw Markdown (.md) copy (`data-copy-mode="markdown"`)
 * - XSS-safe rendered Markdown prose body (`.md-prose`).
 *
 * Raw Markdown is stored in `data-raw-markdown` so cloned nodes (e.g. Mobile Detail Sheet)
 * work identically via delegated click listeners.
 *
 * @param {string} rawMarkdown
 * @param {{ copyRich?: string, copyMarkdown?: string, toolbarLabel?: string }} labels
 * @returns {Element}
 */
export function createMarkdownAnswerViewer(rawMarkdown, labels = {}) {
  const text = String(rawMarkdown ?? '');
  const copyRichLabel = labels.copyRich || 'Alles kopieren (formatiert)';
  const copyMdLabel = labels.copyMarkdown || 'Als Markdown (.md) kopieren';
  const toolbarLabel = labels.toolbarLabel || 'KI-Antwort kopieren';

  const box = document.createElement('div');
  box.className = 'md-answer-box';
  box.setAttribute('data-raw-markdown', text);

  const toolbar = document.createElement('div');
  toolbar.className = 'md-copy-toolbar';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', toolbarLabel);

  const makeCopyBtn = (mode, titleText) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'md-copy-btn';
    btn.setAttribute('data-copy-mode', mode);
    btn.setAttribute('title', titleText);
    btn.setAttribute('aria-label', titleText);
    btn.appendChild(createToolbarIcon(mode));
    return btn;
  };

  toolbar.appendChild(makeCopyBtn('rich', copyRichLabel));
  toolbar.appendChild(makeCopyBtn('markdown', copyMdLabel));

  const prose = document.createElement('div');
  prose.className = 'md-prose';
  if (text.trim() === '' || text.trim() === '—') {
    const emptyP = document.createElement('p');
    emptyP.className = 'md-paragraph text-muted';
    emptyP.textContent = '—';
    prose.appendChild(emptyP);
  } else {
    renderMarkdownInto(text, prose);
  }

  box.appendChild(toolbar);
  box.appendChild(prose);
  return box;
}

/**
 * Flashes a brief checkmark feedback state on a clicked copy mini-icon button.
 *
 * @param {Element} btn
 * @param {'rich'|'markdown'} mode
 */
function flashCopiedButton(btn, mode) {
  if (!btn) return;
  if (btn._copiedTimer) clearTimeout(btn._copiedTimer);

  if (btn.classList) btn.classList.add('is-copied');
  if (typeof btn.replaceChildren === 'function') {
    btn.replaceChildren(createToolbarIcon('check'));
  }

  btn._copiedTimer = setTimeout(() => {
    if (btn.classList) btn.classList.remove('is-copied');
    if (typeof btn.replaceChildren === 'function') {
      btn.replaceChildren(createToolbarIcon(mode));
    }
    btn._copiedTimer = null;
  }, 1600);
}

/**
 * Binds an idempotent delegated click listener on `rootEl` for all `.md-copy-btn` controls
 * inside `.md-answer-box` containers (survives `cloneNode(true)` in mobile sheets).
 *
 * @param {Element|null} rootEl
 * @param {(mode: 'rich'|'markdown', ok: boolean) => void} [onCopied]
 */
export function bindMarkdownCopyDelegation(rootEl, onCopied = null) {
  if (!rootEl || typeof rootEl.addEventListener !== 'function') return;
  if (rootEl._mdCopyDelegationBound) return;
  rootEl._mdCopyDelegationBound = true;

  rootEl.addEventListener('click', async (e) => {
    const btn = e?.target?.closest?.('.md-copy-btn');
    if (!btn) return;
    e.stopPropagation();

    const box = btn.closest?.('.md-answer-box');
    if (!box) return;

    const mode = btn.getAttribute('data-copy-mode') === 'markdown' ? 'markdown' : 'rich';
    const rawMarkdown = box.getAttribute('data-raw-markdown') || '';
    const proseEl = box.querySelector?.('.md-prose') || null;

    const ok = mode === 'markdown'
      ? await copyAnswerAsMarkdown(rawMarkdown)
      : await copyAnswerAsRichText(rawMarkdown, proseEl);

    if (ok) {
      flashCopiedButton(btn, mode);
    }
    if (typeof onCopied === 'function') {
      onCopied(mode, ok);
    }
  });
}

if (typeof window !== 'undefined') {
  window.ChatlyticsMarkdown = {
    sanitizeMarkdownUrl,
    renderMarkdownInto,
    renderMarkdownToFragment,
    markdownToPlainText,
    copyAnswerAsRichText,
    copyAnswerAsMarkdown,
    createMarkdownAnswerViewer,
    bindMarkdownCopyDelegation
  };
}
