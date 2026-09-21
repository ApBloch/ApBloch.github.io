"""Tests use synthetic data and a temporary copy of the site. Never real notes."""
import json
import shutil
import sys
import tempfile
import unittest
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import config  # noqa: E402
import convert  # noqa: E402
import highlight  # noqa: E402
import sitegen  # noqa: E402
import sync  # noqa: E402
from etapi import Etapi, EtapiError  # noqa: E402

REPO = HERE.parent.parent

SAMPLE = (
    '<h1>Title</h1><h2>Topology</h2>'
    '<p>Fast &amp; <b>bold</b> <i>text</i><span style="color:red"> kept</span></p>'
    '<p>&nbsp;</p>'
    '<pre><code class="language-c">if (a &lt; b) { x(); }</code></pre>'
    '<figure class="table"><table><tr><th>Slot</th><th>Rate</th></tr>'
    '<tr><td>0</td><td>50.00/s</td></tr></table></figure>'
    '<figure class="image"><img src="api/attachments/AbC123/image/putt_1.png" '
    'width="1650"><figcaption>A putt</figcaption></figure>'
    '<script>alert(1)</script><style>p{}</style>'
)


class ConvertTests(unittest.TestCase):
    def setUp(self):
        self.result = convert.convert(SAMPLE)

    def test_h1_becomes_h2(self):
        self.assertNotIn("<h1", self.result.html)
        self.assertEqual(self.result.html.count("<h2>"), 2)

    def test_entities_and_inline_formatting(self):
        self.assertIn('<span class="lead">Fast</span> &amp; <strong>bold</strong> <em>text</em> kept', self.result.html)

    def test_styles_and_scripts_removed(self):
        for bad in ("style=", "<script", "alert(1)", "<style", "p{}"):
            self.assertNotIn(bad, self.result.html)

    def test_empty_paragraph_removed(self):
        self.assertNotIn("<p></p>", self.result.html)

    def test_code_block_kept_and_escaped(self):
        self.assertIn('<span class="tok-kw">if</span> (a &lt; b) { <span class="tok-fn">x</span>(); }', self.result.html)

    def test_table_is_wrapped_and_figure_unwrapped(self):
        self.assertIn('<div class="table-wrap">', self.result.html)
        self.assertEqual(self.result.html.count("<figure"), 1)

    def test_missing_image_becomes_placeholder(self):
        self.assertIn('<figure class="placeholder">', self.result.html)
        self.assertIn("Image coming soon", self.result.html)
        self.assertEqual(self.result.images[0].ident, "AbC123")

    def test_available_image_is_used(self):
        result = convert.convert(SAMPLE, image_url=lambda ref: "assets/img/putt.webp")
        self.assertIn('<img src="assets/img/putt.webp"', result.html)

    def test_internal_links(self):
        html = '<p><a href="#root/abc/DEF456">see</a> and <a href="#root/ZZZ">other</a></p>'
        result = convert.convert(html, resolve_link=lambda i: "../x/" if i == "DEF456" else None)
        self.assertIn('<a href="../x/">see</a>', result.html)
        self.assertIn("and other", result.html)

    def test_unsafe_links_dropped(self):
        result = convert.convert('<p><a href="javascript:alert(1)">x</a></p>')
        self.assertNotIn("javascript", result.html)


