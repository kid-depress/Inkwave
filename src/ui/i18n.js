// UI-only localization. Game IDs, player names and network messages stay in their original form.
import { ZH_CN, ZH_PATTERNS } from './locales/zh-CN.js';

export const LANGUAGES = [['en', 'English'], ['zh-CN', '简体中文']];
export const normalizeLanguage = (value) => value === 'zh-CN' ? 'zh-CN' : 'en';
let language = 'en';
const bindings = new Set();
const targets = new WeakMap();
let richTextRenderer = null;
export function registerRichTextRenderer(renderer) { richTextRenderer = renderer; }
const folded = new Map(Object.entries(ZH_CN).map(([key, value]) => [key.toLowerCase(), value]));

export function getLanguage() { return language; }

export function t(value) {
  const source = String(value ?? '');
  if (language === 'en' || !/[a-z]/i.test(source)) return source;
  const key = source.trim();
  let translated = Object.hasOwn(ZH_CN, key) ? ZH_CN[key] : folded.get(key.toLowerCase());
  if (translated === undefined) {
    for (const [pattern, render] of ZH_PATTERNS) {
      const match = key.match(pattern);
      if (match) { translated = render(...match.slice(1), t); break; }
    }
  }
  if (translated === undefined && key.includes(' · ')) translated = key.split(' · ').map((part) => t(part)).join(' · ');
  return translated === undefined ? source : source.slice(0, source.indexOf(key)) + translated + source.slice(source.indexOf(key) + key.length);
}

function render(binding, target) {
  const value = binding.raw ? binding.source : t(binding.source);
  if (binding.attribute === '_rich') target.innerHTML = richTextRenderer(value);
  else if (binding.attribute) target.setAttribute(binding.attribute, value);
  else if (target.nodeType === 3) target.data = value;
}

function bind(target, source, attribute = '', raw = false) {
  let entries = targets.get(target);
  if (!entries) { entries = new Map(); targets.set(target, entries); }
  let binding = entries.get(attribute);
  if (!binding) {
    binding = { ref: new WeakRef(target), attribute, source: '', raw };
    entries.set(attribute, binding);
    bindings.add(binding);
    // Detached screens can be collected without keeping their DOM or callbacks alive.
    if (bindings.size % 512 === 0) for (const item of bindings) if (!item.ref.deref()) bindings.delete(item);
  }
  binding.source = String(source ?? '');
  binding.raw = raw;
  render(binding, target);
}

export function setLanguage(value) {
  language = normalizeLanguage(value);
  if (typeof document !== 'undefined') document.documentElement.lang = language;
  for (const binding of bindings) {
    const target = binding.ref.deref();
    if (target) render(binding, target);
    else bindings.delete(binding);
  }
  return language;
}

/** Use for changing UI copy, including HUD labels updated after construction. */
export function setText(element, value, raw = false) {
  const source = String(value ?? '');
  if (element.childNodes.length !== 1 || element.firstChild.nodeType !== 3) element.textContent = source;
  const node = element.firstChild;
  if (node) bind(node, source, '', raw || element.closest('[translate="no"]') !== null);
  return value;
}

export function localizeAttribute(element, name, value) { bind(element, value, name); }

/** Localize text nodes only: never replace HTML, SVG attributes, IDs or event handlers with translated strings. */
export function localizeTree(root) {
  const visit = (node) => {
    if (node.nodeType === 3) {
      if (/[a-z]/i.test(node.data)) bind(node, node.data);
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    if (node.nodeType === 1) {
      if (node.matches('[translate="no"], script, style, input, textarea, .iw-key, .iw-pad, .iw-padg')) return;
      if (node.hasAttribute('data-i18n-rich') && richTextRenderer) {
        bind(node, node.getAttribute('data-i18n-rich'), '_rich');
        return;
      }
      for (const name of ['title', 'aria-label', 'placeholder']) {
        if (node.hasAttribute(name) && !targets.get(node)?.has(name)) localizeAttribute(node, name, node.getAttribute(name));
      }
    }
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
}

export function setHTML(element, markup) {
  element.innerHTML = markup;
  if (!element.closest('[translate="no"]')) localizeTree(element);
  return markup;
}
