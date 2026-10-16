/*
 * Tiny DOM helpers shared by every screen.
 *
 *   h('button', { class: 'btn', onclick: fn }, 'Play')
 *   toast('Saved'); await confirmDialog('Delete?'); openModal(content)
 */

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [prop, val] of Object.entries(v)) {
          if (val === undefined || val === null) continue;
          if (prop.startsWith('--')) el.style.setProperty(prop, String(val));
          else el.style[prop] = val;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.append(c);
    else el.append(document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(text, kind = '', ms = 2400) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const t = h('div', { class: `toast ${kind}` }, text);
  root.append(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 320);
  }, ms);
}

let modalStack = [];

// Open a modal with any content. Returns { close, el }.
export function openModal(content, { wide = false, onClose, dismissable = true } = {}) {
  const root = document.getElementById('modalRoot');
  const box = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true' }, content);
  const backdrop = h('div', { class: 'modal-backdrop' }, box);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    modalStack = modalStack.filter((m) => m !== api);
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissable && modalStack[modalStack.length - 1] === api) {
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  };
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop && dismissable) close();
  });
  document.addEventListener('keydown', onKey, true);
  root.append(backdrop);
  const api = { close, el: box };
  modalStack.push(api);
  const focusable = box.querySelector('[autofocus], input, select, textarea, button');
  if (focusable) setTimeout(() => focusable.focus(), 30);
  return api;
}

export function modalOpen() {
  return modalStack.length > 0;
}

export function confirmDialog(message, { ok = 'OK', cancel = 'Cancel', danger = false, title = '' } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const m = openModal([
      title ? h('h2', null, title) : null,
      h('p', null, message),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, cancel),
        h('button', { class: `btn ${danger ? 'bad' : 'primary'}`, type: 'button', autofocus: true, onclick: () => { result = true; m.close(); } }, ok),
      ),
    ], { onClose: () => resolve(result) });
  });
}

export function promptDialog(message, value = '', { ok = 'OK', title = '', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input', { type: 'text', value, placeholder, autofocus: true });
    const submit = () => { result = input.value; m.close(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    const m = openModal([
      title ? h('h2', null, title) : null,
      h('label', null, message),
      input,
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', onclick: submit }, ok),
      ),
    ], { onClose: () => resolve(result) });
  });
}

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Deterministic random numbers (bingo cards, quizzes that must match on two screens).
export function seeded(seed) {
  let s = (Number(seed) >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export function pick(arr, rnd = Math.random) {
  return arr[Math.floor(rnd() * arr.length)];
}

const LEVEL_HUES = { 'Pre-A1': 140, A1: 160, A2: 200, B1: 250, B2: 290, C1: 330 };

export function levelBadge(level) {
  return h('span', { class: 'badge level', style: { '--lvl-hue': LEVEL_HUES[level] || 245 } }, level || '—');
}

// Is the user typing in a field? (keyboard shortcuts must stay quiet then)
export function typingTarget(e) {
  const t = e.target;
  if (!t) return false;
  const tag = (t.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
}

export function debounce(fn, ms = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
