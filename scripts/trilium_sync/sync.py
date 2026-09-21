"""Port your Trilium projects into the website. One command:

    python scripts/trilium_sync/sync.py

Notes under your Projects note in Trilium that carry the #public label become
pages under projects/, the Explorer on every page is rebuilt, and images are
downloaded. Unlabelled notes are never read. It only reads from Trilium. It
never commits or pushes: review the result, then commit.

    --dry-run   show what would happen, write nothing
    --root ID   import from a different Trilium note than Projects
    --reset     forget the saved Trilium address and token and ask again

The first run asks for your Trilium address and ETAPI token and remembers them
in scripts/trilium_sync/config.local.json (gitignored).
"""
import argparse
import html
import json
import posixpath
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import config  # noqa: E402
import convert  # noqa: E402
import highlight  # noqa: E402
import sitegen  # noqa: E402
from etapi import Etapi, EtapiError  # noqa: E402

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
IMAGE_PREFIX = "gen-"
MAX_IMAGE_WIDTH = 1600
EXT_BY_MIME = {"image/svg+xml": ".svg", "image/png": ".png", "image/jpeg": ".jpg",
               "image/gif": ".gif", "image/webp": ".webp"}


@dataclass
class NoteNode:
    ident: str
    title: str
    kind: str
    labels: dict
    body: str = ""
    children: list = field(default_factory=list)
    path: str = ""
    slug: str = ""
    html: str = ""
    asset: object = None        # bytes of an image or rendered diagram
    asset_ext: str = ""
    mime: str = ""


def labels_of(meta):
    return {a["name"]: a.get("value", "") for a in meta.get("attributes", [])
            if a.get("type") == "label"}


# -- Read Trilium ----------------------------------------------------------

def collect_tree(client, root_id, label, skipped, log):
    """Find the notes labelled `#<label>` under root_id and build the tree above them.

    One search finds the labelled notes; only those notes and their ancestors are
    read. An unlabelled ancestor becomes a folder (title and links only): its
    body is never requested. Returns the root NoteNode, or None if nothing is labelled.
    """
    metas = {}

    def meta(ident):
        if ident not in metas:
            metas[ident] = client.note(ident)
        return metas[ident]

    hits = [h["noteId"] for h in client.search("#" + label, root_id)]
    public = [i for i in hits if label in labels_of(meta(i))]
    if not public:
        return None
    log("Found %d note(s) labelled #%s." % (len(public), label))

    def climb(ident, seen):
        """Edges (child, parent) from `ident` up to the root, or None if it is not under it."""
        for parent in meta(ident).get("parentNoteIds", []):
            if parent == root_id:
                return [(ident, parent)]
            if parent in seen:
                continue
            up = climb(parent, seen | {parent})
            if up is not None:
                return [(ident, parent)] + up
        return None

    parent_of = {}
    for ident in public:
        edges = climb(ident, {ident})
        if edges is None:
            continue                              # labelled, but not under this root
        for child, parent in edges:
            parent_of.setdefault(child, parent)

    nodes = {}

    def node(ident):
        if ident not in nodes:
            m = meta(ident)
            nodes[ident] = NoteNode(ident, m.get("title") or "untitled",
                                    m.get("type", "text"), labels_of(m), mime=m.get("mime", ""))
        return nodes[ident]

    root = node(root_id)
    for child, parent in parent_of.items():
        node(parent).children.append(node(child))
    for ident, n in nodes.items():                 # keep Trilium's order among siblings
        order = meta(ident).get("childNoteIds", [])
        n.children.sort(key=lambda c: order.index(c.ident) if c.ident in order else len(order))

    def read(n):
        for child in list(n.children):
            read(child)
        if label not in n.labels:
            n.kind = "book"                       # folder only; content stays private
            return
        if meta(n.ident).get("isProtected"):
            skipped.append((n.title, "protected note (content is encrypted)"))
            n.kind = "book"
        elif n.kind in ("text", "code"):
            log("  reading: %s" % n.title)
            n.body = client.content(n.ident)
        elif n.kind == "image":
            log("  reading image: %s" % n.title)
            n.asset = client.content_bytes(n.ident)
            n.asset_ext = EXT_BY_MIME.get(meta(n.ident).get("mime", ""), ".bin")
        elif n.kind == "mermaid":
            log("  reading diagram: %s" % n.title)
            n.asset = mermaid_svg(client, n.ident)
            if n.asset is not None:
                n.asset_ext = ".svg"
            else:                                 # no rendered picture stored: show the source
                skipped.append((n.title, "diagram has no rendered image in Trilium; showing its source"))
                n.body = client.content(n.ident)
        elif n.kind != "book":
            skipped.append((n.title, "note type %r is not supported" % n.kind))
            n.kind = "book"
            if not n.children:
                n.dropped = True

    read(root)

    def prune(n):
        n.children = [c for c in n.children if not getattr(c, "dropped", False)]
        for c in n.children:
            prune(c)

    prune(root)
    return root


