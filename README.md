# ApBloch.github.io

Aaron Bloch's portfolio site. Plain HTML and CSS, no framework, no build step. Served by GitHub Pages from the `main` branch root.

## Layout

```
index.html              home page
404.html
assets/css/style.css    site stylesheet
tools/prog-calc/        standalone programmer calculator (uses the root style.css)
style.css               legacy stylesheet, used only by the calculator
```

## Rules for anything published here

- No employer information, no phone number or street address, no MAC addresses, serial numbers or credentials.
- No job search content.
- Use the status labels honestly; measurements from dev boards say so.

## Before you ship: check for unresolved placeholders

Missing text is marked with a yellow `[TODO: ...]` span. Find them all with:

```bash
grep -rn "TODO" --include="*.html" .
```

Nothing should ship with a TODO unnoticed.

## Still needed from Aaron

- LinkedIn URL
- Resume PDF (`assets/Aaron_Bloch_Embedded_Engineer_Resume.pdf`), checked for phone/address first
- Repo URLs for each project
- Project page content (to be added from Trilium as it is reviewed)
- About page copy confirmation (location line, "open to work" wording)

## Planned

A `tools/` sync script will pull notes labelled `#publish` from Trilium (via ETAPI, read-only), redact and convert them, and write generated pages for review before commit.
