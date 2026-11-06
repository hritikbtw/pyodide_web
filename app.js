"use strict";

/* ==================================================================
   pyodide playground
   ================================================================== */

const PYODIDE_VERSION = "0.29.5";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const STORE_KEY = "pyodide-playground.v3";

const els = {
  split: document.getElementById("split"),
  divider: document.getElementById("divider"),
  run: document.getElementById("run"),
  restart: document.getElementById("restart"),
  clear: document.getElementById("clear"),
  examples: document.getElementById("examples"),
  autoinstall: document.getElementById("autoinstall"),
  installOpen: document.getElementById("install-open"),
  installPop: document.getElementById("install-pop"),
  pipPkg: document.getElementById("pip-pkg"),
  pipInstall: document.getElementById("pip-install"),
  out: document.getElementById("out"),
  terminal: document.getElementById("terminal"),
  placeholder: document.getElementById("placeholder"),
  figs: document.getElementById("figs"),
  timing: document.getElementById("timing"),
  status: document.getElementById("status"),
  statusText: document.getElementById("status-text"),
  footPython: document.getElementById("foot-python"),
  footPyodide: document.getElementById("foot-pyodide"),
};

const state = { pyodide: null, booting: null, running: false, ratio: 0.5 };
let editor = null;
let promptLine = 0;

/* ------------------------------------------------------------------ *
 * utils
 * ------------------------------------------------------------------ */
function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload = () => resolve(url);
    s.onerror = () => reject(new Error("failed to load " + url));
    document.head.appendChild(s);
  });
}

function setStatus(text, kind = "") {
  els.statusText.textContent = text;
  els.status.className = kind;
}

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function writeLine(text, cls = "") {
  const last = els.terminal.lastElementChild;
  if (last && last.dataset.stream === "1" && !last.textContent.endsWith("\n")) last.textContent += "\n";
  els.terminal.appendChild(node("span", "line " + cls, text.endsWith("\n") ? text : text + "\n"));
  els.out.scrollTop = els.out.scrollHeight;
}

function writeStream(text, cls = "") {
  const last = els.terminal.lastElementChild;
  if (last && last.dataset.stream === "1" && last.dataset.cls === cls) {
    last.textContent += text;
  } else {
    const span = node("span", "line " + cls, text);
    span.dataset.stream = "1";
    span.dataset.cls = cls;
    els.terminal.appendChild(span);
  }
  els.out.scrollTop = els.out.scrollHeight;
}

function clearOutput() {
  els.terminal.textContent = "";
  els.figs.textContent = "";
  els.timing.textContent = "";
  els.placeholder.style.display = "";
}

/* ------------------------------------------------------------------ *
 * examples
 * ------------------------------------------------------------------ */
const EXAMPLES = {
  "basics": `import sys, platform

print("python", sys.version.split()[0], "on", platform.machine() or "wasm32")

squares = [n * n for n in range(1, 11)]
print("squares:", squares)
print("sum:", sum(squares))
print(f"average: {sum(squares) / len(squares):.2f}")
`,

  "input()": `name = input("name: ")
age = input("age: ")
print(f"hi {name}, next year you turn {int(age) + 1}")
`,

  "traceback": `def mean(xs):
    return sum(xs) / len(xs)

print("mean:", mean([1, 2, 3, 4]))
print(mean([]))  # ZeroDivisionError
`,

  "numpy": `import numpy as np

a = np.arange(12).reshape(3, 4)
print(a)
print("sum =", a.sum(), "mean =", round(float(a.mean()), 3))

inv = np.linalg.inv(np.array([[4.0, 1.0], [2.0, 3.0]]))
print("inverse:\\n", inv)
`,

  "matplotlib": `import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(0, 2 * np.pi, 400)
fig, ax = plt.subplots(figsize=(6, 3), dpi=120)
ax.plot(x, np.sin(x), label="sin x")
ax.plot(x, np.cos(x), label="cos x", linestyle="--")
ax.legend()
ax.grid(alpha=0.3)
ax.set_title("figures render as images")
plt.show()
`,

  "files": `from pathlib import Path

p = Path("/tmp/notes.txt")
p.write_text("written by python, in an in-memory FS\\n")
print("exists:", p.exists(), "| size:", p.stat().st_size, "bytes")
print(p.read_text().strip().upper())
`,

  "dataclasses": `import json
from dataclasses import dataclass, asdict

@dataclass
class Planet:
    name: str
    mass_earth: float
    moons: int = 0

planets = [Planet("Mercury", 0.055), Planet("Earth", 1.0, 1), Planet("Mars", 0.107, 2)]
print(json.dumps([asdict(p) for p in planets], indent=2))
print("heavier than half an Earth:", [p.name for p in planets if p.mass_earth > 0.5])
`,
};

