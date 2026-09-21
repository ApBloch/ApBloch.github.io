/* Terminal for navigating the site. Progressive enhancement: the page works
   without it. It builds its file tree from the Explorer markup on the page,
   so it can only ever list what the Explorer lists.

   The terminal keeps its state (folder, history, output) while you move between
   pages, in sessionStorage. That lasts until the tab is closed. */
(function () {
  'use strict';

  var pane = document.querySelector('.terminal');
  var treeList = document.querySelector('.tree > ul');
  if (!pane || !treeList) return;

  var body = pane.querySelector('.pane__body');
  var modeEl = document.querySelector('.status__mode');

  function stripSlash(name) { return name.replace(/\/$/, ''); }

  /* ---- File tree, read from the Explorer ---- */
  function parseList(ul) {
    return Array.prototype.map.call(ul.children, function (li) {
      var item = li.querySelector(':scope > .tree__item, :scope > details > .tree__item');
      var clone = item.cloneNode(true);
      var flag = clone.querySelector('.tree__flag');
      if (flag) flag.remove();
      var link = item.tagName === 'A' ? item : item.querySelector('a');
      var sub = li.querySelector(':scope > ul, :scope > details > ul');
      return {
        name: clone.textContent.trim(),
        dir: !item.classList.contains('tree__file'),
        href: link ? link.href : null,
        current: !!(link && link.getAttribute('aria-current') === 'page'),
        missing: item.classList.contains('is-missing'),
        children: sub ? parseList(sub) : []
      };
    });
  }

  var root = { name: '~', dir: true, href: null, missing: false, children: parseList(treeList) };
  var homeEntry = root.children.filter(function (c) { return c.name === 'index.html'; })[0];
  root.href = homeEntry ? homeEntry.href : null;

  function findCurrent(node, path) {
    for (var i = 0; i < node.children.length; i++) {
      var p = path.concat([node.children[i]]);
      if (node.children[i].current) return p;
      var r = findCurrent(node.children[i], p);
      if (r) return r;
    }
    return null;
  }

  function samePage(href) {
    var a = new URL(href);
    var strip = function (p) { return p.replace(/index\.html$/, ''); };
    return a.origin === window.location.origin && strip(a.pathname) === strip(window.location.pathname);
  }

  function pathOf(s) {
    return '~' + s.slice(1).map(function (n) { return '/' + stripSlash(n.name); }).join('');
  }

  /* Prompts show a shortened path so a deep page cannot push the layout sideways */
  function promptPath(s) {
    var names = s.slice(1).map(function (n) { return stripSlash(n.name); });
    return names.length > 2 ? '~/…/' + names.slice(-2).join('/') : pathOf(s);
  }

  /* ---- Saved state ---- */
  var STORE = 'siteTerminal';
  var MAX_LINES = 200;
  var MAX_HISTORY = 100;

  function loadState() {
    try {
      var saved = JSON.parse(window.sessionStorage.getItem(STORE));
      if (saved && typeof saved === 'object') return saved;
    } catch (e) { /* storage unavailable or corrupt: start fresh */ }
    return null;
  }

  var saved = loadState();
  var state = {
    cwd: saved && Array.isArray(saved.cwd) ? saved.cwd : null,
    history: saved && Array.isArray(saved.history) ? saved.history : [],
    lines: saved && Array.isArray(saved.lines) ? saved.lines : [],
    refocus: !!(saved && saved.refocus)
  };

  function save() {
    try { window.sessionStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  /* Where the terminal starts: where it was left, otherwise the folder of this page */
  function stackFromNames(names) {
    var s = [root];
    for (var i = 0; i < names.length; i++) {
      var here = s[s.length - 1], next = null;
      for (var j = 0; j < here.children.length; j++) {
        var c = here.children[j];
        if (c.dir && !c.missing && stripSlash(c.name) === names[i]) { next = c; break; }
      }
      if (!next) return null;              // the site changed since: fall back
      s.push(next);
    }
    return s;
  }

  var stack = state.cwd ? stackFromNames(state.cwd) : null;
  if (!stack) {
    stack = [root];
    var here0 = findCurrent(root, [root]);
    if (here0) stack = here0[here0.length - 1].dir ? here0 : here0.slice(0, -1);
  }

  function rememberCwd() {
    state.cwd = stack.slice(1).map(function (n) { return stripSlash(n.name); });
    save();
  }
  rememberCwd();       /* the starting folder counts too: only typing may change it */

  /* ---- DOM ---- */
  var log = document.createElement('div');
  log.className = 'term__log';
  log.setAttribute('role', 'log');
  log.setAttribute('aria-label', 'Terminal output');

  var row = document.createElement('label');
  row.className = 'term__row';
  var prompt = document.createElement('span');
  prompt.className = 'term__prompt';
  var input = document.createElement('input');
  input.className = 'term__input';
  input.type = 'text';
  input.setAttribute('aria-label', 'Terminal input');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('spellcheck', 'false');
  input.placeholder = 'type help';
  row.appendChild(prompt);
  row.appendChild(input);

  pane.hidden = false;
  body.appendChild(log);
  body.appendChild(row);

  function renderPrompt() {
    prompt.innerHTML = '';
    var b = document.createElement('b');
    b.textContent = promptPath(stack);
    prompt.appendChild(b);
    prompt.appendChild(document.createTextNode(' $'));
  }
  renderPrompt();

  function scrollDown() { body.scrollTop = body.scrollHeight; }

  /* Output is kept as small records so it can be saved and redrawn on the next page:
       {t:'text', x, c}            a line of text with an optional class
       {t:'echo', p, x}            a command you typed, with its prompt
       {t:'ls', e:[{n,h,d,m}]}     a listing: name, link, is-folder, not-written-yet */
  function drawRecord(rec) {
    var p = document.createElement('p');
    p.className = 'term__line' + (rec.c ? ' ' + rec.c : '');
    if (rec.t === 'text') {
      p.textContent = rec.x;
    } else if (rec.t === 'echo') {
      var pc = document.createElement('span');
      pc.className = 'term__prompt';
      pc.textContent = rec.p + ' $ ';
      p.appendChild(pc);
      p.appendChild(document.createTextNode(rec.x));
    } else if (rec.t === 'ls') {
      rec.e.forEach(function (c, i) {
        if (i) p.appendChild(document.createTextNode('   '));
        var el;
        if (c.h && !c.m) {
          el = document.createElement('a');
          el.href = c.h;
        } else {
          el = document.createElement('span');
          if (c.d) el.className = 'term__dir';
        }
        el.textContent = c.n;
        p.appendChild(el);
        if (c.m) {
          var q = document.createElement('span');
          q.className = 'term__dim';
          q.textContent = ' ?';
          p.appendChild(q);
        }
      });
    }
    log.appendChild(p);
  }

  function addRecord(rec) {
    state.lines.push(rec);
    if (state.lines.length > MAX_LINES) state.lines.shift();
    drawRecord(rec);
    save();
  }

  function addText(text, cls) { addRecord({ t: 'text', x: text, c: cls || '' }); }

  function clearScreen() {
    state.lines = [];
    log.textContent = '';
    save();
  }

  state.lines.forEach(drawRecord);
  scrollDown();

  /* ---- Commands ---- */
  function resolve(arg) {
    var s = stack.slice();
    var parts = arg.split('/').filter(function (p) { return p !== ''; });
    if (arg.charAt(0) === '/' || arg === '~' || arg.indexOf('~/') === 0) {
      s = [root];
      if (parts[0] === '~') parts.shift();
    }
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (part === '.') continue;
      if (part === '..') { if (s.length > 1) s.pop(); continue; }
      var here = s[s.length - 1];
      var child = null;
      for (var j = 0; j < here.children.length; j++) {
        if (stripSlash(here.children[j].name) === part) { child = here.children[j]; break; }
      }
      if (!child) return { error: arg + ': no such file or directory' };
      if (!child.dir) return { error: arg + ': not a directory' };
      if (child.missing) return { error: part + '/ is not written yet' };
      s.push(child);
    }
    return { stack: s };
  }

  function cmdLs(args) {
    var s = stack;
    if (args[0]) {
      var r = resolve(args[0]);
      if (r.error) { addText('ls: ' + r.error, 'term__err'); return; }
      s = r.stack;
    }
    var here = s[s.length - 1];
    if (!here.children.length) { addText('(empty)', 'term__dim'); return; }
    addRecord({
      t: 'ls',
      e: here.children.map(function (c) {
        return { n: stripSlash(c.name) + (c.dir ? '/' : ''), h: c.href, d: c.dir, m: c.missing };
      })
    });
  }

  function cmdCd(args) {
    var target = args[0] || '~';
    var r = resolve(target);
    if (r.error) { addText('cd: ' + r.error, 'term__err'); return; }
    stack = r.stack;
    renderPrompt();
    rememberCwd();
    var here = stack[stack.length - 1];
    if (here.href && !samePage(here.href)) {
      addText('opening ' + pathOf(stack) + ' ...', 'term__dim');
      state.refocus = true;                  // keep typing on the next page
      save();
      window.location.assign(here.href);
    }
  }

  function cmdHelp() {
    [
      'ls [dir]        list a folder (a ? means not written yet)',
      'cd <dir>        change folder; opens the page if the folder has one',
      'clear           clear the screen',
      'help            show this list',
      'Tab             complete a command or folder name',
      'Esc             leave the terminal'
    ].forEach(function (t) { addText(t); });
  }

  function run(text) {
    addRecord({ t: 'echo', p: promptPath(stack), x: text });

    var words = text.trim().split(/\s+/);
    var cmd = words[0];
    if (!cmd) return;
    var args = words.slice(1);

    if (cmd === 'ls') cmdLs(args);
    else if (cmd === 'cd') cmdCd(args);
    else if (cmd === 'help') cmdHelp();
    else if (cmd === 'clear') clearScreen();
    else addText(cmd + ': command not found', 'term__err');
  }

  /* ---- Tab completion ---- */
  var COMMANDS = ['cd', 'clear', 'help', 'ls'];

  function commonPrefix(list) {
    var p = list[0];
    list.forEach(function (w) { while (w.indexOf(p) !== 0) p = p.slice(0, -1); });
    return p;
  }

  /* Returns true if it handled Tab; false lets Tab move focus as normal. */
  function complete() {
    var value = input.value;
    if (!value.trim()) return false;
    var m = value.match(/^(\s*)(\S*)(\s+)?(.*)$/);
    var inCommand = !m[3];
    var candidates, prefix, before, isDirs = false;

    if (inCommand) {
      prefix = m[2];
      before = m[1];
      candidates = COMMANDS.filter(function (c) { return c.indexOf(prefix) === 0; });
    } else {
      var cmd = m[2];
      if (cmd !== 'cd' && cmd !== 'ls') return false;
      var arg = m[4];
      if (/\s/.test(arg)) return false;
      var slash = arg.lastIndexOf('/');
      var dirPart = slash >= 0 ? arg.slice(0, slash + 1) : '';
      prefix = arg.slice(slash + 1);
      before = value.slice(0, value.length - prefix.length);
      var base = stack;
      if (dirPart) {
        var r = resolve(dirPart);
        if (r.error) return false;
        base = r.stack;
      }
      isDirs = true;
      candidates = base[base.length - 1].children.filter(function (c) {
        return c.dir && !c.missing && stripSlash(c.name).indexOf(prefix) === 0;
      }).map(function (c) { return stripSlash(c.name); });
    }

    if (!candidates.length) return false;

    var common = commonPrefix(candidates);
    if (candidates.length === 1) {
      input.value = before + common + (isDirs ? '/' : ' ');
    } else if (common.length > prefix.length) {
      input.value = before + common;
    } else {
      addRecord({ t: 'echo', p: promptPath(stack), x: input.value });
      addText(candidates.join('   '), 'term__dim');
      scrollDown();
    }
    return true;
  }

  /* ---- Input ---- */
  var hIndex = state.history.length;

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var text = input.value;
      if (text.trim()) {
        state.history.push(text);
        if (state.history.length > MAX_HISTORY) state.history.shift();
        save();
      }
      hIndex = state.history.length;
      input.value = '';
      run(text);
      scrollDown();
    } else if (e.key === 'ArrowUp') {
      if (hIndex > 0) { hIndex--; input.value = state.history[hIndex]; }
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      if (hIndex < state.history.length - 1) { hIndex++; input.value = state.history[hIndex]; }
      else { hIndex = state.history.length; input.value = ''; }
      e.preventDefault();
    } else if (e.key === 'l' && e.ctrlKey) {
      clearScreen();
      e.preventDefault();
    } else if (e.key === 'Tab' && !e.shiftKey) {
      if (complete()) e.preventDefault();
    } else if (e.key === 'Escape') {
      input.blur();
    }
  });

  pane.addEventListener('click', function (e) {
    if (e.target.closest('a')) return;
    if (window.getSelection && String(window.getSelection())) return;
    input.focus();
  });

  function setMode(terminal) {
    if (!modeEl) return;
    modeEl.textContent = terminal ? 'TERMINAL' : 'NORMAL';
    if (terminal) modeEl.setAttribute('data-mode', 'terminal');
    else modeEl.removeAttribute('data-mode');
  }
  input.addEventListener('focus', function () { setMode(true); });
  input.addEventListener('blur', function () { setMode(false); });

  /* If a cd brought us to this page, carry on typing */
  if (state.refocus) {
    state.refocus = false;
    save();
    input.focus();
    setMode(document.activeElement === input);
  }
})();
