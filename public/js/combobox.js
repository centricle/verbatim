// An editable combobox: a text field that picks from a list too long for a
// select. Disbursements' office filter is the first, 1,221 names, 1,030 of
// them starting "HON.", so a select's type-a-letter jump lands nowhere useful.
//
// It replaced a native <datalist> (2026-11-19). In real Chrome that hid its
// affordance until hover, left a caret mid-word when clicked after a pick, and
// left typing dead after a click on its indicator; Safari draws and matches
// suggestions its own way; and headless Chrome cannot open the popup at all,
// so no automated check could pick from it. This one behaves the same in every
// browser, and Playwright can drive it.
//
// Pattern: WAI-ARIA APG editable combobox with list autocomplete and manual
// selection. The field shows text; the filter holds a value. The two differ
// only while someone is typing. A value changes when an option is picked, the
// clear button is pressed, or the text is emptied and left; anything else puts
// the text back on close, so half a name never filters.
//
// Markup: an <input data-combobox="<noun>"> inside an element of its own,
// which takes the layout classes. This module adds the buttons and the list
// to that element. Styles: `.combobox` in app.css.

/** Lowercase, spacing collapsed: how both the query and the options compare. */
export function fold(text) {
  return String(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The options a query matches: every word typed appears somewhere in the
 * label, in any case and order ("pelosi", "john carney"). An empty query
 * matches everything.
 * @param {string} query
 * @param {{ value: string, label: string, key: string }[]} options  `key` = fold(label)
 */
export function matchOptions(query, options) {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return options;
  return options.filter((o) => words.every((w) => o.key.includes(w)));
}

/**
 * The option Enter should pick when none is highlighted: the one whose label
 * is the text, else the only match. Null when the text is ambiguous.
 */
export function resolveTyped(text, options) {
  const key = fold(text);
  const exact = options.find((o) => o.key === key);
  if (exact) return exact;
  const shown = matchOptions(text, options);
  return shown.length === 1 ? shown[0] : null;
}

// The selects' chevron (app.css).
export const CHEVRON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const CROSS = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19"/></svg>';

/**
 * The × that clears a field. Out of
 * the tab order, so Tab from the field leaves the widget in one press, and a
 * press on it never takes focus from the field. Hidden until there is
 * something to clear; it needs a positioned parent (`.field-clear` in app.css).
 * @param {string} label
 */
export function clearButton(label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'field-clear';
  button.tabIndex = -1;
  button.setAttribute('aria-label', label);
  button.innerHTML = CROSS;
  button.hidden = true;
  button.addEventListener('mousedown', (e) => e.preventDefault());
  return button;
}

/**
 * @param {HTMLInputElement} input
 * @param {{ noun: string, onPick: (value: string) => void }} opts
 *   `noun` names one option in the buttons' labels ("office").
 *   `onPick` gets each value picked or cleared, '' for cleared.
 */
export function combobox(input, { noun, onPick }) {
  const wrap = input.parentElement;
  const listId = `${input.id}-listbox`;
  wrap.classList.add('combobox');

  // Keyboard users clear by emptying the field and leaving it.
  const clear = clearButton(`Clear ${noun}`);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'combobox-toggle';
  toggle.tabIndex = -1;
  toggle.setAttribute('aria-label', `Show ${noun} list`);
  toggle.setAttribute('aria-controls', listId);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = CHEVRON;

  const list = document.createElement('ul');
  list.id = listId;
  list.className = 'combobox-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', input.getAttribute('aria-label') || noun);
  // Chrome makes a scrolling box a Tab stop of its own; focus stays in the
  // field and the options are reached with the arrow keys.
  list.tabIndex = -1;
  list.hidden = true;

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', listId);
  input.setAttribute('aria-expanded', 'false');
  input.autocomplete = 'off';
  wrap.append(clear, toggle, list);

  let options = [];
  let value = '';
  let open = false;
  let shown = [];
  let active = -1;
  let lastPointer = '';

  function showClear() {
    clear.hidden = !value;
    wrap.classList.toggle('has-value', Boolean(value));
  }

  function setExpanded(on) {
    open = on;
    list.hidden = !on;
    wrap.classList.toggle('is-open', on);
    input.setAttribute('aria-expanded', String(on));
    toggle.setAttribute('aria-expanded', String(on));
  }

  function render(query) {
    shown = matchOptions(query, options);
    active = -1;
    input.removeAttribute('aria-activedescendant');
    const items = shown.map((o, i) => {
      const li = document.createElement('li');
      li.id = `${listId}-${i}`;
      li.dataset.i = String(i);
      li.className = o.value === value ? 'combobox-option is-current' : 'combobox-option';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.textContent = o.label;
      return li;
    });
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'combobox-empty';
      li.textContent = options.length ? `No ${noun} matches` : 'Loading…';
      items.push(li);
    }
    list.replaceChildren(...items);
  }

  // Scrolls the list only, never the page: scrollIntoView would move the
  // window too when the list runs past the fold.
  function reveal(li, center) {
    const top = li.offsetTop;
    const bottom = top + li.offsetHeight;
    if (center) list.scrollTop = top - (list.clientHeight - li.offsetHeight) / 2;
    else if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }

  function setActive(i, center = false) {
    list.children[active]?.classList.remove('is-active');
    list.children[active]?.setAttribute('aria-selected', 'false');
    active = shown.length ? Math.max(-1, Math.min(i, shown.length - 1)) : -1;
    const li = active >= 0 ? list.children[active] : null;
    if (!li) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    li.classList.add('is-active');
    li.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', li.id);
    reveal(li, center);
  }

  // Opened from a click or the arrow keys with nothing typed, the list shows
  // everything with the current pick highlighted and scrolled to.
  function openList(query) {
    render(query);
    setExpanded(true);
    if (query) {
      list.scrollTop = 0;
      return;
    }
    const current = shown.findIndex((o) => o.value === value);
    if (current >= 0) setActive(current, true);
    else list.scrollTop = 0;
  }

  function close() {
    setExpanded(false);
    active = -1;
    input.removeAttribute('aria-activedescendant');
    input.value = value;
  }

  function pick(next) {
    value = next;
    close();
    showClear();
    onPick(value);
  }

  // Text typed and nothing highlighted, on Enter (`loose`) or on leaving the
  // field. Empty text clears; the full text of an option picks it; Enter also
  // takes the only match ("pelosi"), but leaving does not, so a half-typed
  // name never filters by accident. Before the options arrive there is
  // nothing to check the text against, so Enter takes it as typed and the
  // search decides. Returns whether anything was picked.
  function commitTyped(loose) {
    const text = input.value.trim();
    let next = null;
    if (!text) next = '';
    else if (!options.length) next = loose ? text : null;
    else next = (loose ? resolveTyped(text, options) : options.find((o) => o.key === fold(text)))?.value ?? null;
    if (next === null) return false;
    pick(next);
    return true;
  }

  input.addEventListener('focus', () => input.select());
  // A click on a closed field selects the whole text and opens the list, as a
  // select opens on click; a click in an open list's field places the caret.
  input.addEventListener('click', () => {
    if (open) return;
    input.select();
    openList('');
  });
  input.addEventListener('input', () => openList(input.value));

  input.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) {
          openList('');
          if (active < 0 && !e.altKey) setActive(0);
        } else {
          setActive(active + 1);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) {
          openList('');
          if (active < 0) setActive(shown.length - 1);
        } else if (active > 0) {
          setActive(active - 1);
        }
        break;
      case 'PageDown':
      case 'PageUp':
        if (!open) break;
        e.preventDefault();
        setActive(Math.max(0, active + (e.key === 'PageDown' ? 8 : -8)));
        break;
      case 'Enter':
        // A closed field showing its value lets Enter submit the form, as in
        // any other field. Otherwise Enter belongs to the list.
        if (!open && input.value.trim() === value) break;
        e.preventDefault();
        if (open && active >= 0) pick(shown[active].value);
        else commitTyped(true);
        break;
      case 'Escape':
        if (!open && input.value === value) break;
        e.preventDefault();
        close();
        input.select();
        break;
      default:
    }
  });

  wrap.addEventListener('focusout', (e) => {
    if (wrap.contains(e.relatedTarget)) return;
    if (input.value.trim() !== value && commitTyped(false)) return;
    close();
  });

  // Pressing a button or an option must not take focus from the field, or
  // the focusout above would close the list before the click lands.
  for (const el of [toggle, list]) el.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; });

  list.addEventListener('click', (e) => {
    const li = e.target.closest('.combobox-option');
    if (!li) return;
    pick(shown[Number(li.dataset.i)].value);
    // On a phone a focused field keeps the keyboard up over the results.
    if (lastPointer === 'touch') input.blur();
  });
  toggle.addEventListener('click', () => {
    if (open) {
      close();
      return;
    }
    input.focus();
    input.select();
    openList('');
  });
  clear.addEventListener('click', () => {
    pick('');
    input.focus();
  });

  return {
    /** The value from outside (a link, the back button): no onPick. */
    set(next) {
      value = next ?? '';
      if (open) close();
      input.value = value;
      showClear();
    },
    /** Options as `[value, label]` pairs, replacing the last list. */
    setOptions(pairs) {
      options = pairs.map(([v, label]) => ({ value: v, label, key: fold(label) }));
      if (open) openList(input.value === value ? '' : input.value);
    },
  };
}