class HighlightTests(unittest.TestCase):
    def test_c_tokens(self):
        out = highlight.render('#include <x.h>\nint main() { return 0x10; } // done\nchar *s = "hi";', "c")
        for cls, text in (("tok-pre", "#include"), ("tok-type", "int"), ("tok-fn", "main"),
                          ("tok-kw", "return"), ("tok-num", "0x10"), ("tok-com", "// done"),
                          ("tok-str", '"hi"')):
            self.assertIn('<span class="%s">%s</span>' % (cls, text), out.replace("&quot;", '"'))

    def test_stdint_types_and_user_types(self):
        out = highlight.render("uint16_t seq; ble_imu_packet_t p;", "c")
        self.assertIn('<span class="tok-type">uint16_t</span>', out)
        self.assertIn('<span class="tok-type">ble_imu_packet_t</span>', out)

    def test_language_is_guessed_when_the_note_does_not_say(self):
        struct = "typedef struct {\n    uint16_t seq;\n    int16_t ax;\n} ble_imu_packet_t;"
        self.assertIn("tok-kw", highlight.render(struct, "plaintext"))
        self.assertNotIn("<span", highlight.render("just some words, nothing code-like", "plaintext"))

    def test_output_is_escaped(self):
        out = highlight.render("if (a < b && c > d) {}", "c")
        self.assertIn("&lt;", out)
        self.assertNotIn("a < b", out)

    def test_python_and_bash(self):
        self.assertIn('<span class="tok-kw">def</span>', highlight.render("def f(x):\n    return 1", "python"))
        self.assertIn('<span class="tok-com"># note</span>', highlight.render("ls -l  # note", "bash"))
        self.assertIn('<span class="tok-var">$HOME</span>', highlight.render("cd $HOME", "bash"))

    def test_mime_types(self):
        self.assertEqual(highlight.language_from_mime("text/x-csrc"), "c")
        self.assertEqual(highlight.language_from_mime("text/x-python"), "python")
        self.assertIsNone(highlight.language_from_mime("text/plain"))


