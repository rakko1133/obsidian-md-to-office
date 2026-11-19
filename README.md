# Batch Office Export

An [Obsidian](https://obsidian.md) plugin that batch-converts notes to Word documents (.docx), Excel workbooks (.xlsx) and PDF. Mermaid diagrams are converted to images.

[日本語の説明 (README.ja.md)](README.ja.md)

- Convert one note, a folder, or the whole vault in one run
- Word: headings, lists, tables, code (with syntax colors), callouts, footnotes, math, images, embeds, Mermaid diagrams, Dataview results
- Word: combine several notes into one document (ordered by file name, frontmatter, or a map-of-content note), with a cover page and a table of contents
- Excel: export the tables in your notes (one sheet per note or per table), or an outline of the note; summarize the tasks, frontmatter and Dataview tables of a vault into one workbook
- PDF: looks like Obsidian's reading view (math, Mermaid, Dataview, callouts as you see them), with bookmarks, links between PDFs, page numbers, and the same combine / cover page / table of contents options as Word
- Save Mermaid diagrams as SVG / PNG files
- English and Japanese UI (follows Obsidian's language setting)

This plugin is not affiliated with Microsoft. "Word" and "Excel" refer to the file formats (.docx / .xlsx). The files can also be opened by other applications that support these formats.

## Requirements

- Obsidian 1.15.1 or later, **desktop only** (Windows, macOS, Linux). The plugin uses Node.js file APIs, so it does not run on mobile.

## Installation

From Obsidian: **Settings → Community plugins → Browse**, search for "Batch Office Export", then install and enable it.

Manual installation: download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/rakko1133/obsidian-md-to-office/releases/latest), put them in `<your vault>/.obsidian/plugins/batch-office-export/`, then enable the plugin in **Settings → Community plugins**.

## Usage

### Commands

Open the command palette (Ctrl/Cmd + P) and type "Batch Office Export".

| Command | What it does |
|---|---|
| Convert the current note to Word / Excel / PDF | Converts the open note |
| Convert the whole vault to Word / Excel / PDF | Converts every note that matches the target settings |
| Convert the current note / whole vault (choose formats) | Lets you choose any combination of Word, Excel and PDF in the confirmation dialog |
| Summarize the vault in Excel | Collects tasks, frontmatter and Dataview tables into one workbook |
| Save Mermaid diagrams in the current note / whole vault as images | Saves each diagram as SVG / PNG |

### File menu

Right-click a note or a folder in the file explorer (you can select several) and choose **Convert to Word (.docx)**, **Convert to Excel (.xlsx)**, **Convert to PDF**, **Convert (choose formats)…** or **Save Mermaid diagrams as images**.

Before converting, a dialog shows the target files and where each output will be written. You can uncheck files, choose the formats, and turn on **Combine each folder into one file** for Word and PDF. After the run, a report lists the results, warnings and errors.

### Where files are written

By default, outputs go to the `_export` folder in your vault, mirroring the folder structure of the notes. You can change the folder, write next to each note instead, or write to a folder outside the vault (**Settings → Batch Office Export → Output**).

## Settings

| Section | Main settings |
|---|---|
| Output | Default formats, output folder (in or outside the vault), mirror or same folder, what to do when a file with the same name exists (overwrite / skip / rename) |
| Targets | Include and exclude patterns (glob). `**/*.excalidraw.md` is excluded by default |
| Running | What to do when a note fails, timeout per note |
| Mermaid images | SVG / PNG, PNG resolution, transparent background, font, also save diagrams as image files when converting |
| Word | Paper size, orientation, margins, fonts, file name as title, author name, line breaks, code line numbers, comments, frontmatter table, external images, callout colors, page numbers, header title, cover page, table of contents, combine order, template (.docx / .dotx), heading numbering, page break before heading 1, full-width tables, figure and table captions |
| Excel | One workbook per folder or per note, one sheet per note or per table, outline mode, Excel tables, source columns |
| PDF | Paper size, orientation, margins, scale. The cover page, table of contents, header and footer follow the Word settings |

## Notes

- **Network use**: the plugin does not send your notes anywhere. It accesses the network only when **Word → Download external images** is turned on (off by default): images linked by URL (`![](https://…)`) are then downloaded (up to 20 MB each) and embedded. When it is off, such images become links.
- **Files outside the vault**: the plugin reads and writes files outside the vault only when you set an external output folder or a template with an absolute path.
- **Dataview**: to include the results of `dataview` / `dataviewjs` blocks, the plugin asks Obsidian to render them, the same way as when you open the note. This means `dataviewjs` code in the converted notes is executed, just as it is in reading view. The Dataview plugin must be installed for these blocks to be converted.
- **Files the plugin keeps**: a record of past outputs (`export-record.json`) and a cache of rendered diagrams are stored in the plugin folder (`.obsidian/plugins/batch-office-export/`).
- **PDF**: PDF files are printed from Obsidian's reading view with Obsidian's own print styles. While converting to PDF, Obsidian switches to the light theme and switches back when the run ends. The table of contents in a PDF has no page numbers, and a link to another PDF opens its first page.
- **Rendering**: Mermaid diagrams, math and code highlighting use Obsidian's own renderers, so the look follows your Obsidian version. Math that Word's equation format cannot express is embedded as an image rendered with the bundled MathJax.

## Building from source

```sh
npm install
npm run build   # type check and production build -> main.js
npm test        # unit tests (Vitest)
```

Design documents (in Japanese) are in [docs/](docs/README.md).

## License

[MIT](LICENSE). The bundled third-party packages are listed with their licenses in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (generated by `node scripts/third-party-notices.mjs`).