/* ------------------------------------------------------------------ *
 * editor: CodeMirror 5, textarea fallback
 * ------------------------------------------------------------------ */
function makeEditor(initial) {
  const host = document.getElementById("editor");

  if (!window.CodeMirror) {
    const ta = document.createElement("textarea");
    ta.value = initial;
    ta.spellcheck = false;
    ta.style.cssText = "width:100%;height:100%;background:var(--bg);color:var(--fg);border:0;" +
      "padding:10px 16px;font:400 13px/1.55 var(--mono);outline:none;resize:none;white-space:pre;overflow:auto";
    host.appendChild(ta);
    return {
      getValue: () => ta.value,
      setValue: (v) => { ta.value = v; },
      on: (evt, fn) => {
        if (evt === "change") ta.addEventListener("input", fn);
        if (evt === "focus") ta.addEventListener("focus", fn);
      },
      focus: () => ta.focus(),
      refresh: () => {},
    };
  }

  const cm = CodeMirror(host, {
    value: initial,
    mode: { name: "python", version: 3, singleLineStringErrors: false },
    theme: "pyshell",
    lineNumbers: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    smartIndent: true,
    lineWrapping: false,
    autoCloseBrackets: true,
    matchBrackets: true,
    styleActiveLine: true,
    highlightActiveLineGutter: true,
    extraKeys: {
      "Ctrl-Enter": () => run(),
      "Cmd-Enter": () => run(),
      "Shift-Tab": "indentLess",
      "Ctrl-/": "toggleComment",
      "Cmd-/": "toggleComment",
    },
  });

  return {
    getValue: () => cm.getValue(),
    setValue: (v) => { cm.setValue(v); cm.clearHistory(); },
    on: (evt, fn) => cm.on(evt, fn),
    focus: () => cm.focus(),
    refresh: () => cm.refresh(),
  };
}

/* ------------------------------------------------------------------ *
 * pyodide
 * ------------------------------------------------------------------ */
let loadPyodideFn = null;
async function getLoadPyodide() {
  if (loadPyodideFn) return loadPyodideFn;
  try {
    const mod = await import(PYODIDE_BASE + "pyodide.mjs");
    loadPyodideFn = mod.loadPyodide;
  } catch (err) {
    await loadScript(PYODIDE_BASE + "pyodide.js");
    loadPyodideFn = window.loadPyodide;
  }
  return loadPyodideFn;
}

function hookStdio(py) {
  const decOut = new TextDecoder();
  const decErr = new TextDecoder();
  py.setStdout({ write: (buf) => { writeStream(decOut.decode(buf, { stream: true }), ""); return buf.length; } });
  py.setStderr({ write: (buf) => { writeStream(decErr.decode(buf, { stream: true }), "err"); return buf.length; } });
  py.setStdin({ stdin: promptReader() });
}

async function bootPyodide() {
  if (state.pyodide) return state.pyodide;
  if (state.booting) return state.booting;

  setStatus("booting pyodide…", "busy");
  state.booting = (async () => {
    const load = await getLoadPyodide();
    const py = await load({ indexURL: PYODIDE_BASE });
    await py.loadPackage("micropip");
    hookStdio(py);
    py.runPython(
      "import warnings as _w, os as _os\n" +
      "_os.environ.setdefault('MPLBACKEND', 'agg')\n" +
      "_w.filterwarnings('ignore', category=UserWarning, message='FigureCanvasAgg is non-interactive.*')\n"
    );
    const version = py.runPython("import sys; sys.version.split()[0]");
    state.pyodide = py;
    els.footPython.textContent = "python " + version;
    setStatus("ready", "ok");
    return py;
  })();

  try {
    return await state.booting;
  } finally {
    state.booting = null;
  }
}

async function pipInstall(pkgs) {
  const py = await bootPyodide();
  writeLine("[pip] installing " + pkgs.join(", "), "meta");
  setStatus("installing " + pkgs.join(" "), "busy");
  const literal = "[" + pkgs.map((p) => JSON.stringify(p)).join(", ") + "]";
  try {
    await py.loadPackage(pkgs);
  } catch (_notInDist) {
    await py.runPythonAsync(`import micropip\nawait micropip.install(${literal})\n`);
  }
  writeLine("[pip] done", "meta");
}