class ProseColourTests(unittest.TestCase):
    def conv(self, html):
        return convert.convert(html).html

    def test_label_at_start_of_paragraph_becomes_a_key(self):
        out = self.conv("<p>Interface used (SPI/I2C): SPI</p>")
        self.assertIn('<span class="key">Interface used (SPI/I2C):</span> SPI', out)

    def test_list_items_get_keys_too(self):
        self.assertIn('<li><span class="key">Pins used:</span>', self.conv("<ul><li>Pins used: see page</li></ul>"))

    def test_not_a_key(self):
        for text in ("Sentences, like this one: are not labels.", "See https://example.com now",
                     "one two three four five six seven: too many words", "12:30 is a time"):
            self.assertNotIn('class="key"', self.conv("<p>%s</p>" % text), text)

    def test_only_the_start_of_a_block_can_be_a_key(self):
        self.assertNotIn('class="key"', self.conv("<p>Some text. Result: fine</p>"))
        self.assertNotIn('class="key"', self.conv("<p><strong>Result:</strong> fine</p>"))

    def test_numbers_with_units(self):
        out = self.conv("<p>Rate 50.00/s over 33.6 s, 3450mAh at 9V and 0x73, 48,322 packets (0.00%)</p>")
        for token in ("50.00/s", "33.6", "3450mAh", "9V", "0x73", "48,322", "0.00%"):
            self.assertIn('<span class="num">%s</span>' % token, out)

    def test_identifiers_with_digits_are_not_numbers(self):
        out = self.conv("<p>ESP32-S3 with LSM6DSV320X and NCR18650GA</p>")
        self.assertNotIn('<span class="num">32</span>', out)
        self.assertNotIn('<span class="num">6</span>', out)
        self.assertNotIn('<span class="num">320</span>', out)
        self.assertNotIn('<span class="num">18650', out)

    def test_numbers_are_left_alone_in_links_code_headings_and_labels(self):
        for html in ('<p><a href="https://x.example">v 12</a></p>', "<p><code>x = 12</code></p>",
                     "<h2>Step 12</h2>", "<table><tr><th>Rate 50</th></tr></table>"):
            self.assertNotIn('class="num"', self.conv(html), html)

    def test_numbers_inside_table_cells_are_coloured(self):
        self.assertIn('<span class="num">1680</span>', self.conv("<table><tr><td>1680</td></tr></table>"))

    def test_code_block_text_is_not_touched_by_prose_rules(self):
        out = self.conv("<pre>Label: 12\nx = 5;</pre>")
        self.assertNotIn('class="key"', out)
        self.assertNotIn('class="num"', out)
        self.assertNotIn('class="lead"', out)

    def leads(self, html):
        import re
        return re.findall(r'<span class="lead">(.*?)</span>', self.conv(html))

    def test_first_word_of_each_sentence_is_marked(self):
        self.assertEqual(self.leads("<p>Star topology works. It was chosen! Is it fast? Yes it is.</p>"),
                         ["Star topology works", "It was chosen", "Is it fast", "Yes it is"])

    def test_at_most_three_words(self):
        self.assertIn('<span class="lead">Star topology matching</span> the final product',
                      self.conv("<p>Star topology matching the final product</p>"))

    def test_the_run_stops_at_punctuation_and_before_a_number(self):
        self.assertEqual(self.leads("<p>Star topology, matching the rest. Each board at 100Hz sends data.</p>"),
                         ["Star topology", "Each board at"])
        self.assertIn('<span class="lead">Each board at</span> <span class="num">100Hz</span>',
                      self.conv("<p>Each board at 100Hz sends data.</p>"))

    def test_a_one_word_sentence(self):
        self.assertEqual(self.leads("<p>Done. Yes.</p>"), ["Done", "Yes"])

    def test_abbreviations_and_decimals_do_not_end_a_sentence(self):
        self.assertEqual(self.leads("<p>Use a part, e.g. The Big One, vs. Another. See 3.5 Volts. Done.</p>"),
                         ["Use a part", "See", "Done"])

    def test_a_sentence_can_start_inside_bold_or_italic(self):
        self.assertEqual(self.leads("<p><strong>Conclusion:</strong> works. <em>Goal</em> met.</p>"),
                         ["Conclusion", "Goal"])

    def test_a_paragraph_starting_with_a_link_does_not_lead_mid_sentence(self):
        self.assertEqual(self.leads('<p><a href="https://x.example">Worksheet</a> is where it lives.</p>'), [])

    def test_a_label_counts_as_the_start_and_the_value_does_not(self):
        out = self.conv("<p>Result: Works fine. Next one.</p>")
        self.assertIn('<span class="key">Result:</span>', out)
        self.assertEqual(self.leads("<p>Result: Works fine. Next one.</p>"), ["Next one"])

    def test_list_items_start_a_sentence_but_table_cells_and_headings_do_not(self):
        self.assertEqual(self.leads("<ul><li>Alpha one</li><li>beta two</li></ul>"), ["Alpha one", "beta two"])
        self.assertEqual(self.leads("<table><tr><td>Cell text. Another one.</td></tr></table>"), [])
        self.assertEqual(self.leads("<h2>Heading text. More</h2>"), [])

    def test_a_sentence_starting_with_a_number_gets_the_number_colour_instead(self):
        out = self.conv("<p>4 boards connected. Then it worked.</p>")
        self.assertIn('<span class="num">4</span>', out)
        self.assertEqual(self.leads("<p>4 boards connected. Then it worked.</p>"), ["Then it worked"])


