# Pyodide Jupyter Notebook

A self-contained in-browser Jupyter notebook environment. CPython 3.13 runs as WebAssembly via [Pyodide](https://pyodide.org) 0.29.5 — client-side, zero backend, nothing uploaded to any server.

```
index.html            markup: notebook header, toolbar, canvas, cells container, status bar
styles.css            VS Code / JupyterLab Dark & Light Modern palettes, cell styling, markdown typography
app.js                cell management, CodeMirror 6 instances, Pyodide kernel, .ipynb import/export
codemirror.bundle.js  self-contained CodeMirror 6 bundle (Python grammar, Lezer AST, bracket matching, folding)
```

## Run

```bash
python3 -m http.server 8123
# Open http://127.0.0.1:8123/
```

`index.html` also works straight from `file://`; only `localStorage` autosave may be restricted depending on browser policies.

## Features

- **Jupyter Notebook Architecture**:
  - Independent **Code** and **Markdown** cells.
  - Interactive cell gutters showing `In [n]:` and `Out [n]:`.
  - Rich outputs: stdout / stderr streams, expression return values, formatted tracebacks, and inline images.
- **CodeMirror 6 Editor**:
  - Full Python AST syntax highlighting, auto-indentation, bracket matching/closing, and code folding.
  - Cell keybindings:
    - `Shift`+`Enter`: Run cell and advance to next cell (inserts a new cell if at the bottom).
    - `Ctrl`+`Enter` / `Cmd`+`Enter`: Run cell in place.
    - `Alt`+`Enter`: Run cell and insert a new code cell below.
    - `Esc`: Unfocus editor into command mode.
    - Command mode shortcuts: `A` (insert above), `B` (insert below), `M` (markdown), `Y` (code), `D, D` (delete cell), `Enter` (edit cell), `Up`/`Down` (navigate cells).
- **Rich Markdown Cells**:
  - Built-in self-contained Markdown compiler (headings, lists, tables, blockquotes, code blocks, links).
  - Double-click to edit, `Shift`+`Enter` to render.
- **Jupyter `.ipynb` File Support**:
  - **Export `.ipynb`**: Save notebooks in standard Jupyter Notebook v4.5 JSON format, compatible with JupyterLab, VS Code, and Google Colab.
  - **Import `.ipynb`**: Open or drag-and-drop any `.ipynb` file directly into the browser.
- **Interactive Python Kernel**:
  - Persistent global namespace: variables, functions, and imports survive between cells.
  - Automatic evaluation of the last expression in a cell (`Out [n]: ...`).
  - Matplotlib plots rendered inline automatically as PNG images.
  - `input()` support via browser prompts.
  - Package installation via `micropip` / Pyodide CDN with an auto-install missing packages switch.
- **Autosave**:
  - All cells, sources, outputs, and notebook title are automatically saved to `localStorage`.