/* ------------------------------------------------------------------ *
 * execution
 * ------------------------------------------------------------------ */
function promptReader() {
  return () => {
    const value = window.prompt(`input() · line ${++promptLine}`);
    if (value === null) return null;
    if (value !== "") writeLine(value, "echo");
    return value + "\n";
  };
}

function cleanTraceback(err) {
  return String((err && err.message) || err)
    .split("\n")
    .filter((line) => !/_pyodide\//.test(line) &&
      !/^\s*(await CodeRunner|\.run_async|coroutine = eval|\.\.\.<\d+ lines>\.\.\.)/.test(line))
    .join("\n")
    .trimEnd();
}

async function collectFigures(py) {
  try {
    const figs = py.runPython(`
import sys, io, base64
_out = []
if "matplotlib" in sys.modules:
    try:
        import matplotlib.pyplot as plt
        for num in plt.get_fignums():
            fig = plt.figure(num)
            buf = io.BytesIO()
            fig.savefig(buf, format="png", dpi=110, bbox_inches="tight")
            _out.append(base64.b64encode(buf.getvalue()).decode())
        plt.close("all")
    except Exception:
        _out = []
_out
`);
    if (!figs || figs.length === 0) return;
    const arr = figs.toJs ? figs.toJs() : figs;
    for (const b64 of arr) {
      const img = document.createElement("img");
      img.src = "data:image/png;base64," + b64;
      els.figs.appendChild(img);
    }
    if (figs.destroy) figs.destroy();
    els.out.scrollTop = 0;
  } catch (_) { /* best effort */ }
}

async function execute(py, code) {
  const t0 = performance.now();
  setStatus("running…", "busy");
  try {
    await py.runPythonAsync(code);
    const ms = Math.round(performance.now() - t0);
    els.timing.textContent = ms + " ms";
    setStatus("ok " + ms + " ms", "ok");
    return { ok: true };
  } catch (err) {
    const tb = cleanTraceback(err);
    const m = /ModuleNotFoundError: No module named '([^']+)'/.exec(tb);
    return { ok: false, tb, missing: m ? m[1] : null };
  }
}

async function run() {
  if (state.running) return;
  const code = editor.getValue();
  if (!code.trim()) { setStatus("nothing to run"); return; }

  state.running = true;
  els.run.disabled = true;
  els.placeholder.style.display = "none";
  promptLine = 0;

  try {
    const py = await bootPyodide();
    els.figs.textContent = "";
    py.setStdin({ stdin: promptReader() });

    const autoInstalled = new Set();
    let res = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await execute(py, code);
      if (res.ok) break;
      if (!res.missing || !els.autoinstall.checked || autoInstalled.has(res.missing)) break;
      autoInstalled.add(res.missing);
      try {
        await pipInstall([res.missing]);
      } catch (err) {
        writeLine("[pip] " + (err && err.message ? err.message : String(err)), "err");
        break;
      }
    }

    if (res && !res.ok) {
      writeLine(res.tb, "err");
      setStatus("error", "error");
      if (res.missing) {
        const mod = res.missing;
        const btn = node("button", "hint-btn", "install " + mod);
        btn.onclick = () => pipInstall([mod]).then(() => btn.remove(), () => btn.remove());
        els.terminal.appendChild(btn);
      }
    }
    await collectFigures(py);
  } catch (err) {
    writeLine((err && err.message) || String(err), "err");
    setStatus("error", "error");
  } finally {
    state.running = false;
    els.run.disabled = false;
  }
}

/* ------------------------------------------------------------------ *
 * persistence
 * ------------------------------------------------------------------ */
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        code: editor.getValue(),
        example: els.examples.value,
        autoinstall: els.autoinstall.checked,
        ratio: state.ratio,
      }));
    } catch (_) { /* private mode, file:// */ }
  }, 400);
}

function restore() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (_) {}
  els.autoinstall.checked = saved ? saved.autoinstall !== false : true;
  if (saved && saved.example) els.examples.value = saved.example;
  if (saved && typeof saved.ratio === "number") {
    state.ratio = Math.min(0.85, Math.max(0.15, saved.ratio));
  }
  return (saved && saved.code && saved.code.trim()) || EXAMPLES["basics"];
}

/* ------------------------------------------------------------------ *
 * resizable split
 * ------------------------------------------------------------------ */
const narrowQuery = window.matchMedia("(max-width: 880px)");