class SiteTests(unittest.TestCase):
    def test_href_is_relative_to_current_page(self):
        self.assertEqual(sitegen.href("projects/a", ""), "projects/a/")
        self.assertEqual(sitegen.href("", "projects/a"), "../../")
        self.assertEqual(sitegen.href("projects/a", "projects/a"), "./")
        self.assertEqual(sitegen.href("projects/b", "projects/a"), "../b/")

    def test_slugify(self):
        self.assertEqual(sitegen.slugify("SPI Bring-Up: MISO (LSM6DSV320X)"), "spi-bring-up-miso-lsm6dsv320x")
        self.assertEqual(sitegen.slugify("!!!"), "note")

    def test_tree_marks_current_page_and_missing_entries(self):
        nodes = [sitegen.Node("index.html", "", kind="file"),
                 sitegen.Node("projects/", "projects", children=[sitegen.Node("a/", "projects/a")]),
                 sitegen.Node("about/", missing=True)]
        out = sitegen.render_tree(nodes, "projects/a")
        self.assertIn('<a class="tree__item" href="./" aria-current="page">a/</a>', out)
        self.assertIn('href="../../"', out)               # index.html, two levels up
        self.assertIn("is-missing", out)
        self.assertEqual(out.count("aria-current"), 1)

    def test_replace_explorer_needs_markers(self):
        self.assertIsNone(sitegen.replace_explorer("<p>no markers</p>", "<ul></ul>"))
        text = "a\n%s\nold\n%s\nb" % (sitegen.EXPLORER_START, sitegen.EXPLORER_END)
        self.assertIn("<ul>new</ul>", sitegen.replace_explorer(text, "<ul>new</ul>"))
        self.assertNotIn("old", sitegen.replace_explorer(text, "<ul>new</ul>"))


PUBLIC = {"type": "label", "name": "public", "value": ""}


