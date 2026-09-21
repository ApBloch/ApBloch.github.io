# Trilium import script

One command ports your Trilium projects into the website:

```bash
python scripts/trilium_sync/sync.py
```

Notes under your **Projects** note in Trilium that carry the **`#public`** label become pages under `projects/`, the Explorer on every page is rebuilt, and images are downloaded. It only **reads** from Trilium. It never commits or pushes: review with `git status` and `git diff`, preview locally, then commit when you are happy.

**You decide what is public, in Trilium, with the `#public` label.** A note without it is never read: its content is not even requested from Trilium. Children are not public just because their parent is; label each note you want published. A note that is not labelled but has a labelled note below it (for example "Controller" above "Testing") shows up as a folder page containing only its title and links to the pages below it, never its own text. To change the label name, edit `publish_label` in `site.json`.

## First run

It asks for two things and remembers them in `scripts/trilium_sync/config.local.json` (gitignored, because it holds your token):

1. Your Trilium address, for example `https://notes.example.com`.
2. An ETAPI token: in Trilium, Options, ETAPI, create a token. Typing is hidden.

It then finds the note titled `Projects` at the top of your tree by itself.

To change the saved answers: `python scripts/trilium_sync/sync.py --reset`. The environment variables `TRILIUM_URL`, `TRILIUM_TOKEN` and `TRILIUM_ROOT_NOTE_ID` override the file.

## Options

| | |
|---|---|
| `--dry-run` | Show which pages would be written; change nothing |
| `--root ID` | Start from a different Trilium note instead of Projects (the `#public` rule still applies) |
| `--reset` | Forget the saved address and token, ask again |

## What it does

- **Pages.** Every published note becomes `projects/<path>/index.html`, mirroring the tree in Trilium. Folder names come from note titles ("SPI Bring-Up: MISO" becomes `spi-bring-up-miso`). To choose a name yourself, give the note a `#slug=my-name` label.
- **Explorer.** Rebuilt on every generated page and on the hand-written pages (`index.html`, `projects/index.html`). The terminal reads the Explorer, so `ls`, `cd` and Tab completion pick up new pages automatically. Hand-written pages keep their content; only the Explorer between the `explorer:start` and `explorer:end` markers is replaced.
- **Content.** Notes are converted to the site's markup: headings (a note's `h1` becomes `h2`), paragraphs, lists, bold and italic, code, tables (in a scrolling box), figures and links. Links between notes are rewritten to site links. Editor styling and scripts are dropped. Code notes become a code block.
- **Images.** Downloaded to `assets/img/gen-*`. If Pillow is installed (`pip install pillow`) they are also resized to at most 1600 px wide and saved as WebP; otherwise they are copied as they are. An image that cannot be downloaded is left as an "Image coming soon" placeholder and reported.
- **Descriptions.** A page's meta description is its first paragraph.
- **Clean-up.** Pages and images that came from Trilium but are no longer there are deleted. Anything hand-written is never touched.
- **Skipped, and reported.** Labelled notes of a type other than text, code and book (canvas, mind maps, files, and so on), and labelled protected (encrypted) notes. Their labelled child notes are still imported.

## Files

| File | Purpose |
|---|---|
| `sync.py` | The command |
| `etapi.py` | Read-only Trilium client (every Trilium URL path is in this file) |
| `convert.py` | Trilium HTML to site markup |
| `sitegen.py` | Explorer tree and page rendering |
| `page_template.html` | The page shell: Explorer, content, terminal, statusline |
| `site.json` | Site settings: the fixed Explorer entries, links in the statusline, which pages are hand-written |
| `config.py` | Saves the address and token |

Edit `site.json` when you add a hand-written page or fill in the LinkedIn URL. Run the tests with `python -m unittest discover -s scripts/trilium_sync/tests`.

## Not verified yet

The client has been tested only against a stand-in for Trilium, never a live server. The ETAPI paths are all in `etapi.py`, so a correction is a one-line change. Run `--dry-run` first: it shows the pages it would write without changing anything.