function applySplit() {
  const narrow = narrowQuery.matches;
  const pct = (state.ratio * 100).toFixed(2) + "%";
  if (narrow) {
    els.split.style.gridTemplateColumns = "";
    els.split.style.gridTemplateRows = `${pct} 6px 1fr`;
  } else {
    els.split.style.gridTemplateRows = "";
    els.split.style.gridTemplateColumns = `${pct} 6px 1fr`;
  }
  els.divider.classList.toggle("horizontal", narrow);
  els.divider.setAttribute("aria-orientation", narrow ? "horizontal" : "vertical");
  if (editor) editor.refresh();
}

function startDrag(e) {
  e.preventDefault();
  const narrow = narrowQuery.matches;
  try { els.divider.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
  els.divider.classList.add("dragging");

  const move = (ev) => {
    const rect = els.split.getBoundingClientRect();
    const pos = narrow ? ev.clientY - rect.top : ev.clientX - rect.left;
    const total = narrow ? rect.height : rect.width;
    state.ratio = Math.min(0.85, Math.max(0.15, pos / total));
    applySplit();
  };
  const up = (ev) => {
    try { els.divider.releasePointerCapture(ev.pointerId); } catch (_) { /* ignore */ }
    els.divider.classList.remove("dragging");
    els.divider.removeEventListener("pointermove", move);
    els.divider.removeEventListener("pointerup", up);
    els.divider.removeEventListener("pointercancel", up);
    persist();
  };
  els.divider.addEventListener("pointermove", move);
  els.divider.addEventListener("pointerup", up);
  els.divider.addEventListener("pointercancel", up);
}

/* ------------------------------------------------------------------ *
 * install popover
 * ------------------------------------------------------------------ */
function openInstall() {
  els.installPop.hidden = false;
  els.pipPkg.focus();
  els.pipPkg.select();
}
function closeInstall() {
  els.installPop.hidden = true;
}

/* ------------------------------------------------------------------ *
 * boot the UI
 * ------------------------------------------------------------------ */
function init() {
  for (const name of Object.keys(EXAMPLES)) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    els.examples.appendChild(opt);
  }

  editor = makeEditor(restore());
  applySplit();

  els.examples.addEventListener("change", () => {
    editor.setValue(EXAMPLES[els.examples.value] || "");
    clearOutput();
    editor.focus();
    persist();
  });

  els.run.addEventListener("click", run);

  els.clear.addEventListener("click", () => {
    clearOutput();
    setStatus("idle");
    editor.focus();
  });

  els.restart.addEventListener("click", () => {
    if (state.running) return;
    clearOutput();
    state.pyodide = null;
    state.booting = null;
    els.footPython.textContent = "python not loaded";
    setStatus("idle");
    writeLine("[sys] interpreter dropped — next run boots a clean one", "meta");
  });

  els.installOpen.addEventListener("click", () => {
    if (els.installPop.hidden) openInstall(); else closeInstall();
  });

  els.pipInstall.addEventListener("click", async () => {
    const pkgs = els.pipPkg.value.split(/[\s,]+/).filter(Boolean);
    if (!pkgs.length) { els.pipPkg.focus(); return; }
    els.placeholder.style.display = "none";
    try {
      await pipInstall(pkgs);
      setStatus("ready", "ok");
      closeInstall();
    } catch (err) {
      writeLine("[pip] " + (err && err.message ? err.message : String(err)), "err");
      setStatus("install failed", "error");
    }
  });

  els.pipPkg.addEventListener("keydown", (e) => {
    if (e.key === "Enter") els.pipInstall.click();
  });

  document.addEventListener("pointerdown", (e) => {
    if (els.installPop.hidden) return;
    if (els.installPop.contains(e.target) || els.installOpen.contains(e.target)) return;
    closeInstall();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.installPop.hidden) closeInstall();
  }, true);

  els.divider.addEventListener("pointerdown", startDrag);
  els.divider.addEventListener("dblclick", () => {
    state.ratio = 0.5;
    applySplit();
    persist();
  });

  window.addEventListener("resize", applySplit);
  narrowQuery.addEventListener("change", applySplit);
  window.addEventListener("beforeunload", persist);

  els.autoinstall.addEventListener("change", persist);
  editor.on("change", persist);
  editor.on("focus", () => {
    if (!state.pyodide && !state.booting) bootPyodide().catch(() => {});
  });

  els.footPyodide.textContent = "pyodide " + PYODIDE_VERSION;
  editor.focus();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