class FakeClient:
    """A stand-in Trilium with a small tree:  Projects > Alpha > Deep,  Projects > Beta."""

    def __init__(self):
        self.notes = {
            "root": {"noteId": "root", "title": "root", "type": "book", "childNoteIds": ["P"]},
            "P": {"noteId": "P", "title": "Projects", "type": "book", "childNoteIds": ["A", "B"]},
            "A": {"noteId": "A", "title": "Alpha Project", "type": "text", "childNoteIds": ["D"],
                  "attributes": [PUBLIC]},
            "D": {"noteId": "D", "title": "Deep Note", "type": "text", "childNoteIds": [],
                  "attributes": [PUBLIC, {"type": "label", "name": "slug", "value": "deep"}]},
            "B": {"noteId": "B", "title": "Beta", "type": "text", "childNoteIds": [],
                  "attributes": [PUBLIC]},
            "S": {"noteId": "S", "title": "Sheet", "type": "canvas", "childNoteIds": [],
                  "attributes": [PUBLIC]},
            "I": {"noteId": "I", "title": "Circuit Sketch", "type": "image", "mime": "image/svg+xml",
                  "childNoteIds": [], "attributes": [PUBLIC]},
            "M": {"noteId": "M", "title": "Block Diagram", "type": "mermaid", "childNoteIds": [],
                  "attributes": [PUBLIC]},
            "X": {"noteId": "X", "title": "Bare Diagram", "type": "mermaid", "childNoteIds": [],
                  "attributes": [PUBLIC]},
            "N": {"noteId": "N", "title": "Private Journal", "type": "text", "childNoteIds": [],
                  "attributes": []},
            "F": {"noteId": "F", "title": "Group", "type": "text", "childNoteIds": ["G"],
                  "attributes": []},
            "G": {"noteId": "G", "title": "Grandchild", "type": "text", "childNoteIds": [],
                  "attributes": [PUBLIC]},
        }
        self.fetched = []
        self.bodies = {
            "A": '<p>Alpha intro &amp; more. See <a href="#root/P/D">deep</a>.</p>'
                 '<figure class="image"><img src="api/attachments/IMG1/image/pic.png"></figure>',
            "D": "<h1>Deep</h1><ul><li>one</li></ul>",
            "B": "<p>Beta body</p>",
            "X": "graph TD; A-->B;",
            "N": "<p>PRIVATE-BODY</p>",
            "F": "<p>GROUP-BODY-PRIVATE</p>",
            "G": "<p>Grandchild body</p>",
        }

    def note(self, ident):
        parents = [k for k, m in self.notes.items() if ident in m.get("childNoteIds", [])]
        return dict(self.notes[ident], parentNoteIds=parents)

    def search(self, query, ancestor_id):
        name = query.lstrip("#")
        return [{"noteId": k} for k, m in self.notes.items()
                if any(a.get("name") == name for a in m.get("attributes", []))]

    def content(self, ident):
        self.fetched.append(ident)
        return self.bodies[ident]

    def content_bytes(self, ident):
        return b"<svg>circuit</svg>" if ident == "I" else b"BYTES"

    def attachments(self, ident):
        if ident == "M":
            return [{"attachmentId": "ATTSVG", "role": "image", "mime": "image/svg+xml",
                     "title": "mermaid-export.svg"}]
        return []

    def attachment_content(self, ident):
        if ident == "ATTSVG":
            return b"<svg>diagram</svg>"
        return b"\x89PNG-fake"


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        for rel in ("index.html", "projects/index.html"):
            (self.tmp / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO / rel, self.tmp / rel)
        self.site_cfg = json.loads((HERE / "site.json").read_text(encoding="utf-8"))
        self.cfg = {"url": "x", "token": "SECRET-TOKEN"}
        self.logs = []

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_build(self, client=None, **kw):
        return sync.build(client or FakeClient(), self.cfg, self.site_cfg, "P", self.tmp,
                          log=self.logs.append, **kw)

    def test_pages_are_written_with_the_shell(self):
        self.run_build()
        alpha = (self.tmp / "projects/alpha-project/index.html").read_text(encoding="utf-8")
        self.assertIn(sitegen.GENERATED_MARKER, alpha)
        self.assertEqual(alpha.count("<h1>"), 1)
        self.assertIn("<title>Alpha Project | Aaron Bloch</title>", alpha)
        self.assertIn('href="../../assets/css/style.css"', alpha)
        self.assertIn('meta name="description" content="Alpha intro &amp; more. See deep."', alpha)
        self.assertIn('aria-current="page"', alpha)
        self.assertIn('class="statusline"', alpha)
        self.assertIn("projects/alpha-project.md", alpha)
        self.assertNotIn("alpha-project/index.html", alpha)

    def test_slug_label_and_links_between_notes(self):
        self.run_build()
        self.assertTrue((self.tmp / "projects/alpha-project/deep/index.html").is_file())
        alpha = (self.tmp / "projects/alpha-project/index.html").read_text(encoding="utf-8")
        self.assertIn('<a href="deep/">deep</a>', alpha)          # link inside the note
        self.assertIn('<li><a href="deep/">Deep Note</a></li>', alpha)  # child list

    def test_lists_and_h1_in_child_note(self):
        self.run_build()
        deep = (self.tmp / "projects/alpha-project/deep/index.html").read_text(encoding="utf-8")
        self.assertEqual(deep.count("<h1>"), 1)
        self.assertIn('<ul><li><span class="lead">one</span></li>', deep)

    def test_images_are_downloaded_and_linked(self):
        result = self.run_build()
        self.assertEqual(result["images"], 1)
        files = list((self.tmp / "assets/img").glob("gen-*"))
        self.assertEqual(len(files), 1)
        alpha = (self.tmp / "projects/alpha-project/index.html").read_text(encoding="utf-8")
        self.assertIn('src="../../assets/img/%s"' % files[0].name, alpha)

    def test_handwritten_pages_keep_content_but_get_the_new_explorer(self):
        before = (self.tmp / "projects/index.html").read_text(encoding="utf-8")
        self.run_build()
        after = (self.tmp / "projects/index.html").read_text(encoding="utf-8")
        self.assertIn("<h1>Projects</h1>", after)
        self.assertIn('href="alpha-project/"', after)
        self.assertIn('href="beta/"', after)
        self.assertNotIn("console-build/", after.split("<!-- explorer:end -->")[0].split("explorer:start")[1])
        self.assertEqual(before.split("<!-- explorer:end -->")[1], after.split("<!-- explorer:end -->")[1])

    def test_unsupported_notes_are_reported_not_fatal(self):
        client = FakeClient()
        client.notes["P"]["childNoteIds"].append("S")
        result = self.run_build(client)
        self.assertEqual([t for t, _ in result["skipped"]], ["Sheet"])
        self.assertFalse((self.tmp / "projects/sheet").exists())

    def test_removed_notes_are_cleaned_up_but_handwritten_files_survive(self):
        self.run_build()
        client = FakeClient()
        client.notes["P"]["childNoteIds"] = ["A"]
        client.notes["A"]["childNoteIds"] = []
        self.run_build(client)
        self.assertFalse((self.tmp / "projects/beta").exists())
        self.assertFalse((self.tmp / "projects/alpha-project/deep").exists())
        self.assertTrue((self.tmp / "projects/index.html").is_file())
        self.assertTrue((self.tmp / "projects/alpha-project/index.html").is_file())

    def test_unlabelled_notes_are_never_read_or_published(self):
        client = FakeClient()
        client.notes["P"]["childNoteIds"] += ["N"]
        self.run_build(client)
        self.assertNotIn("N", client.fetched)
        self.assertFalse((self.tmp / "projects/private-journal").exists())
        every_page = "".join(p.read_text(encoding="utf-8") for p in self.tmp.rglob("*.html"))
        self.assertNotIn("PRIVATE-BODY", every_page)
        self.assertNotIn("Private Journal", every_page)

    def test_unlabelled_parent_becomes_a_folder_without_its_body(self):
        client = FakeClient()
        client.notes["P"]["childNoteIds"] += ["F"]
        self.run_build(client)
        self.assertNotIn("F", client.fetched)
        group = (self.tmp / "projects/group/index.html").read_text(encoding="utf-8")
        self.assertNotIn("GROUP-BODY-PRIVATE", group)
        self.assertIn('<a href="grandchild/">Grandchild</a>', group)
        self.assertTrue((self.tmp / "projects/group/grandchild/index.html").is_file())

    def test_nothing_labelled_is_an_error_not_a_publish_of_everything(self):
        client = FakeClient()
        for note in client.notes.values():
            note["attributes"] = []
        with self.assertRaises(EtapiError):
            self.run_build(client)
        self.assertFalse((self.tmp / "projects/alpha-project").exists())

    def test_image_note_becomes_a_page_with_the_picture(self):
        client = FakeClient()
        client.notes["P"]["childNoteIds"].append("I")
        self.run_build(client)
        page = (self.tmp / "projects/circuit-sketch/index.html").read_text(encoding="utf-8")
        self.assertIn('<img class="diagram" src="../../assets/img/gen-circuit-sketch-1.svg"', page)
        self.assertIn('alt="Circuit Sketch"', page)
        self.assertEqual((self.tmp / "assets/img/gen-circuit-sketch-1.svg").read_bytes(), b"<svg>circuit</svg>")

    def test_mermaid_note_uses_the_rendered_picture_trilium_stores(self):
        client = FakeClient()
        client.notes["P"]["childNoteIds"].append("M")
        result = self.run_build(client)
        page = (self.tmp / "projects/block-diagram/index.html").read_text(encoding="utf-8")
        self.assertIn("gen-block-diagram-1.svg", page)
        self.assertEqual((self.tmp / "assets/img/gen-block-diagram-1.svg").read_bytes(), b"<svg>diagram</svg>")
        self.assertEqual(result["skipped"], [])

    def test_mermaid_note_without_a_picture_shows_its_source_and_says_so(self):
        client = FakeClient()
        client.notes["P"]["childNoteIds"].append("X")
        result = self.run_build(client)
        page = (self.tmp / "projects/bare-diagram/index.html").read_text(encoding="utf-8")
        self.assertIn("graph TD; A--&gt;B;", page)
        self.assertEqual([t for t, _ in result["skipped"]], ["Bare Diagram"])

    def test_explorer_names_have_no_trailing_slash_and_files_are_marked(self):
        self.run_build()
        page = (self.tmp / "projects/alpha-project/index.html").read_text(encoding="utf-8")
        self.assertIn(">projects</a>", page)
        self.assertIn(">alpha-project</a>", page)
        self.assertIn('class="tree__item tree__file"', page)
        self.assertNotIn("/</a>", page)
        self.assertIn('<p class="tree__root">ApBloch.github.io</p>', page)

    def test_dry_run_writes_nothing(self):
        result = self.run_build(dry_run=True)
        self.assertEqual(result["pages"], 3)
        self.assertFalse((self.tmp / "projects/alpha-project").exists())
        self.assertFalse((self.tmp / "assets").exists())

    def test_token_never_written_to_the_site(self):
        self.run_build()
        for path in self.tmp.rglob("*.html"):
            self.assertNotIn("SECRET-TOKEN", path.read_text(encoding="utf-8"))


