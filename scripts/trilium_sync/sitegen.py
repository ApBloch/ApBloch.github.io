"""Explorer tree and page rendering for the generated pages. Standard library only."""
import html
import posixpath
import re
from dataclasses import dataclass, field

GENERATED_MARKER = "<!-- Generated from Trilium. Edit the note, not this file. -->"
EXPLORER_START = "<!-- explorer:start -->"
EXPLORER_END = "<!-- explorer:end -->"


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "note"


def href(target, current):
    """Link from the page at site dir `current` to the page at site dir `target`."""
    rel = posixpath.relpath(target or ".", current or ".")
    return "./" if rel == "." else rel + "/"


# -- Explorer ------------------------------------------------------------

@dataclass
class Node:
    name: str
    path: object = None            # site dir of its page, or None for no page
    children: list = field(default_factory=list)
    missing: bool = False
    kind: str = "dir"              # "file" for index.html


def _contains(node, current):
    return node.path == current or any(_contains(c, current) for c in node.children)


def render_tree(nodes, current, depth=0, indent="        "):
    esc = html.escape
    out = ["%s<ul>" % indent]
    for node in nodes:
        pad = indent + "  "
        if node.missing:
            out.append(
                '%s<li><span class="tree__item is-missing" title="Not written yet">%s '
                '<span class="tree__flag" aria-label="not written yet">?</span></span></li>'
                % (pad, esc(node.name)))
            continue
        cur = ' aria-current="page"' if node.path is not None and node.path == current else ""
        if not node.children:
            if node.path is None:
                out.append('%s<li><span class="tree__item tree__dir">%s</span></li>' % (pad, esc(node.name)))
            else:
                cls = "tree__item tree__file" if node.kind == "file" else "tree__item"
                out.append('%s<li><a class="%s" href="%s"%s>%s</a></li>'
                           % (pad, cls, href(node.path, current), cur, esc(node.name)))
            continue
        label = esc(node.name)
        if node.path is not None:
            label = '<a href="%s"%s>%s</a>' % (href(node.path, current), cur, label)
        opened = " open" if depth == 0 or _contains(node, current) else ""
        out.append("%s<li>" % pad)
        out.append("%s  <details%s>" % (pad, opened))
        out.append('%s  <summary class="tree__item tree__dir">%s</summary>' % (pad, label))
        out.append(render_tree(node.children, current, depth + 1, pad + "  "))
        out.append("%s  </details>" % pad)
        out.append("%s</li>" % pad)
    out.append("%s</ul>" % indent)
    return "\n".join(out)


def build_nodes(tree_cfg, generated_children):
    """Turn site.json's tree plus the pages generated from Trilium into Nodes."""
    nodes = []
    for entry in tree_cfg:
        children = build_nodes(entry.get("children", []), [])
        if entry.get("generated"):
            children = generated_children
        nodes.append(Node(
            name=entry["name"], path=entry.get("path"), children=children,
            missing=bool(entry.get("missing")), kind=entry.get("kind", "dir")))
    return nodes


def replace_explorer(text, explorer_html):
    """Swap the region between the explorer markers. None if there are no markers."""
    start, end = text.find(EXPLORER_START), text.find(EXPLORER_END)
    if start < 0 or end < start:
        return None
    return (text[:start + len(EXPLORER_START)] + "\n" + explorer_html + "\n        "
            + text[end:])


# -- Pages ---------------------------------------------------------------

def _description(body_html):
    match = re.search(r"<p>(.*?)</p>", body_html, flags=re.S)
    if not match:
        return ""
    text = html.unescape(re.sub(r"<[^>]+>", "", match.group(1)))
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= 155 else text[:152].rstrip() + "..."


def _status_links(links):
    lines = []
    if links.get("github"):
        lines.append('      <a class="status__seg status__link" href="%s">GitHub</a>'
                     % html.escape(links["github"], quote=True))
    if links.get("linkedin"):
        lines.append('      <a class="status__seg status__link" href="%s">LinkedIn</a>'
                     % html.escape(links["linkedin"], quote=True))
    else:
        lines.append('      <span class="status__seg"><span class="todo">[TODO: LinkedIn URL]</span></span>')
    if links.get("email"):
        lines.append('      <a class="status__seg status__link" href="mailto:%s">%s</a>'
                     % (html.escape(links["email"], quote=True), html.escape(links["email"])))
    return "\n".join(lines)


def render_page(template, cfg, page, explorer_html, child_links):
    """`page` needs .path, .title and .html. `child_links` is [(title, href)]."""
    body = page.html.rstrip("\n")
    if child_links:
        items = "\n".join('<li><a href="%s">%s</a></li>' % (html.escape(h, quote=True), html.escape(t))
                          for t, h in child_links)
        body += '\n<h2>Pages</h2>\n<ul class="child-links">\n%s\n</ul>' % items
    depth = len([p for p in page.path.split("/") if p])
    desc = html.escape(_description(page.html), quote=True)
    base = cfg["base_url"].rstrip("/") + "/"
    values = {
        "title": html.escape(page.title),
        "site_name": html.escape(cfg["site_name"]),
        "description": desc,
        "og_url": base + page.path + "/",
        "root": "../" * depth,
        "pane_title": html.escape(page.path + ".md"),
        "content": body,
        "status_links": _status_links(cfg["links"]),
    }
    out = re.sub(r"\{\{(\w+)\}\}", lambda m: values.get(m.group(1), m.group(0)), template)
    out = replace_explorer(out, explorer_html)
    return out.replace("<!DOCTYPE html>\n", "<!DOCTYPE html>\n" + GENERATED_MARKER + "\n", 1)
