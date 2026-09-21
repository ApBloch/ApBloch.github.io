"""Convert Trilium note HTML into the site's markup. Standard library only.

The converter is an allow-list: only tags the site's stylesheet knows about
come through, and every attribute is dropped except a few that are checked.
Trilium's editor classes, inline styles and scripts never reach the site.

It also adds a little editor-style colour, all at build time:
  - code blocks are syntax highlighted,
  - a "Label:" at the start of a paragraph or list item becomes a `key` span,
  - numbers, with their units, become `num` spans.
"""
import html
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser

import highlight

ALLOWED = {
    "p", "ul", "ol", "li", "strong", "em", "code", "pre", "blockquote",
    "table", "thead", "tbody", "tr", "th", "td", "figcaption",
    "h2", "h3", "h4", "h5", "h6",
}
BLOCK = {
    "p", "ul", "ol", "li", "pre", "blockquote", "table", "thead", "tbody",
    "tr", "figcaption", "h2", "h3", "h4", "h5", "h6",
}
ALIASES = {"b": "strong", "i": "em", "h1": "h2"}  # a page has one h1: its title
DROP_CONTENT = {"script", "style"}
SAFE_SCHEMES = ("http://", "https://", "mailto:")

# Places where numbers and labels are left alone: links, code, headings, table labels.
PLAIN_TEXT_IN = {"a", "code", "pre", "th", "h2", "h3", "h4", "h5", "h6", "figcaption"}
# "Label: value" at the very start of a paragraph or list item.
KEY = re.compile(r"^([A-Za-z][A-Za-z0-9 ()/&'-]{0,40}:)(?=\s|$)")
# A number, with an attached unit if there is one: 50.00/s, 0x73, 3450mAh, 9V, 0.00%
NUMBER = re.compile(
    r"(?<![\w.])(?:0[xX][0-9A-Fa-f]+|\d+(?:[.,]\d+)*)"
    r"(?:[A-Za-z%°µΩ]+(?:/[A-Za-z]+)?|/[A-Za-z]+)?(?!\w)"
)
LANGUAGE_CLASS = re.compile(r"language-([A-Za-z0-9+#_-]+)")

# The first words of each sentence (in paragraphs and list items) get a `lead` span.
# The run is up to LEAD_WORDS words and stops early at punctuation or at a number,
# so numbers keep their own colour.
LEAD_WORDS = 3
PROSE_TAGS = {"p", "li", "blockquote"}
_WORD = r"[A-Za-z][A-Za-z0-9'’_/-]*"
WORD = re.compile(_WORD + r"(?:[ \t]+" + _WORD + r"){0,%d}" % (LEAD_WORDS - 1))
SENTENCE_BREAK = re.compile(
    r"([.!?][\"')\]]*)(\s+)([A-Z][A-Za-z0-9'’_/-]*(?:[ \t]+" + _WORD + r"){0,%d})" % (LEAD_WORDS - 1))
SENTENCE_END = re.compile(r"[.!?][\"')\]]*\s*$")
NOT_A_SENTENCE_END = {"e.g", "i.e", "vs", "etc", "approx", "fig", "no", "dr", "mr", "mrs", "st", "cf"}

INTERNAL_LINK = re.compile(r"#root/(?:[A-Za-z0-9_]+/)*([A-Za-z0-9_]+)")
ATTACHMENT_SRC = re.compile(r"attachments/([A-Za-z0-9_]+)/image/([^?#]+)")
IMAGE_NOTE_SRC = re.compile(r"images/([A-Za-z0-9_]+)/([^?#]+)")


@dataclass
class ImageRef:
    kind: str       # "attachment" or "note"
    ident: str      # attachment id or image note id
    filename: str
    alt: str


@dataclass
class Result:
    html: str
    images: list = field(default_factory=list)
    unresolved_links: list = field(default_factory=list)
    warnings: list = field(default_factory=list)


