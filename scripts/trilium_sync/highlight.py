"""A small syntax highlighter for code blocks. Standard library only.

It is deliberately simple: a tokenizer per language family, no parsing. It marks
comments, strings, numbers, keywords, types, function calls and (for C) preprocessor
lines with classes the stylesheet colours like Rose Pine in Neovim.
"""
import html
import re

C_KEYWORDS = {
    "auto", "break", "case", "const", "continue", "default", "do", "else", "enum", "extern",
    "for", "goto", "if", "inline", "register", "return", "sizeof", "static", "struct", "switch",
    "typedef", "union", "volatile", "while", "class", "public", "private", "protected", "namespace",
    "template", "using", "new", "delete", "true", "false", "nullptr", "NULL", "this", "try", "catch",
    "throw", "constexpr", "override", "virtual", "_Static_assert", "static_assert",
}
C_TYPES = {
    "int", "char", "short", "long", "float", "double", "void", "unsigned", "signed", "bool",
    "size_t", "ssize_t", "string", "byte", "word",
}
PY_KEYWORDS = {
    "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
    "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda",
    "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
    "True", "False", "None",
}
JS_KEYWORDS = {
    "async", "await", "break", "case", "catch", "class", "const", "continue", "default", "delete",
    "do", "else", "export", "extends", "finally", "for", "from", "function", "if", "import", "in",
    "instanceof", "let", "new", "of", "return", "static", "super", "switch", "this", "throw", "try",
    "typeof", "var", "void", "while", "yield", "true", "false", "null", "undefined",
}
SH_KEYWORDS = {
    "if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac",
    "function", "in", "return", "exit", "export", "local", "source",
}

# Each language: comment pattern, keyword set, type set, and whether calls are marked.
LANGS = {
    "c": (r"//[^\n]*|/\*.*?\*/", C_KEYWORDS, C_TYPES, True),
    "js": (r"//[^\n]*|/\*.*?\*/", JS_KEYWORDS, set(), True),
    "python": (r"#[^\n]*", PY_KEYWORDS, set(), True),
    "bash": (r"(?<![^\s])#[^\n]*", SH_KEYWORDS, set(), False),
}

ALIASES = {
    "c": "c", "cpp": "c", "c++": "c", "h": "c", "ino": "c", "arduino": "c", "csrc": "c",
    "js": "js", "javascript": "js", "ts": "js", "typescript": "js", "jsx": "js", "tsx": "js",
    "python": "python", "py": "python",
    "bash": "bash", "sh": "bash", "shell": "bash", "zsh": "bash", "console": "bash",
}

STRING = r'"""(?:.|\n)*?"""|\'\'\'(?:.|\n)*?\'\'\'|"(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\''
NUMBER = r"\b(?:0[xX][0-9A-Fa-f]+|0[bB][01]+|\d+\.?\d*(?:[eE][+-]?\d+)?)[uUlLfF]*\b"
IDENT = r"[A-Za-z_]\w*"


def _wrap(cls, text):
    return '<span class="%s">%s</span>' % (cls, html.escape(text, quote=False))


def _compile(lang):
    comment, _, _, _ = LANGS[lang]
    parts = [
        ("com", comment),
        ("str", STRING),
    ]
    if lang == "c":
        parts.append(("pre", r"^[ \t]*#[ \t]*[A-Za-z_]+"))
    if lang == "bash":
        parts.append(("var", r"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"))
    parts += [("num", NUMBER), ("id", IDENT)]
    return re.compile("|".join("(?P<%s>%s)" % p for p in parts), re.DOTALL | re.MULTILINE)


_COMPILED = {}


def highlight(text, lang):
    """Escaped HTML for `text` with token spans, for a known language key."""
    if lang not in _COMPILED:
        _COMPILED[lang] = _compile(lang)
    _, keywords, types, calls = LANGS[lang]
    out, pos = [], 0
    for m in _COMPILED[lang].finditer(text):
        out.append(html.escape(text[pos:m.start()], quote=False))
        pos, kind, tok = m.end(), m.lastgroup, m.group()
        if kind == "com":
            out.append(_wrap("tok-com", tok))
        elif kind == "str":
            out.append(_wrap("tok-str", tok))
        elif kind == "pre":
            out.append(_wrap("tok-pre", tok))
        elif kind == "var":
            out.append(_wrap("tok-var", tok))
        elif kind == "num":
            out.append(_wrap("tok-num", tok))
        else:                                   # identifier
            if tok in keywords:
                out.append(_wrap("tok-kw", tok))
            elif tok in types or (lang == "c" and re.fullmatch(r"u?int\d*_t|[A-Za-z0-9_]+_t", tok)):
                out.append(_wrap("tok-type", tok))
            elif calls and re.match(r"\s*\(", text[m.end():m.end() + 8]):
                out.append(_wrap("tok-fn", tok))
            else:
                out.append(html.escape(tok, quote=False))
    out.append(html.escape(text[pos:], quote=False))
    return "".join(out)


def guess(text):
    """Best guess of a language when the note does not say. Conservative: None if unsure."""
    c_signs = [r"#\s*include", r"#\s*define", r"\btypedef\b", r"\bstruct\b", r"\b(?:u?int\d+_t)\b",
               r"\bvoid\b", r"\bstatic\b", r"\breturn\b", r"\bsizeof\b", r"->", r"(?m);\s*$", r"[{}]"]
    if sum(1 for p in c_signs if re.search(p, text)) >= 3:
        return "c"
    py_signs = [r"(?m)^\s*def \w+\(", r"(?m)^\s*import \w+", r"(?m)^\s*class \w+", r"\bprint\(", r"(?m):\s*$"]
    if sum(1 for p in py_signs if re.search(p, text)) >= 2:
        return "python"
    if text.startswith("#!") or len(re.findall(r"(?m)^\$ ", text)) >= 1:
        return "bash"
    js_signs = [r"\bconst\b", r"\blet\b", r"\bfunction\b", r"=>", r"console\.log"]
    if sum(1 for p in js_signs if re.search(p, text)) >= 2:
        return "js"
    return None


def language_from_mime(mime):
    """The language a Trilium code note declares through its MIME type, or None."""
    mime = (mime or "").lower()
    if "csrc" in mime or "c++" in mime or "chdr" in mime:
        return "c"
    if "python" in mime:
        return "python"
    if "javascript" in mime or "typescript" in mime:
        return "js"
    if "shell" in mime or mime.endswith("/x-sh") or mime.endswith("/x-bash"):
        return "bash"
    return None


def render(text, language=None):
    """HTML for the inside of <code>. `language` may be a Trilium/CKEditor name, or None."""
    lang = ALIASES.get((language or "").lower())
    if lang is None:
        lang = guess(text)
    if lang is None:
        return html.escape(text, quote=False)
    return highlight(text, lang)