def mermaid_svg(client, note_id):
    """The rendered picture Trilium stores alongside a Mermaid note, or None."""
    for att in client.attachments(note_id):
        if att.get("role") == "image" and att.get("mime") == "image/svg+xml":
            return client.attachment_content(att["attachmentId"])
    return None


def assign_paths(node):
    """Give every descendant a site path, unique among its siblings. node.path is set."""
    taken = set()
    for child in node.children:
        base = sitegen.slugify(child.labels.get("slug") or child.title)
        slug, n = base, 2
        while slug in taken:
            slug, n = "%s-%d" % (base, n), n + 1
        taken.add(slug)
        child.slug = slug
        child.path = "%s/%s" % (node.path, slug)
        assign_paths(child)


def flatten(node):
    for child in node.children:
        yield child
        yield from flatten(child)


def explorer_children(node):
    return [sitegen.Node(name=c.slug, path=c.path, children=explorer_children(c))
            for c in node.children]


# -- Images ----------------------------------------------------------------

def _load_pillow():
    try:
        from PIL import Image
        return Image
    except ImportError:
        return None


def save_image(data, dest_base, Image):
    """Write image bytes under assets/img. Resize and use WebP if Pillow is present."""
    import io
    if Image is not None:
        try:
            img = Image.open(io.BytesIO(data))
            if img.width > MAX_IMAGE_WIDTH:
                img = img.resize((MAX_IMAGE_WIDTH, round(img.height * MAX_IMAGE_WIDTH / img.width)))
            buffer = io.BytesIO()
            img.save(buffer, "WEBP", quality=82)
            return dest_base + ".webp", buffer.getvalue()
        except Exception:
            pass                           # fall through: keep the original bytes
    return None, data


# -- Build -----------------------------------------------------------------