class _Converter(HTMLParser):
    def __init__(self, resolve_link, image_url):
        super().__init__(convert_charrefs=True)
        self._resolve_link = resolve_link
        self._image_url = image_url
        self.out = []
        self.images = []
        self.unresolved = []
        self.warnings = []
        self._skip = 0
        self._stack = []           # (tag, closing markup) for each open tag
        self._pre = None           # inside a code block: its raw text and language
        self._block_start = False  # True right after an opening <p> or <li>
        self._sentence_start = False  # the next word of prose begins a sentence

    # -- helpers ---------------------------------------------------------
    def _push(self, tag, close=""):
        self._stack.append((tag, close))

    def _link_target(self, href):
        match = INTERNAL_LINK.search(href)
        if match:
            note_id = match.group(1)
            url = self._resolve_link(note_id) if self._resolve_link else None
            if not url:
                self.unresolved.append(note_id)
            return url
        if href.startswith(SAFE_SCHEMES):
            return href
        if href:
            self.warnings.append("dropped a link with an unsupported target")
        return None

    def _image(self, attrs):
        src = attrs.get("src", "")
        match = ATTACHMENT_SRC.search(src)
        kind = "attachment"
        if not match:
            match = IMAGE_NOTE_SRC.search(src)
            kind = "note"
        if not match:
            self.warnings.append("dropped an image with an unrecognised source")
            return
        ref = ImageRef(kind, match.group(1), match.group(2), attrs.get("alt", "").strip())
        self.images.append(ref)
        url = self._image_url(ref) if self._image_url else None
        if url:
            if not ref.alt:
                self.warnings.append("image %s has no alt text" % ref.filename)
            css = ' class="diagram"' if url.lower().endswith(".svg") else ""
            self.out.append(
                '<img%s src="%s" alt="%s" loading="lazy">'
                % (css, html.escape(url, quote=True), html.escape(ref.alt, quote=True))
            )
        else:
            self.out.append("<p>Image coming soon</p>")

    def _numbers(self, text):
        """Escape `text`, wrapping numbers (with their units) in a span."""
        out, pos = [], 0
        for m in NUMBER.finditer(text):
            out.append(html.escape(text[pos:m.start()], quote=False))
            out.append('<span class="num">%s</span>' % html.escape(m.group(), quote=False))
            pos = m.end()
        out.append(html.escape(text[pos:], quote=False))
        return "".join(out)

    # -- parser callbacks ------------------------------------------------
    def handle_starttag(self, tag, attrs):
        if tag in DROP_CONTENT:
            self._skip += 1
            return
        if self._skip:
            return
        tag = ALIASES.get(tag, tag)
        attrs = dict(attrs)

        if self._pre is not None:                 # inside a code block: keep the text raw
            if tag == "code":
                found = LANGUAGE_CLASS.search(attrs.get("class") or "")
                self._pre["lang"] = found.group(1) if found else ""
            elif tag == "br":
                self._pre["text"].append("\n")
            return
        self._block_start = False

        if tag == "pre":
            self._pre = {"text": [], "lang": ""}
            self._push(tag)
        elif tag == "img":
            self._image(attrs)
        elif tag in ("br", "hr"):
            self.out.append("<%s>" % tag)
        elif tag == "figure":
            if "table" in (attrs.get("class") or "").split():
                self._push(tag)               # Trilium's table wrapper: unwrap
            else:
                self.out.append("<figure>\n")
                self._push(tag, "</figure>\n")
        elif tag == "table":
            self.out.append('<div class="table-wrap">\n<table>')
            self._push(tag, "</table>\n</div>\n")
        elif tag == "a":
            url = self._link_target(attrs.get("href", ""))
            if url:
                self.out.append('<a href="%s">' % html.escape(url, quote=True))
                self._push(tag, "</a>")
            else:
                self._push(tag)               # keep the text, lose the link
        elif tag in ALLOWED:
            self.out.append("<%s>" % tag)
            self._push(tag, "</%s>%s" % (tag, "\n" if tag in BLOCK else ""))
            self._block_start = tag in ("p", "li")
            if tag in ("p", "li"):
                self._sentence_start = True
        else:
            self._push(tag)                   # span, div, etc: unwrap

    def handle_endtag(self, tag):
        if tag in DROP_CONTENT:
            self._skip = max(0, self._skip - 1)
            return
        if self._skip:
            return
        tag = ALIASES.get(tag, tag)
        if tag in ("p", "li"):
            self._sentence_start = False
        if self._pre is not None:
            if tag != "pre":
                return
            code = highlight.render("".join(self._pre["text"]).rstrip("\n"), self._pre["lang"])
            self.out.append("<pre><code>%s</code></pre>\n" % code)
            self._pre = None
        for index in range(len(self._stack) - 1, -1, -1):
            if self._stack[index][0] == tag:
                while len(self._stack) > index:
                    self.out.append(self._stack.pop()[1])
                return

    def handle_data(self, data):
        if self._skip:
            return
        if self._pre is not None:
            self._pre["text"].append(data)
            return
        text = data.replace("\xa0", " ")
        open_tags = {tag for tag, _ in self._stack}
        if open_tags & PLAIN_TEXT_IN:              # links, code, headings, table labels
            if text.strip():
                self._sentence_start = False       # the sentence began inside it
            self.out.append(html.escape(text, quote=False))
            return

        lead = ""
        if self._block_start and text.strip():
            self._block_start = False
            found = KEY.match(text)
            if found and len(found.group(1).split()) <= 6:
                lead = '<span class="key">%s</span>' % html.escape(found.group(1), quote=False)
                text = text[found.end(1):]
                self._sentence_start = False       # the label is the start; the value is not

        marks = []                                 # (start, end) of words to colour as sentence starts
        if open_tags & PROSE_TAGS and text.strip():
            if self._sentence_start:
                first = WORD.match(text.lstrip())
                if first:
                    offset = len(text) - len(text.lstrip())
                    marks.append((offset + first.start(), offset + first.end()))
            for brk in SENTENCE_BREAK.finditer(text):
                words = text[:brk.start()].split()
                last = words[-1].lower().rstrip(".") if words else ""
                if last in NOT_A_SENTENCE_END or (len(last) == 1 and last.isalpha()):
                    continue                        # "e.g. The", "Fig. 3", "A. Name"
                marks.append((brk.start(3), brk.end(3)))
            self._sentence_start = bool(SENTENCE_END.search(text))
        elif text.strip():
            self._sentence_start = False

        out, pos = [], 0
        for start, end in sorted(marks):
            out.append(self._numbers(text[pos:start]))
            out.append('<span class="lead">%s</span>' % html.escape(text[start:end], quote=False))
            pos = end
        out.append(self._numbers(text[pos:]))
        self.out.append(lead + "".join(out))


def convert(html_text, resolve_link=None, image_url=None):
    """Return a Result. `resolve_link(note_id)` gives a site URL or None;
    `image_url(ImageRef)` gives a site path or None (None -> placeholder)."""
    parser = _Converter(resolve_link, image_url)
    parser.feed(html_text)
    parser.close()
    body = "".join(parser.out)
    body = re.sub(r"<p>\s*</p>\n?", "", body)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()

    # A figure with no <img> is a not-yet-available image: style it as one.
    def mark(match):
        inner = match.group(1)
        if "<img" in inner:
            return match.group(0)
        return '<figure class="placeholder">%s</figure>' % inner

    body = re.sub(r"<figure>\n(.*?)</figure>", mark, body, flags=re.S)
    return Result(body + "\n", parser.images, parser.unresolved, parser.warnings)
