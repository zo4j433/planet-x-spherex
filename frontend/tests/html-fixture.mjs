import assert from 'node:assert/strict';

// Small, dependency-free reader for our static HTML. Keep text separate from
// attributes so an attribute label, URL or bit-definition table cannot satisfy help.
export function parseHtml(html) {
  const root = { tag: '#document', attrs: {}, children: [] }, stack = [root];
  const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const token of html.replace(/<!--[\s\S]*?-->/g, '').match(/<[^>]+>|[^<]+/g) || []) {
    if (/^<!/i.test(token)) continue;
    const closing = token.match(/^<\/([\w-]+)/);
    if (closing) {
      assert.equal(stack.pop()?.tag, closing[1].toLowerCase(), `Mismatched closing tag: ${token}`);
    } else if (token.startsWith('<')) {
      const [, tag, source] = token.match(/^<([\w-]+)\b([^>]*)>/) || [];
      assert.ok(tag, `Invalid tag: ${token}`);
      const attrs = {};
      for (const [, key, double, single, bare] of source.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        attrs[key.toLowerCase()] = double ?? single ?? bare ?? '';
      }
      const node = { tag: tag.toLowerCase(), attrs, children: [] };
      stack.at(-1).children.push(node);
      if (!voids.has(node.tag)) stack.push(node);
    } else stack.at(-1).children.push(token);
  }
  assert.equal(stack.length, 1, 'Unclosed HTML elements');
  return root;
}

export function elements(node, predicate) {
  return node.children.flatMap(child => typeof child === 'string' ? [] :
    [...(predicate(child) ? [child] : []), ...elements(child, predicate)]);
}

export function byId(root, id) {
  const matches = elements(root, node => node.attrs.id === id);
  assert.equal(matches.length, 1, `Expected one DOM element #${id}`);
  return matches[0];
}

export function textContent(node) {
  return node.children.map(child => typeof child === 'string' ? child : textContent(child)).join(' ')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|le|ge|nbsp|ndash|mdash|deg);/gi, (_, entity) => {
      if (entity[0] === '#') return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
      return { amp: '&', lt: '<', gt: '>', le: '≤', ge: '≥', nbsp: ' ', ndash: '–', mdash: '—', deg: '°' }[entity.toLowerCase()];
    }).replace(/\s+/g, ' ').trim();
}

export const normalizedText = node => textContent(node).toLowerCase()
  .replace(/[!?]/g, '.').replace(/[-–—/,:()]/g, ' ').replace(/\s+/g, ' ').trim();

// Match a subject/relation/object within one sentence or clause, never a bag of
// keywords collected across unrelated paragraphs. New paraphrases belong here
// only with positive and negative examples in ui-text.test.mjs.
export function claim(node, pattern, message) {
  const clauses = elements(node, child => child.tag === 'p')
    .flatMap(paragraph => normalizedText(paragraph).split(/[.;]/));
  assert.ok(clauses.some(clause => pattern.test(clause.trim())), message);
}