def build(client, cfg, site_cfg, root_id, repo, dry_run=False, log=print):
    skipped = []
    label = site_cfg.get("publish_label", "public")
    root = collect_tree(client, root_id, label, skipped, log)
    if root is None:
        raise EtapiError("Trilium returned no notes labelled #%s under this root, so there is nothing "
                         "to import. Check the label name (publish_label in site.json)." % label)
    site_dir = site_cfg["site_dir"]
    root.path = site_dir
    assign_paths(root)
    pages = list(flatten(root))
    by_id = {n.ident: n.path for n in pages}
    by_id[root.ident] = site_dir

    template = (HERE / "page_template.html").read_text(encoding="utf-8")
    Image = _load_pillow()
    if Image is None:
        log("note: Pillow is not installed, so images are copied without resizing")

    img_dir = repo / "assets" / "img"
    written_images, image_errors = set(), []
    counters = {}

    def write_asset(node, stem, ext, data):
        """Save an image under assets/img; return its URL as seen from `node`'s page."""
        webp, payload = (None, data) if ext == ".svg" else save_image(data, stem, Image)
        name = webp or (stem + ext)
        img_dir.mkdir(parents=True, exist_ok=True)
        (img_dir / name).write_bytes(payload)
        written_images.add(name)
        return sitegen.href("assets/img", node.path).rstrip("/") + "/" + name

    for node in pages:
        def link(note_id, _node=node):
            target = by_id.get(note_id)
            return sitegen.href(target, _node.path) if target else None

        def image(ref, _node=node):
            n = counters[_node.path] = counters.get(_node.path, 0) + 1
            stem = "%s%s-%d" % (IMAGE_PREFIX, _node.slug, n)
            ext = Path(ref.filename).suffix.lower() or ".bin"
            if dry_run:
                return None
            try:
                data = (client.attachment_content(ref.ident) if ref.kind == "attachment"
                        else client.content_bytes(ref.ident))
            except EtapiError as err:
                image_errors.append("%s: %s" % (ref.filename, err))
                return None
            return write_asset(_node, stem, ext, data)

        if node.kind == "code":
            node.html = "<pre><code>%s</code></pre>\n" % highlight.render(
                node.body, highlight.language_from_mime(node.mime))
        elif node.kind == "text":
            node.html = convert.convert(node.body, resolve_link=link, image_url=image).html
        elif node.kind in ("image", "mermaid") and node.asset is not None:
            node.html = ""
            if not dry_run:
                url = write_asset(node, "%s%s-1" % (IMAGE_PREFIX, node.slug), node.asset_ext, node.asset)
                css = ' class="diagram"' if node.asset_ext == ".svg" else ""
                node.html = "\n".join([
                    "<figure>",
                    '<img%s src="%s" alt="%s" loading="lazy">' % (
                        css, html.escape(url, quote=True), html.escape(node.title, quote=True)),
                    "</figure>", ""])
        elif node.kind == "mermaid":              # no picture stored: show the diagram source
            node.html = "<pre><code>%s</code></pre>\n" % html.escape(node.body)
        else:
            node.html = ""

    # Page files
    tree_cfg = site_cfg["tree"]
    nodes = sitegen.build_nodes(tree_cfg, explorer_children(root))
    written = []
    for node in [root] + pages:
        if node is root:
            continue                       # projects/index.html is hand-written
        explorer = sitegen.render_tree(nodes, node.path)
        kids = [(c.title, sitegen.href(c.path, node.path)) for c in node.children]
        page_html = sitegen.render_page(template, cfg | site_cfg, node, explorer, kids)
        written.append((repo / node.path / "index.html", page_html))

    # Hand-written pages keep their content; only their Explorer is refreshed
    refreshed = []
    for rel in site_cfg["handwritten_pages"]:
        target = repo / rel
        if not target.is_file():
            continue
        current = posixpath.dirname(rel)
        updated = sitegen.replace_explorer(
            target.read_text(encoding="utf-8"), sitegen.render_tree(nodes, current))
        if updated is None:
            log("skipped %s: it has no explorer markers" % rel)
            continue
        refreshed.append((target, updated))

    if dry_run:
        for path, _ in written:
            log("would write %s" % path.relative_to(repo).as_posix())
        for path, _ in refreshed:
            log("would refresh the Explorer in %s" % path.relative_to(repo).as_posix())
    else:
        for path, text in written + refreshed:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8", newline="\n")
        # Remove generated pages and images that no longer come from Trilium
        keep = {p for p, _ in written}
        for old in (repo / site_dir).rglob("index.html"):
            if old not in keep and sitegen.GENERATED_MARKER in old.read_text(encoding="utf-8"):
                old.unlink()
                log("removed %s (no longer in Trilium)" % old.relative_to(repo).as_posix())
        for old in list(img_dir.glob(IMAGE_PREFIX + "*")) if img_dir.is_dir() else []:
            if old.name not in written_images:
                old.unlink()
        for folder in sorted((repo / site_dir).rglob("*"), reverse=True):
            if folder.is_dir() and not any(folder.iterdir()):
                folder.rmdir()

    log("")
    log("%s %d page(s), %d image(s), refreshed the Explorer on %d hand-written page(s)."
        % ("Would write" if dry_run else "Wrote", len(written), len(written_images), len(refreshed)))
    for title, why in skipped:
        log("skipped %r: %s" % (title, why))
    for problem in image_errors:
        log("image not downloaded, left as a placeholder: %s" % problem)
    return {"pages": len(written), "images": len(written_images), "skipped": skipped,
            "image_errors": image_errors}


def find_projects_note(client):
    for child_id in client.note("root").get("childNoteIds", []):
        if client.note(child_id).get("title", "").strip().lower() == "projects":
            return child_id
    raise EtapiError("Could not find a note titled 'Projects' at the top of Trilium. "
                     "Pass its ID with --root.")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Port Trilium projects into the website.")
    parser.add_argument("--dry-run", action="store_true", help="show what would happen; write nothing")
    parser.add_argument("--root", help="Trilium note ID to import from (default: the Projects note)")
    parser.add_argument("--reset", action="store_true", help="forget the saved address and token")
    args = parser.parse_args(argv)

    for stream in (sys.stdout, sys.stderr):
        try:                              # note titles can hold characters a Windows console cannot print
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass

    if args.reset and config.CONFIG_PATH.is_file():
        config.CONFIG_PATH.unlink()
    cfg = config.ensure(config.load())
    site_cfg = json.loads((HERE / "site.json").read_text(encoding="utf-8"))
    client = Etapi(cfg["url"], cfg["token"])
    try:
        print("Connecting to Trilium...")
        root_id = args.root or cfg.get("root_note_id") or find_projects_note(client)
        build(client, cfg, site_cfg, root_id, REPO, dry_run=args.dry_run)
    except EtapiError as err:
        print("error: %s" % err)
        return 1
    except KeyboardInterrupt:
        print()
        print("Cancelled. Nothing was changed." if args.dry_run else "Cancelled.")
        return 130
    if not args.dry_run:
        print("Review with `git status` and `git diff`, preview locally, then commit when you are happy.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
