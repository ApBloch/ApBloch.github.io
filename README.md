# ApBloch.github.io

Aaron Bloch's portfolio site. Plain HTML and CSS, no framework, no build step on the site itself. Served by GitHub Pages from the `main` branch root.

The design is a Neovim-style layout in Rose Pine Moon: an Explorer tree on the left, the page on the right, a terminal at the bottom (`ls`, `cd`, `help`, `clear`, Tab completion) and a statusline. The terminal is an enhancement; everything works without JavaScript.

## Layout

```
index.html                 home page (hand-written)
projects/index.html        projects landing page (hand-written)
projects/<notes>/          pages generated from Trilium, do not edit by hand
404.html
assets/css/style.css       site stylesheet
assets/js/terminal.js      the terminal
assets/img/gen-*           images downloaded from Trilium
tools/prog-calc/           standalone programmer calculator (uses the root style.css)
scripts/trilium_sync/      the Trilium import script (see its README)
```

## Importing from Trilium

Notes labelled `#public` in Trilium become pages. One command:

```bash
python scripts/trilium_sync/sync.py
```

It only reads from Trilium and never commits. Review with `git status` and `git diff`, preview locally, then commit. Details are in [scripts/trilium_sync/README.md](scripts/trilium_sync/README.md).

Preview locally (pages are folders, so opening the files directly will not work):

```bash
python -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/`.

## Rules for anything published here

- No employer information, no phone number or street address, no MAC addresses, serial numbers or credentials.
- No job search content.
- Use status labels honestly; measurements from dev boards say so.

## Before you ship: check for unresolved placeholders

Missing text is marked with a pink `[TODO: ...]` or `[WIP: ...]` box. Find them all with:

```bash
grep -rn "TODO\|WIP" --include="*.html" . | grep -v "^./projects/custom-console-build"
```

Nothing should ship with a TODO unnoticed.

## Still needed

- LinkedIn URL (`scripts/trilium_sync/site.json`, and the two hand-written pages)
- Resume PDF, checked for a phone number or address first
- Repo URLs for each project
- Home and projects intro lines, project descriptions, meta descriptions
- An About page
