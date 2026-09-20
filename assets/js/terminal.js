/* Terminal for navigating the site. Progressive enhancement: the page works
   without it. It builds its file tree from the Explorer markup on the page,
   so it can only ever list what the Explorer lists. */
(function () {
  'use strict';

  var pane = document.querySelector('.terminal');
  var treeList = document.querySelector('.tree > ul');
  if (!pane || !treeList) return;

  var body = pane.querySelector('.pane__body');
  var modeEl = document.querySelector('.status__mode');

  function stripSlash(name) { return name.replace(/\/$/, ''); }

  function parseList(ul) {
    return Array.prototype.map.call(ul.children, function (li) {
      var item = li.querySelector(':scope > .tree__item, :scope > details > .tree__item');
      var clone = item.cloneNode(true);
      var flag = clone.querySelector('.tree__flag');
      if (flag) flag.remove();
      var name = clone.textContent.trim();
      var link = item.tagName === 'A' ? item : item.querySelector('a');
      var sub = li.querySelector(':scope > ul, :scope > details > ul');
      return {
        name: name,
        dir: name.charAt(name.length - 1) === '/',
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

  /* Start in the folder of the page you're on */
  var stack = [root];
  var here0 = findCurrent(root, [root]);
  if (here0) stack = here0[here0.length - 1].dir ? here0 : here0.slice(0, -1);

  function samePage(href) {
    var a = new URL(href);
    var strip = function (p) { return p.replace(/index\.html$/, ''); };
    return a.origin === window.location.origin && strip(a.pathname) === strip(window.location.pathname);
  }

  function pathOf(s) {
    return '~' + s.slice(1).map(function (n) { return '/' + stripSlash(n.name); }).join('');
  }

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
    b.textContent = pathOf(stack);
    prompt.appendChild(b);
    prompt.appendChild(document.createTextNode(' $'));
  }
  renderPrompt();

  function addLine(content, cls) {
    var p = document.createElement('p');
    p.className = 'term__line' + (cls ? ' ' + cls : '');
    if (typeof content === 'string') p.textContent = content;
    else p.appendChild(content);
    log.appendChild(p);
    return p;
  }

  function scrollDown() { body.scrollTop = body.scrollHeight; }

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
      if (r.error) { addLine('ls: ' + r.error, 'term__err'); return; }
      s = r.stack;
    }
    var here = s[s.length - 1];
    if (!here.children.length) { addLine('(empty)', 'term__dim'); return; }
    var line = document.createElement('span');
    here.children.forEach(function (c, i) {
      if (i) line.appendChild(document.createTextNode('   '));
      var el;
      if (c.href && !c.missing) {
        el = document.createElement('a');
        el.href = c.href;
      } else {
        el = document.createElement('span');
        if (c.dir) el.className = 'term__dir';
      }
      el.textContent = c.name;
      line.appendChild(el);
      if (c.missing) {
        var q = document.createElement('span');
        q.className = 'term__dim';
        q.textContent = ' ?';
        line.appendChild(q);
      }
    });
    addLine(line);
  }

  function cmdCd(args) {
    var target = args[0] || '~';
    var r = resolve(target);
    if (r.error) { addLine('cd: ' + r.error, 'term__err'); return; }
    stack = r.stack;
    renderPrompt();
    var here = stack[stack.length - 1];
    if (here.href && !samePage(here.href)) {
      addLine('opening ' + pathOf(stack) + ' ...', 'term__dim');
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
    ].forEach(function (t) { addLine(t); });
  }

  function run(text) {
    var echo = document.createElement('span');
    var pc = document.createElement('span');
    pc.className = 'term__prompt';
    pc.textContent = pathOf(stack) + ' $ ';
    echo.appendChild(pc);
    echo.appendChild(document.createTextNode(text));
    addLine(echo);

    var words = text.trim().split(/\s+/);
    var cmd = words[0];
    if (!cmd) return;
    var args = words.slice(1);

    if (cmd === 'ls') cmdLs(args);
    else if (cmd === 'cd') cmdCd(args);
    else if (cmd === 'help') cmdHelp();
    else if (cmd === 'clear') log.textContent = '';
    else addLine(cmd + ': command not found', 'term__err');
  }

  /* ---- Tab completion ---- */
  var COMMANDS = ['cd', 'clear', 'help', 'ls'];

  function commonPrefix(list) {
    var p = list[0];
    list.forEach(function (w) { while (w.indexOf(p) !== 0) p = p.slice(0, -1); });
    return p;
  }

  function echoInput() {
    var echo = document.createElement('span');
    var pc = document.createElement('span');
    pc.className = 'term__prompt';
    pc.textContent = pathOf(stack) + ' $ ';
    echo.appendChild(pc);
    echo.appendChild(document.createTextNode(input.value));
    addLine(echo);
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
      echoInput();
      addLine(candidates.join('   '), 'term__dim');
      scrollDown();
    }
    return true;
  }

  /* ---- Input ---- */
  var history = [];
  var hIndex = 0;

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var text = input.value;
      if (text.trim()) { history.push(text); }
      hIndex = history.length;
      input.value = '';
      run(text);
      scrollDown();
    } else if (e.key === 'ArrowUp') {
      if (hIndex > 0) { hIndex--; input.value = history[hIndex]; }
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      if (hIndex < history.length - 1) { hIndex++; input.value = history[hIndex]; }
      else { hIndex = history.length; input.value = ''; }
      e.preventDefault();
    } else if (e.key === 'l' && e.ctrlKey) {
      log.textContent = '';
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

  input.addEventListener('focus', function () {
    if (modeEl) { modeEl.textContent = 'TERMINAL'; modeEl.setAttribute('data-mode', 'terminal'); }
  });
  input.addEventListener('blur', function () {
    if (modeEl) { modeEl.textContent = 'NORMAL'; modeEl.removeAttribute('data-mode'); }
  });
})();