class RootLookupTests(unittest.TestCase):
    def test_finds_the_projects_note_by_title(self):
        self.assertEqual(sync.find_projects_note(FakeClient()), "P")

    def test_error_when_there_is_no_projects_note(self):
        client = FakeClient()
        client.notes["P"]["title"] = "Something else"
        with self.assertRaises(EtapiError):
            sync.find_projects_note(client)


class ConfigTests(unittest.TestCase):
    def test_first_run_asks_then_remembers(self):
        path = Path(tempfile.mkdtemp()) / "cfg.json"
        cfg = config.ensure({}, ask=lambda _: "https://t.example", ask_secret=lambda _: "tok", path=path)
        self.assertEqual(cfg["url"], "https://t.example")
        again = config.load(path)
        self.assertEqual(again["token"], "tok")
        asked = []
        config.ensure(again, ask=lambda p: asked.append(p) or "", ask_secret=lambda p: asked.append(p) or "", path=path)
        self.assertEqual(asked, [])                         # nothing asked the second time


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"          # keep-alive, like Trilium

    def do_GET(self):
        self.server.seen.append((self.command, self.path, self.headers.get("Authorization"),
                                 self.client_address[1]))
        if self.path.startswith("/etapi/app-info"):
            code, body = 200, b'{"appVersion": "9.9.9"}'
        elif self.path.startswith("/etapi/denied"):
            code, body = 401, b"{}"
        else:
            code, body = 200, b'{"results": [{"noteId": "abc"}]}'
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class EtapiTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self.server.seen = []
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = "http://127.0.0.1:%d" % self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_get_only_with_token_header_and_path(self):
        client = Etapi(self.url, "TOKEN123")
        self.assertEqual(client.app_info()["appVersion"], "9.9.9")
        client.search("#public", "ROOT1")
        method, path, auth, _ = self.server.seen[-1]
        self.assertEqual((method, auth), ("GET", "TOKEN123"))
        self.assertTrue(path.startswith("/etapi/notes?"))
        self.assertIn("ancestorNoteId=ROOT1", path)

    def test_one_connection_is_reused_for_many_requests(self):
        client = Etapi(self.url, "TOKEN123")
        for _ in range(5):
            client.search("#public", "ROOT1")
        self.assertEqual(len({port for *_, port in self.server.seen}), 1)

    def test_http_errors_never_contain_the_token(self):
        client = Etapi(self.url, "TOKEN123")
        with self.assertRaises(EtapiError) as ctx:
            client._get("/denied")
        self.assertNotIn("TOKEN123", str(ctx.exception))
        self.assertIn("401", str(ctx.exception))

    def test_unreachable_server_is_a_clean_error(self):
        client = Etapi("http://127.0.0.1:1", "TOKEN123", timeout=2)
        with self.assertRaises(EtapiError) as ctx:
            client.app_info()
        self.assertNotIn("TOKEN123", str(ctx.exception))

    def test_bad_address_is_rejected(self):
        with self.assertRaises(EtapiError):
            Etapi("aarons-mac-mini.local:8080", "T")


if __name__ == "__main__":
    unittest.main()
