/**
 * tests/tier1_features/f36_markdown_protocol_viewer.test.js
 * Feature 36: Zero-CDN XSS-safe Markdown Protocol Renderer & Dual-Format Copy Mini-Icons
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function createMockDom() {
  const makeClassList = (initial = []) => {
    const set = new Set(initial.filter(Boolean));
    return {
      add: (...cls) => cls.forEach((c) => set.add(c)),
      remove: (...cls) => cls.forEach((c) => set.delete(c)),
      contains: (c) => set.has(c),
      toString: () => Array.from(set).join(' ')
    };
  };

  function makeEl(tag) {
    const attrs = new Map();
    const children = [];
    const listeners = new Map();
    let _className = '';
    const el = {
      tagName: String(tag).toUpperCase(),
      nodeType: 1,
      children,
      style: {},
      textContent: '',
      innerHTML: '',
      parentNode: null,
      classList: makeClassList([]),
      get className() { return _className || el.classList.toString(); },
      set className(val) {
        _className = String(val || '');
        el.classList = makeClassList(_className.split(/\s+/));
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k === 'class') el.className = v;
      },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      appendChild(c) {
        children.push(c);
        c.parentNode = el;
        return c;
      },
      replaceChildren(...nodes) {
        children.length = 0;
        nodes.forEach((n) => el.appendChild(n));
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      dispatch(type, event) {
        for (const fn of listeners.get(type) || []) fn(event);
      },
      closest(sel) {
        const cls = sel.startsWith('.') ? sel.slice(1) : null;
        let cur = el;
        while (cur) {
          if (cls && cur.classList?.contains(cls)) return cur;
          cur = cur.parentNode;
        }
        return null;
      },
      querySelector(sel) {
        const cls = sel.startsWith('.') ? sel.slice(1) : null;
        const walk = (n) => {
          for (const ch of n.children || []) {
            if (cls && ch.classList?.contains(cls)) return ch;
            if (!cls && ch.tagName && ch.tagName.toLowerCase() === sel.toLowerCase()) return ch;
            const found = walk(ch);
            if (found) return found;
          }
          return null;
        };
        return walk(el);
      },
      querySelectorAll(sel) {
        const cls = sel.startsWith('.') ? sel.slice(1) : null;
        const out = [];
        const walk = (n) => {
          for (const ch of n.children || []) {
            if (cls && ch.classList?.contains(cls)) out.push(ch);
            if (!cls && ch.tagName && ch.tagName.toLowerCase() === sel.toLowerCase()) out.push(ch);
            walk(ch);
          }
        };
        walk(el);
        return out;
      }
    };
    return el;
  }

  return {
    makeEl,
    document: {
      body: makeEl('body'),
      createElement: (tag) => makeEl(tag),
      createTextNode: (txt) => ({ nodeType: 3, textContent: String(txt ?? ''), innerHTML: '', children: [] })
    }
  };
}

function collectText(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.textContent || '';
  if (node.children && node.children.length > 0) {
    return node.children.map(collectText).join('');
  }
  return node.textContent || '';
}

function collectInnerHtml(node) {
  if (!node) return '';
  return [node.innerHTML || '', ...(node.children || []).map(collectInnerHtml)].join('');
}

describe('Feature 36: Zero-CDN Markdown Protocol Viewer & Dual Copy Icons', () => {
  it('36.1 Renders headings, bold/italic, lists, tables, code blocks, quotes, and safe links without unsafe innerHTML', async () => {
    const dom = createMockDom();
    global.document = dom.document;
    global.window = global;

    const mdMod = await import('../../assets/js/markdown.js');
    const sample = [
      '# Empfehlungs-Überblick',
      '',
      'Die führende Lösung ist **Personio** mit *sehr guter* DACH-Abdeckung und `Schema.org`-Support.',
      '',
      '- **Personio** ([personio.de](https://personio.de))',
      '- Workday (https://workday.com)',
      '',
      '1. Erster Schritt',
      '2. Zweiter Schritt',
      '',
      '| Anbieter | Bewertung |',
      '| --- | ---: |',
      '| Personio | 95% |',
      '| Workday | 80% |',
      '',
      '> Wichtiger Hinweis zur DSGVO.',
      '',
      '```json',
      '{"brand": "Personio"}',
      '```'
    ].join('\n');

    const viewer = mdMod.createMarkdownAnswerViewer(sample);
    assert.equal(viewer.classList.contains('md-answer-box'), true);
    assert.equal(viewer.getAttribute('data-raw-markdown'), sample);

    // 2 copy mini-icons present top-right
    const copyBtns = viewer.querySelectorAll('.md-copy-btn');
    assert.equal(copyBtns.length, 2);
    assert.equal(copyBtns[0].getAttribute('data-copy-mode'), 'rich');
    assert.equal(copyBtns[1].getAttribute('data-copy-mode'), 'markdown');

    const prose = viewer.querySelector('.md-prose');
    assert.ok(prose.querySelector('.md-h1'), 'Heading rendered');
    assert.ok(prose.querySelector('strong'), 'Bold rendered');
    assert.ok(prose.querySelector('em'), 'Italic rendered');
    assert.ok(prose.querySelector('.md-inline-code'), 'Inline code rendered');
    assert.ok(prose.querySelector('ul'), 'Unordered list rendered');
    assert.ok(prose.querySelector('ol'), 'Ordered list rendered');
    assert.ok(prose.querySelector('table'), 'Markdown table rendered');
    assert.ok(prose.querySelector('blockquote'), 'Blockquote rendered');
    assert.ok(prose.querySelector('.md-code-block'), 'Fenced code block rendered');

    const links = prose.querySelectorAll('a');
    assert.equal(links.length, 2);
    assert.equal(links[0].href, 'https://personio.de');
    assert.equal(links[0].rel, 'noopener noreferrer');
    assert.equal(links[1].href, 'https://workday.com');

    // Zero raw innerHTML mutation
    assert.equal(collectInnerHtml(viewer), '');
  });

  it('36.2 Neutralizes XSS script tags, img onerror payloads, and javascript:/data: URLs', async () => {
    const dom = createMockDom();
    global.document = dom.document;
    global.window = global;

    const mdMod = await import('../../assets/js/markdown.js');
    const hostile = [
      '# <script>alert(1)</script>',
      'Click [bad](javascript:alert(2)) or [data](data:text/html,<script>alert(3)</script>)',
      '<img src=x onerror=alert(4)>',
      'Safe [link](https://chatlytics.de/report)'
    ].join('\n\n');

    const viewer = mdMod.createMarkdownAnswerViewer(hostile);
    const prose = viewer.querySelector('.md-prose');

    // Only the 1 safe https:// link is rendered as <a>
    const links = prose.querySelectorAll('a');
    assert.equal(links.length, 1);
    assert.equal(links[0].href, 'https://chatlytics.de/report');

    assert.equal(mdMod.sanitizeMarkdownUrl('javascript:alert(1)'), null);
    assert.equal(mdMod.sanitizeMarkdownUrl('data:text/html,hi'), null);
    assert.equal(mdMod.sanitizeMarkdownUrl('//evil.example/x'), null);
    assert.equal(mdMod.sanitizeMarkdownUrl('https://chatlytics.de'), 'https://chatlytics.de');

    // No raw HTML injected into innerHTML anywhere
    assert.equal(collectInnerHtml(viewer), '');
    // Literal text is preserved safely as text nodes
    assert.ok(collectText(prose).includes('<script>alert(1)</script>'));
  });

  it('36.3 Extracts clean plain text & copies exact raw Markdown via delegated copy handler', async () => {
    const dom = createMockDom();
    global.document = dom.document;
    global.window = global;

    let lastCopiedText = null;
    const origNav = global.navigator;
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: {
        clipboard: {
          writeText: async (txt) => { lastCopiedText = txt; }
        }
      }
    });

    try {
      const mdMod = await import('../../assets/js/markdown.js');
      const rawMd = '## Fazit\n\n- **Personio** auf [personio.de](https://personio.de)\n- `DSGVO` konform';

      const plain = mdMod.markdownToPlainText(rawMd);
      assert.ok(plain.includes('Fazit'));
      assert.ok(plain.includes('• Personio auf personio.de (https://personio.de)'));
      assert.equal(plain.includes('**'), false);
      assert.equal(plain.includes('##'), false);

      const host = dom.makeEl('tbody');
      const viewer = mdMod.createMarkdownAnswerViewer(rawMd);
      host.appendChild(viewer);

      const events = [];
      mdMod.bindMarkdownCopyDelegation(host, (mode, ok) => events.push({ mode, ok }));

      const [richBtn, mdBtn] = viewer.querySelectorAll('.md-copy-btn');

      // Click Icon 1: Rich-Text (falls back to clean plain text in mock environment)
      host.dispatch('click', { target: richBtn, stopPropagation: () => {} });
      await new Promise((r) => setTimeout(r, 15));
      assert.equal(lastCopiedText, plain);
      assert.equal(events[0].mode, 'rich');
      assert.equal(events[0].ok, true);

      // Click Icon 2: Exact raw Markdown (.md)
      host.dispatch('click', { target: mdBtn, stopPropagation: () => {} });
      await new Promise((r) => setTimeout(r, 15));
      assert.equal(lastCopiedText, rawMd);
      assert.equal(events[1].mode, 'markdown');
      assert.equal(events[1].ok, true);

      // Verify zero external CDN dependencies in markdown.js
      const src = fs.readFileSync(path.join(PROJECT_ROOT, 'assets/js/markdown.js'), 'utf8');
      assert.equal(/https?:\/\/cdn|unpkg|jsdelivr|cdnjs/i.test(src), false);
    } finally {
      Object.defineProperty(global, 'navigator', { configurable: true, value: origNav });
    }
  });
});
