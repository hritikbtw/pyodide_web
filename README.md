# pyodide playground

Small in-browser Python playground. CPython 3.13 runs as WebAssembly via
[Pyodide](https://pyodide.org) 0.29.5 — no backend, nothing is uploaded.

```
index.html   markup: split panes, toolbar, output, status bar
styles.css   VS Code "Dark Modern" / "Light Modern" palettes, chosen by prefers-color-scheme
app.js       editor, interpreter lifecycle, execution, persistence
```

## Run

```bash
python3 -m http.server 8123
# http://127.0.0.1:8123/
```

`index.html` also works straight from `file://`; only `localStorage` autosave may
be unavailable there.

## UI

- **Resizable split** — drag the divider, double-click it to reset to 50/50.
  The ratio is remembered and the layout flips to stacked rows under 880 px.
- **Toolbar** — Run, restart interpreter (icon), example picker, install (icon).
  Icons are [VS Code codicons](https://github.com/microsoft/vscode-codicons) (MIT).
- **Install popover** — hidden until you click the cloud icon; holds the package
  field and the "auto-install missing imports" switch.
- **No stdin box** — `input()` asks through a browser prompt, so the panel only
  shows what you are actually using.
- **Status bar** — interpreter state, Python version, Pyodide version, shortcuts.
- Theming follows the OS: dark and light are the VS Code Modern palettes, and the
  CodeMirror token colors match them (keywords, strings, numbers, decorators).

## Behaviour

- One long-lived `runPythonAsync()` kernel: variables, imports and installed
  packages survive between runs; the restart button drops it.
- stdout/stderr stream byte-level through `setStdout({ write })`, so `print(x, end="")`
  and prompts appear in order; tracebacks drop Pyodide's internal frames.
- `ModuleNotFoundError` installs and re-runs automatically (dist packages via
  `loadPackage`, anything else via `micropip`), plus a one-click button on the error.
- matplotlib figures are saved as PNGs after each run and shown inline (wasm has no
  GUI backend); `MPLBACKEND=agg` and the "non-interactive" warning are handled.
- Code, example choice, auto-install switch and split ratio are autosaved.

## Caveats

- No interrupt: stopping a runaway loop needs a `SharedArrayBuffer` interrupt
  buffer, which requires serving with `Cross-Origin-Opener-Policy: same-origin`
  and `Cross-Origin-Embedder-Policy: require-corp`. Infinite loops freeze the tab.
- First run pulls ~10 MB of Pyodide; packages add their own weight.
- Installed packages live in that tab's memory only.
