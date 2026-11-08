"use strict";

/* ==================================================================
   Pyodide Jupyter Notebook
   ================================================================== */

const PYODIDE_VERSION = "0.29.5";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const STORAGE_KEY = "pyodide-notebook.v1";

const state = {
  pyodide: null,
  booting: null,
  executing: false,
  executionCounter: 0,
  activeCellId: null,
  cells: [],
  title: "playground.ipynb",
  autoInstall: true,
};

const els = {
  title: document.getElementById("nb-title"),
  notebook: document.getElementById("notebook"),
  main: document.getElementById("notebook-main"),
  btnAddCode: document.getElementById("btn-add-code"),
  btnAddMd: document.getElementById("btn-add-md"),
  btnRun: document.getElementById("btn-run"),
  btnRunAll: document.getElementById("btn-run-all"),
  btnRestart: document.getElementById("btn-restart"),
  btnClearAll: document.getElementById("btn-clear-all"),
  btnOpen: document.getElementById("btn-open"),
  btnExport: document.getElementById("btn-export"),
  fileInput: document.getElementById("nb-file-input"),
  installOpen: document.getElementById("install-open"),
  installPop: document.getElementById("install-pop"),
  pipPkg: document.getElementById("pip-pkg"),
  pipInstall: document.getElementById("pip-install"),
  autoInstall: document.getElementById("autoinstall"),
  footStatus: document.getElementById("foot-status"),
  footPython: document.getElementById("foot-python"),
  footCellCount: document.getElementById("foot-cell-count"),
  bottomAddCode: document.getElementById("bottom-add-code"),
  bottomAddMd: document.getElementById("bottom-add-md"),
};

/* ------------------------------------------------------------------ *
 * Self-Contained Markdown Parser
 * ------------------------------------------------------------------ */
function parseMarkdown(md) {
  if (!md || !md.trim()) return "<p><em>Empty markdown cell. Double-click or press Enter to edit.</em></p>";

  const lines = md.split("\n");
  let html = "";
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockContent = [];
  let inList = false;
  let listType = "ul";
  let inTable = false;
  let tableRows = [];

  function closeList() {
    if (inList) {
      html += `</${listType}>\n`;
      inList = false;
    }
  }

  function closeTable() {
    if (inTable) {
      if (tableRows.length > 0) {
        html += "<table>\n";
        tableRows.forEach((row, i) => {
          const tag = i === 0 ? "th" : "td";
          html += "<tr>" + row.map(cell => `<${tag}>${formatInline(cell.trim())}</${tag}>`).join("") + "</tr>\n";
        });
        html += "</table>\n";
      }
      tableRows = [];
      inTable = false;
    }
  }

  function formatInline(str) {
    if (!str) return "";
    let s = str
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.*?)__/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/_(.*?)_/g, "<em>$1</em>")
      .replace(/~~(.*?)~~/g, "<del>$1</del>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/&lt;kbd&gt;(.*?)&lt;\/kbd&gt;/g, "<kbd>$1</kbd>");
    return s;
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Fenced Code Blocks
    if (trimmed.startsWith("```")) {
      if (!inCodeBlock) {
        closeList();
        closeTable();
        inCodeBlock = true;
        codeBlockLang = trimmed.slice(3).trim();
        codeBlockContent = [];
      } else {
        inCodeBlock = false;
        const esc = codeBlockContent.join("\n")
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        html += `<pre><code class="${codeBlockLang}">${esc}</code></pre>\n`;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(rawLine);
      continue;
    }

    // Tables
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      closeList();
      const cells = trimmed.slice(1, -1).split("|");
      if (cells.every(c => /^[\s:-]+$/.test(c))) {
        // Separator row, skip
        continue;
      }
      inTable = true;
      tableRows.push(cells);
      continue;
    } else {
      closeTable();
    }

    // Empty lines
    if (!trimmed) {
      closeList();
      continue;
    }

    // Horizontal rule
    if (/^(\*\*\*|---|___)$/.test(trimmed)) {
      closeList();
      html += "<hr>\n";
      continue;
    }

    // Headings
    const headingMatch = rawLine.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      html += `<h${level}>${formatInline(headingMatch[2])}</h${level}>\n`;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith(">")) {
      closeList();
      html += `<blockquote>${formatInline(trimmed.replace(/^>\s?/, ""))}</blockquote>\n`;
      continue;
    }

    // Lists
    const ulMatch = rawLine.match(/^(\s*)[-*+]\s+(.*)$/);
    const olMatch = rawLine.match(/^(\s*)\d+\.\s+(.*)$/);
    if (ulMatch || olMatch) {
      const isOl = Boolean(olMatch);
      const text = isOl ? olMatch[2] : ulMatch[2];
      const targetType = isOl ? "ol" : "ul";

      if (!inList || listType !== targetType) {
        closeList();
        html += `<${targetType}>\n`;
        inList = true;
        listType = targetType;
      }
      html += `<li>${formatInline(text)}</li>\n`;
      continue;
    } else {
      closeList();
    }

    // Paragraph
    html += `<p>${formatInline(trimmed)}</p>\n`;
  }

  closeList();
  closeTable();
  if (inCodeBlock) {
    const esc = codeBlockContent.join("\n").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html += `<pre><code>${esc}</code></pre>\n`;
  }

  return html;
}

/* ------------------------------------------------------------------ *
 * Pyodide Python Kernel
 * ------------------------------------------------------------------ */
function setKernelStatus(text, kind = "") {
  if (els.footStatus) {
    els.footStatus.textContent = text.startsWith("Pyodide") ? text : "Pyodide: " + text.replace(/…$/, "");
    els.footStatus.className = kind ? "status-" + kind : "";
  }
}

let loadPyodideFn = null;
async function getLoadPyodide() {
  if (loadPyodideFn) return loadPyodideFn;
  try {
    const mod = await import(PYODIDE_BASE + "pyodide.mjs");
    loadPyodideFn = mod.loadPyodide;
  } catch (err) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PYODIDE_BASE + "pyodide.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load pyodide.js"));
      document.head.appendChild(s);
    });
    loadPyodideFn = window.loadPyodide;
  }
  return loadPyodideFn;
}

async function bootPyodide() {
  if (state.pyodide) return state.pyodide;
  if (state.booting) return state.booting;

  setKernelStatus("Booting Pyodide…", "busy");
  state.booting = (async () => {
    const load = await getLoadPyodide();
    const py = await load({ indexURL: PYODIDE_BASE });
    await py.loadPackage("micropip");

    py.runPython(
      "import warnings as _w, os as _os, sys as _sys, io as _io, base64 as _base64, ast as _ast, inspect as _inspect\n" +
      "_os.environ.setdefault('MPLBACKEND', 'agg')\n" +
      "_w.filterwarnings('ignore', category=UserWarning, message='FigureCanvasAgg is non-interactive.*')\n\n" +
      "async def _pyodide_jupyter_run(code_str, user_ns):\n" +
      "    tree = _ast.parse(code_str)\n" +
      "    if not tree.body:\n" +
      "        return None, False\n" +
      "    last = tree.body[-1]\n" +
      "    if isinstance(last, _ast.Expr):\n" +
      "        if tree.body[:-1]:\n" +
      "            mod = _ast.Module(body=tree.body[:-1], type_ignores=[])\n" +
      "            exec(compile(mod, '<cell>', 'exec'), user_ns)\n" +
      "        res = eval(compile(_ast.Expression(body=last.value), '<cell>', 'eval'), user_ns)\n" +
      "        if _inspect.isawaitable(res):\n" +
      "            res = await res\n" +
      "        return res, True\n" +
      "    else:\n" +
      "        exec(compile(tree, '<cell>', 'exec'), user_ns)\n" +
      "        return None, False\n\n" +
      "def _pyodide_jupyter_figs():\n" +
      "    _out = []\n" +
      "    if 'matplotlib' in _sys.modules:\n" +
      "        try:\n" +
      "            import matplotlib.pyplot as _plt\n" +
      "            for _num in _plt.get_fignums():\n" +
      "                _fig = _plt.figure(_num)\n" +
      "                _buf = _io.BytesIO()\n" +
      "                _fig.savefig(_buf, format='png', dpi=110, bbox_inches='tight')\n" +
      "                _out.append(_base64.b64encode(_buf.getvalue()).decode('ascii'))\n" +
      "            _plt.close('all')\n" +
      "        except Exception:\n" +
      "            pass\n" +
      "    return _out\n"
    );

    const version = py.runPython("import sys; sys.version.split()[0]");
    state.pyodide = py;
    els.footPython.textContent = "Python " + version + " (Pyodide " + PYODIDE_VERSION + ")";
    setKernelStatus("Pyodide Ready", "ok");
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
  setKernelStatus("Installing " + pkgs.join(", "), "busy");
  const literal = "[" + pkgs.map(p => JSON.stringify(p)).join(", ") + "]";
  try {
    await py.loadPackage(pkgs);
  } catch (_notInDist) {
    await py.runPythonAsync(`import micropip\nawait micropip.install(${literal})\n`);
  }
  setKernelStatus("Pyodide Ready", "ok");
}

function cleanTraceback(err) {
  return String((err && err.message) || err)
    .split("\n")
    .filter(line => !/_pyodide\//.test(line) &&
      !/^\s*(await CodeRunner|\.run_async|coroutine = eval|\.\.\.<\d+ lines>\.\.\.|_pyodide_jupyter_run)/.test(line))
    .join("\n")
    .trimEnd();
}

/* ------------------------------------------------------------------ *
 * CodeMirror 6 Editor Factory
 * ------------------------------------------------------------------ */
function createCellEditor(host, initialValue, cellId) {
  if (!window.CodeMirror6) {
    const ta = document.createElement("textarea");
    ta.value = initialValue;
    ta.spellcheck = false;
    host.appendChild(ta);
    return {
      getValue: () => ta.value,
      setValue: (v) => { ta.value = v; },
      focus: () => ta.focus(),
      destroy: () => ta.remove(),
    };
  }

  const {
    basicSetup,
    EditorView,
    EditorState,
    keymap,
    indentWithTab,
    indentUnit,
    syntaxHighlighting,
    HighlightStyle,
    tags,
    python,
  } = window.CodeMirror6;

  const highlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: "var(--syn-keyword)" },
    { tag: [tags.string, tags.docString], color: "var(--syn-string)" },
    { tag: [tags.number, tags.integer, tags.float], color: "var(--syn-number)" },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--syn-comment)" },
    { tag: [tags.function(tags.variableName), tags.definition(tags.function(tags.variableName))], color: "var(--syn-function)" },
    { tag: tags.typeName, color: "var(--syn-type)" },
    { tag: [tags.variableName, tags.propertyName], color: "var(--syn-variable)" },
    { tag: [tags.constant(tags.variableName), tags.bool, tags.null, tags.atom], color: "var(--syn-constant)" },
    { tag: tags.operator, color: "var(--syn-operator)" },
    { tag: [tags.meta, tags.annotation, tags.modifier], color: "var(--syn-decorator)" },
  ]);

  const cellKeymap = keymap.of([
    indentWithTab,
    {
      key: "Shift-Enter",
      run: () => {
        runCellAndAdvance(cellId);
        return true;
      },
    },
    {
      key: "Mod-Enter",
      run: () => {
        runCell(cellId);
        return true;
      },
    },
    {
      key: "Alt-Enter",
      run: () => {
        runCell(cellId).then(() => insertCellBelow(cellId, "code"));
        return true;
      },
    },
    {
      key: "Escape",
      run: (view) => {
        view.contentDOM.blur();
        return true;
      },
    },
  ]);

  const view = new EditorView({
    state: EditorState.create({
      doc: initialValue,
      extensions: [
        basicSetup,
        python(),
        indentUnit.of("    "),
        syntaxHighlighting(highlightStyle),
        cellKeymap,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const cell = getCell(cellId);
            if (cell) cell.source = view.state.doc.toString();
            debounceSave();
          }
        }),
      ],
    }),
    parent: host,
  });

  view.contentDOM.addEventListener("focus", () => {
    setActiveCell(cellId);
  });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue: (v) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: v },
      });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

/* ------------------------------------------------------------------ *
 * Notebook Cell Model & Actions
 * ------------------------------------------------------------------ */
function getCell(id) {
  return state.cells.find(c => c.id === id);
}

function getCellIndex(id) {
  return state.cells.findIndex(c => c.id === id);
}

function setActiveCell(id) {
  if (state.activeCellId === id) return;
  state.activeCellId = id;
  document.querySelectorAll(".cell").forEach(el => {
    el.classList.toggle("active", el.dataset.id === id);
  });
}

function updateCellCounts() {
  els.footCellCount.textContent = `${state.cells.length} cell${state.cells.length === 1 ? "" : "s"}`;
}

function renderCellElement(cell) {
  const cellDiv = document.createElement("div");
  cellDiv.className = `cell ${cell.type} ${state.activeCellId === cell.id ? "active" : ""}`;
  cellDiv.dataset.id = cell.id;

  // Toolbar
  const toolbar = document.createElement("div");
  toolbar.className = "cell-toolbar";

  const runBtn = document.createElement("button");
  runBtn.className = "btn";
  runBtn.title = "Run cell (Shift+Enter)";
  runBtn.innerHTML = '<svg class="i" viewBox="0 0 16 16"><path d="M4 13.48V3.35l7.6 5.07L4 13.48z"/></svg>';
  runBtn.onclick = (e) => { e.stopPropagation(); runCell(cell.id); };
  toolbar.appendChild(runBtn);

  const typeSelect = document.createElement("select");
  typeSelect.className = "type-select";
  typeSelect.innerHTML = `
    <option value="code" ${cell.type === "code" ? "selected" : ""}>Code</option>
    <option value="markdown" ${cell.type === "markdown" ? "selected" : ""}>Markdown</option>
  `;
  typeSelect.onchange = (e) => {
    e.stopPropagation();
    switchCellType(cell.id, typeSelect.value);
  };
  toolbar.appendChild(typeSelect);

  const upBtn = document.createElement("button");
  upBtn.className = "btn";
  upBtn.title = "Move cell up";
  upBtn.innerHTML = '<svg class="i" viewBox="0 0 16 16"><path d="M8 4l-4 4h8L8 4z"/></svg>';
  upBtn.onclick = (e) => { e.stopPropagation(); moveCell(cell.id, -1); };
  toolbar.appendChild(upBtn);

  const downBtn = document.createElement("button");
  downBtn.className = "btn";
  downBtn.title = "Move cell down";
  downBtn.innerHTML = '<svg class="i" viewBox="0 0 16 16"><path d="M8 12l4-4H4l4 4z"/></svg>';
  downBtn.onclick = (e) => { e.stopPropagation(); moveCell(cell.id, 1); };
  toolbar.appendChild(downBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "btn";
  delBtn.title = "Delete cell";
  delBtn.innerHTML = '<svg class="i" viewBox="0 0 16 16"><path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/></svg>';
  delBtn.onclick = (e) => { e.stopPropagation(); deleteCell(cell.id); };
  toolbar.appendChild(delBtn);

  cellDiv.appendChild(toolbar);

  // Input Row
  const inputRow = document.createElement("div");
  inputRow.className = "cell-input-row";

  const gutter = document.createElement("div");
  gutter.className = "cell-gutter";
  gutter.textContent = cell.type === "code"
    ? `In [${cell.executionCount != null ? cell.executionCount : " "}]:`
    : "";
  gutter.onclick = () => runCell(cell.id);
  inputRow.appendChild(gutter);

  const body = document.createElement("div");
  body.className = "cell-body";

  const editorHost = document.createElement("div");
  editorHost.className = "cell-editor";
  if (cell.type === "markdown" && !cell.editing) {
    editorHost.style.display = "none";
  }
  body.appendChild(editorHost);

  const mdView = document.createElement("div");
  mdView.className = "cell-markdown-view";
  if (cell.type === "code" || cell.editing) {
    mdView.style.display = "none";
  } else {
    mdView.innerHTML = parseMarkdown(cell.source);
  }
  mdView.ondblclick = () => {
    editMarkdownCell(cell.id);
  };
  body.appendChild(mdView);

  inputRow.appendChild(body);
  cellDiv.appendChild(inputRow);

  // Output Area (for code cells)
  const outputArea = document.createElement("div");
  outputArea.className = "cell-output-area";
  if (cell.type !== "code" || (!cell.outputs || cell.outputs.length === 0)) {
    outputArea.style.display = "none";
  }
  cellDiv.appendChild(outputArea);

  cellDiv.onclick = () => setActiveCell(cell.id);

  // Insert Divider
  const divider = document.createElement("div");
  divider.className = "cell-divider";
  divider.innerHTML = `
    <div class="cell-divider-btns">
      <button class="cell-divider-btn" data-type="code">+ Code</button>
      <button class="cell-divider-btn" data-type="markdown">+ Markdown</button>
    </div>
  `;
  divider.querySelectorAll(".cell-divider-btn").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      insertCellBelow(cell.id, btn.dataset.type);
    };
  });

  const wrapper = document.createDocumentFragment();
  wrapper.appendChild(cellDiv);
  wrapper.appendChild(divider);

  cell.element = cellDiv;
  cell.gutterElement = gutter;
  cell.editorHost = editorHost;
  cell.mdView = mdView;
  cell.outputArea = outputArea;

  return wrapper;
}

function mountCellEditor(cell) {
  if (cell.editor) return;
  cell.editor = createCellEditor(cell.editorHost, cell.source, cell.id);
  if (cell.outputs && cell.outputs.length > 0) {
    renderCellOutputs(cell);
  }
}

function switchCellType(cellId, newType) {
  const cell = getCell(cellId);
  if (!cell || cell.type === newType) return;
  cell.type = newType;
  if (newType === "markdown") {
    cell.outputs = [];
    cell.executionCount = null;
    cell.editing = false;
  }
  refreshCell(cell);
  debounceSave();
}

function editMarkdownCell(cellId) {
  const cell = getCell(cellId);
  if (!cell || cell.type !== "markdown") return;
  cell.editing = true;
  cell.mdView.style.display = "none";
  cell.editorHost.style.display = "";
  if (cell.editor) cell.editor.focus();
}

function renderMarkdownCell(cellId) {
  const cell = getCell(cellId);
  if (!cell || cell.type !== "markdown") return;
  cell.editing = false;
  cell.source = cell.editor ? cell.editor.getValue() : cell.source;
  cell.mdView.innerHTML = parseMarkdown(cell.source);
  cell.mdView.style.display = "";
  cell.editorHost.style.display = "none";
}

function refreshCell(cell) {
  if (cell.editor) {
    cell.editor.destroy();
    cell.editor = null;
  }
  const oldEl = cell.element;
  const parent = oldEl.parentNode;
  const nextDivider = oldEl.nextElementSibling;

  const frag = renderCellElement(cell);
  parent.insertBefore(frag, oldEl);
  if (nextDivider && nextDivider.classList.contains("cell-divider")) {
    nextDivider.remove();
  }
  oldEl.remove();
  mountCellEditor(cell);
}

function insertCellBelow(cellId, type = "code") {
  const newId = "cell-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  const newCell = {
    id: newId,
    type,
    source: "",
    executionCount: null,
    outputs: [],
    editing: type === "markdown",
    editor: null,
  };

  const idx = cellId ? getCellIndex(cellId) : state.cells.length - 1;
  const insertIdx = idx >= 0 ? idx + 1 : state.cells.length;

  state.cells.splice(insertIdx, 0, newCell);

  const frag = renderCellElement(newCell);
  if (insertIdx < state.cells.length - 1) {
    const nextCell = state.cells[insertIdx + 1];
    els.notebook.insertBefore(frag, nextCell.element);
  } else {
    els.notebook.appendChild(frag);
  }

  mountCellEditor(newCell);
  setActiveCell(newId);
  if (newCell.editor) newCell.editor.focus();
  updateCellCounts();
  debounceSave();
  return newCell;
}

function deleteCell(cellId) {
  if (state.cells.length <= 1) {
    // If last cell, just clear its content
    const cell = state.cells[0];
    if (cell.editor) cell.editor.setValue("");
    cell.source = "";
    cell.outputs = [];
    cell.executionCount = null;
    renderCellOutputs(cell);
    debounceSave();
    return;
  }

  const idx = getCellIndex(cellId);
  if (idx === -1) return;

  const cell = state.cells[idx];
  if (cell.editor) cell.editor.destroy();

  const el = cell.element;
  const divider = el.nextElementSibling;
  if (divider && divider.classList.contains("cell-divider")) divider.remove();
  el.remove();

  state.cells.splice(idx, 1);

  const nextActive = state.cells[Math.min(idx, state.cells.length - 1)];
  if (nextActive) setActiveCell(nextActive.id);

  updateCellCounts();
  debounceSave();
}

function moveCell(cellId, dir) {
  const idx = getCellIndex(cellId);
  if (idx === -1) return;
  const targetIdx = idx + dir;
  if (targetIdx < 0 || targetIdx >= state.cells.length) return;

  const [moved] = state.cells.splice(idx, 1);
  state.cells.splice(targetIdx, 0, moved);

  renderNotebook();
  setActiveCell(cellId);
  if (moved.editor) moved.editor.focus();
  debounceSave();
}

/* ------------------------------------------------------------------ *
 * Cell Output Rendering
 * ------------------------------------------------------------------ */
function renderCellOutputs(cell) {
  const container = cell.outputArea;
  container.innerHTML = "";

  if (!cell.outputs || cell.outputs.length === 0) {
    container.style.display = "none";
    return;
  }

  container.style.display = "";

  for (const out of cell.outputs) {
    const row = document.createElement("div");
    row.className = "cell-output-row";

    const gutter = document.createElement("div");
    gutter.className = "cell-output-gutter";

    const content = document.createElement("div");
    content.className = "cell-output-content";

    if (out.output_type === "stream") {
      gutter.textContent = "";
      const pre = document.createElement("pre");
      pre.className = "output-stream " + (out.name === "stderr" ? "stderr" : "");
      pre.textContent = Array.isArray(out.text) ? out.text.join("") : String(out.text);
      content.appendChild(pre);
    } else if (out.output_type === "execute_result") {
      gutter.textContent = `Out [${out.execution_count}]:`;
      const pre = document.createElement("pre");
      pre.className = "output-result";
      const text = (out.data && (out.data["text/plain"] || out.data["text/html"])) || "";
      pre.textContent = Array.isArray(text) ? text.join("") : String(text);
      content.appendChild(pre);
    } else if (out.output_type === "display_data") {
      gutter.textContent = "";
      if (out.data && out.data["image/png"]) {
        const figs = document.createElement("div");
        figs.className = "output-figures";
        const img = document.createElement("img");
        img.src = "data:image/png;base64," + (Array.isArray(out.data["image/png"]) ? out.data["image/png"].join("") : out.data["image/png"]);
        figs.appendChild(img);
        content.appendChild(figs);
      }
    } else if (out.output_type === "error") {
      gutter.textContent = "";
      const pre = document.createElement("pre");
      pre.className = "output-error";
      pre.textContent = Array.isArray(out.traceback) ? out.traceback.join("\n") : String(out.evalue || out.traceback || "Error");
      content.appendChild(pre);
    }

    row.appendChild(gutter);
    row.appendChild(content);
    container.appendChild(row);
  }
}

function clearCellOutputs(cellId) {
  const cell = getCell(cellId);
  if (!cell) return;
  cell.outputs = [];
  renderCellOutputs(cell);
  debounceSave();
}

function clearAllOutputs() {
  state.cells.forEach(c => {
    c.outputs = [];
    c.executionCount = null;
    if (c.gutterElement && c.type === "code") {
      c.gutterElement.textContent = "In [ ]:";
    }
    renderCellOutputs(c);
  });
  debounceSave();
}

/* ------------------------------------------------------------------ *
 * Execution Engine
 * ------------------------------------------------------------------ */
let promptLine = 0;
function createPromptReader() {
  return () => {
    const val = window.prompt(`Python input() [line ${++promptLine}]:`);
    return val === null ? null : val + "\n";
  };
}

async function runCell(cellId) {
  const cell = getCell(cellId);
  if (!cell) return;

  if (cell.type === "markdown") {
    renderMarkdownCell(cellId);
    return;
  }

  const code = cell.editor ? cell.editor.getValue() : cell.source;
  if (!code.trim()) return;

  const count = ++state.executionCounter;
  cell.executionCount = count;
  cell.gutterElement.textContent = "In [*]:";
  cell.element.classList.add("running");
  setKernelStatus(`Running In [${count}]…`, "busy");

  cell.outputs = [];
  renderCellOutputs(cell);

  const decOut = new TextDecoder();
  const decErr = new TextDecoder();

  const appendStream = (text, name = "stdout") => {
    let lastOut = cell.outputs[cell.outputs.length - 1];
    if (lastOut && lastOut.output_type === "stream" && lastOut.name === name) {
      if (Array.isArray(lastOut.text)) lastOut.text.push(text);
      else lastOut.text += text;
    } else {
      cell.outputs.push({
        output_type: "stream",
        name,
        text: [text],
      });
    }
    renderCellOutputs(cell);
  };

  try {
    const py = await bootPyodide();

    py.setStdout({
      write: (buf) => {
        appendStream(decOut.decode(buf, { stream: true }), "stdout");
        return buf.length;
      },
    });

    py.setStderr({
      write: (buf) => {
        appendStream(decErr.decode(buf, { stream: true }), "stderr");
        return buf.length;
      },
    });

    py.setStdin({ stdin: createPromptReader() });

    // Ensure user globals namespace exists
    py.runPython("if '_jupyter_user_ns' not in globals(): _jupyter_user_ns = {}");

    let result = null;
    let hasExpr = false;
    const autoInstalled = new Set();

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        py.globals.set("_cell_code", code);
        const res = await py.runPythonAsync("_pyodide_jupyter_run(_cell_code, _jupyter_user_ns)");
        if (res) {
          result = res.get(0);
          hasExpr = Boolean(res.get(1));
          if (res.destroy) res.destroy();
        }
        break;
      } catch (err) {
        const tb = cleanTraceback(err);
        const match = /ModuleNotFoundError: No module named '([^']+)'/.exec(tb);
        if (match && state.autoInstall && !autoInstalled.has(match[1])) {
          const mod = match[1];
          autoInstalled.add(mod);
          appendStream(`[autoinstall] Downloading package: ${mod}…\n`, "stderr");
          await pipInstall([mod]);
          appendStream(`[autoinstall] Successfully installed ${mod}\n`, "stdout");
          continue;
        }
        throw err;
      }
    }

    // Format return value if expression was evaluated
    if (hasExpr && result !== undefined && result !== null) {
      let reprText = "";
      try {
        py.globals.set("_temp_val", result);
        reprText = py.runPython("repr(_temp_val)");
      } catch (_) {
        reprText = String(result);
      }

      if (reprText && reprText !== "None") {
        cell.outputs.push({
          output_type: "execute_result",
          execution_count: count,
          data: {
            "text/plain": reprText,
          },
          metadata: {},
        });
      }
    }

    // Check for matplotlib figures
    const figs = py.runPython("_pyodide_jupyter_figs()");
    if (figs) {
      const arr = figs.toJs ? figs.toJs() : figs;
      for (const b64 of arr) {
        cell.outputs.push({
          output_type: "display_data",
          data: {
            "image/png": b64,
          },
          metadata: {},
        });
      }
      if (figs.destroy) figs.destroy();
    }

    renderCellOutputs(cell);
    cell.gutterElement.textContent = `In [${count}]:`;
    setKernelStatus("Pyodide Ready", "ok");
  } catch (err) {
    const tb = cleanTraceback(err);
    cell.outputs.push({
      output_type: "error",
      ename: "Error",
      evalue: tb,
      traceback: [tb],
    });
    renderCellOutputs(cell);
    cell.gutterElement.textContent = `In [${count}]:`;
    setKernelStatus("Error in cell", "error");
  } finally {
    cell.element.classList.remove("running");
    debounceSave();
  }
}

async function runCellAndAdvance(cellId) {
  await runCell(cellId);
  const idx = getCellIndex(cellId);
  if (idx < state.cells.length - 1) {
    const next = state.cells[idx + 1];
    setActiveCell(next.id);
    if (next.type === "code" && next.editor) {
      next.editor.focus();
    }
  } else {
    // If running last cell, create a new code cell below
    insertCellBelow(cellId, "code");
  }
}

async function runAllCells() {
  setKernelStatus("Running all cells…", "busy");
  for (const cell of state.cells) {
    if (cell.type === "code") {
      setActiveCell(cell.id);
      await runCell(cell.id);
    }
  }
  setKernelStatus("Pyodide Ready", "ok");
}

/* ------------------------------------------------------------------ *
 * Notebook Rendering & IO (.ipynb)
 * ------------------------------------------------------------------ */
function renderNotebook() {
  els.notebook.innerHTML = "";
  for (const cell of state.cells) {
    const frag = renderCellElement(cell);
    els.notebook.appendChild(frag);
    mountCellEditor(cell);
  }
  updateCellCounts();
}

function exportIpynb() {
  const ipynb = {
    cells: state.cells.map(c => {
      const sourceLines = (c.editor ? c.editor.getValue() : c.source).split("\n").map((line, i, arr) => {
        return i === arr.length - 1 ? line : line + "\n";
      });

      if (c.type === "markdown") {
        return {
          cell_type: "markdown",
          metadata: {},
          source: sourceLines,
        };
      }

      return {
        cell_type: "code",
        execution_count: c.executionCount,
        metadata: {},
        outputs: c.outputs || [],
        source: sourceLines,
      };
    }),
    metadata: {
      language_info: {
        name: "python",
        version: "3.13",
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };

  const jsonStr = JSON.stringify(ipynb, null, 1);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = els.title.value.trim() || "notebook.ipynb";
  a.click();
  URL.revokeObjectURL(url);
}

function importIpynb(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.cells || !Array.isArray(data.cells)) {
        alert("Invalid notebook format: 'cells' list not found.");
        return;
      }

      // Cleanup existing editors
      state.cells.forEach(c => c.editor && c.editor.destroy());

      state.title = file.name || "imported.ipynb";
      els.title.value = state.title;

      state.cells = data.cells.map((rawCell, i) => {
        const sourceText = Array.isArray(rawCell.source) ? rawCell.source.join("") : (rawCell.source || "");
        return {
          id: "cell-" + Date.now() + "-" + i,
          type: rawCell.cell_type === "markdown" ? "markdown" : "code",
          source: sourceText,
          executionCount: rawCell.execution_count || null,
          outputs: rawCell.outputs || [],
          editing: false,
          editor: null,
        };
      });

      renderNotebook();
      if (state.cells.length > 0) setActiveCell(state.cells[0].id);
      debounceSave();
      setKernelStatus("Notebook loaded", "ok");
    } catch (err) {
      alert("Error reading .ipynb file: " + err.message);
    }
  };
  reader.readAsText(file);
}

/* ------------------------------------------------------------------ *
 * Persistence (localStorage)
 * ------------------------------------------------------------------ */
let saveTimer = null;
function debounceSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const payload = {
        title: els.title.value,
        autoInstall: els.autoInstall.checked,
        cells: state.cells.map(c => ({
          id: c.id,
          type: c.type,
          source: c.editor ? c.editor.getValue() : c.source,
          executionCount: c.executionCount,
          outputs: c.outputs,
        })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (_) {}
  }, 400);
}

function restoreNotebook() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch (_) {}

  if (saved && Array.isArray(saved.cells) && saved.cells.length > 0) {
    if (saved.title) {
      state.title = saved.title;
      els.title.value = saved.title;
    }
    if (saved.autoInstall !== undefined) {
      els.autoInstall.checked = saved.autoInstall;
    }
    state.cells = saved.cells.map(c => ({
      ...c,
      editing: false,
      editor: null,
    }));
    return;
  }

  // Preloaded Starter Notebook
  state.cells = [
    {
      id: "cell-1",
      type: "markdown",
      source: `# Pyodide Jupyter Notebook\n\nA full client-side Jupyter notebook environment running **Python 3.13** via **Pyodide** and WebAssembly. No servers, no installation.\n\n### Keyboard Shortcuts\n| Action | Shortcut |\n| :--- | :--- |\n| Run Cell & Advance | <kbd>Shift</kbd> + <kbd>Enter</kbd> |\n| Run Cell in Place | <kbd>Ctrl</kbd> + <kbd>Enter</kbd> |\n| Run & Insert Below | <kbd>Alt</kbd> + <kbd>Enter</kbd> |\n| Command Mode | <kbd>Esc</kbd> |\n| Toggle Comments | <kbd>Ctrl</kbd> + <kbd>/</kbd> |`,
      executionCount: null,
      outputs: [],
      editing: false,
      editor: null,
    },
    {
      id: "cell-2",
      type: "code",
      source: `import sys, platform\n\nprint("Python version:", sys.version.split()[0])\nprint("Architecture:  ", platform.machine() or "wasm32")\nprint("Platform:      ", platform.platform())`,
      executionCount: null,
      outputs: [],
      editing: false,
      editor: null,
    },
    {
      id: "cell-3",
      type: "code",
      source: `# Variables and expressions\n# The value of the last expression in a cell displays automatically (Out [n])\n\nsquares = [n**2 for n in range(1, 11)]\nprint("List of squares computed:")\nsquares`,
      executionCount: null,
      outputs: [],
      editing: false,
      editor: null,
    },
    {
      id: "cell-4",
      type: "markdown",
      source: `## Data Visualization with Matplotlib\n\nMatplotlib figures are automatically captured and rendered directly inside the notebook output area!`,
      executionCount: null,
      outputs: [],
      editing: false,
      editor: null,
    },
    {
      id: "cell-5",
      type: "code",
      source: `import numpy as np\nimport matplotlib.pyplot as plt\n\nx = np.linspace(0, 4 * np.pi, 300)\ny1 = np.sin(x)\ny2 = np.cos(x)\n\nfig, ax = plt.subplots(figsize=(7, 3), dpi=120)\nax.plot(x, y1, label="sin(x)", color="#0078d4", linewidth=2)\nax.plot(x, y2, label="cos(x)", color="#e36209", linewidth=2, linestyle="--")\nax.set_title("Trigonometric Functions in Pyodide", fontsize=11)\nax.grid(True, alpha=0.3)\nax.legend()\nplt.show()`,
      executionCount: null,
      outputs: [],
      editing: false,
      editor: null,
    },
    {
      id: "cell-6",
      type: "markdown",
      source: `## Persistent Kernel State\n\nVariables defined in earlier cells persist across runs. For example, we can access the \`squares\` variable defined above:`,
      executionCount: null,
      outputs: [],
      editing: false,
      editor: null,
    },
    {
      id: "cell-7",
      type: "code",
      source: `total = sum(squares)\naverage = total / len(squares)\n\nprint(f"Total sum: {total}")\nprint(f"Average:   {average:.2f}")\n\n{"total": total, "average": round(average, 2)}`,
      executionCount: null,
      outputs: [],
      editing: false,
      editor: null,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Initialization
 * ------------------------------------------------------------------ */
function init() {
  restoreNotebook();
  renderNotebook();

  if (state.cells.length > 0) {
    setActiveCell(state.cells[0].id);
  }

  // Header toolbar
  els.btnAddCode.onclick = () => insertCellBelow(state.activeCellId, "code");
  els.btnAddMd.onclick = () => insertCellBelow(state.activeCellId, "markdown");
  els.bottomAddCode.onclick = () => insertCellBelow(null, "code");
  els.bottomAddMd.onclick = () => insertCellBelow(null, "markdown");

  els.btnRun.onclick = () => {
    if (state.activeCellId) runCellAndAdvance(state.activeCellId);
  };
  els.btnRunAll.onclick = runAllCells;

  els.btnRestart.onclick = () => {
    state.pyodide = null;
    state.booting = null;
    state.executionCounter = 0;
    setKernelStatus("Kernel restarted", "ok");
    setTimeout(() => setKernelStatus("Pyodide Idle", ""), 1500);
  };

  els.btnClearAll.onclick = clearAllOutputs;

  els.btnExport.onclick = exportIpynb;

  els.btnOpen.onclick = () => els.fileInput.click();
  els.fileInput.onchange = (e) => {
    if (e.target.files && e.target.files[0]) {
      importIpynb(e.target.files[0]);
    }
  };

  // Drag and drop .ipynb file onto notebook
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith(".ipynb") || file.name.endsWith(".json")) {
        importIpynb(file);
      }
    }
  });

  // Package popover
  els.installOpen.onclick = () => {
    els.installPop.hidden = !els.installPop.hidden;
    if (!els.installPop.hidden) {
      els.pipPkg.focus();
      els.pipPkg.select();
    }
  };

  els.pipInstall.onclick = async () => {
    const pkgs = els.pipPkg.value.split(/[\s,]+/).filter(Boolean);
    if (!pkgs.length) { els.pipPkg.focus(); return; }
    try {
      await pipInstall(pkgs);
      els.installPop.hidden = true;
    } catch (err) {
      alert("Installation error: " + err.message);
    }
  };

  els.pipPkg.onkeydown = (e) => {
    if (e.key === "Enter") els.pipInstall.click();
  };

  document.addEventListener("pointerdown", (e) => {
    if (els.installPop.hidden) return;
    if (els.installPop.contains(e.target) || els.installOpen.contains(e.target)) return;
    els.installPop.hidden = true;
  });

  els.title.oninput = debounceSave;
  els.autoInstall.onchange = debounceSave;

  // Global notebook shortcuts in command mode
  document.addEventListener("keydown", (e) => {
    if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA" ||
        document.activeElement.classList.contains("cm-content")) {
      return;
    }

    if (e.key === "a" || e.key === "A") {
      e.preventDefault();
      const idx = state.activeCellId ? getCellIndex(state.activeCellId) : 0;
      const targetId = idx > 0 ? state.cells[idx - 1].id : null;
      insertCellBelow(targetId, "code");
    } else if (e.key === "b" || e.key === "B") {
      e.preventDefault();
      insertCellBelow(state.activeCellId, "code");
    } else if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      if (state.activeCellId) switchCellType(state.activeCellId, "markdown");
    } else if (e.key === "y" || e.key === "Y") {
      e.preventDefault();
      if (state.activeCellId) switchCellType(state.activeCellId, "code");
    } else if (e.key === "d" && e.repeat === false) {
      // Double d to delete
      if (window.__dPressed) {
        clearTimeout(window.__dPressedTimer);
        window.__dPressed = false;
        if (state.activeCellId) deleteCell(state.activeCellId);
      } else {
        window.__dPressed = true;
        window.__dPressedTimer = setTimeout(() => { window.__dPressed = false; }, 400);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cell = getCell(state.activeCellId);
      if (cell) {
        if (cell.type === "markdown") editMarkdownCell(cell.id);
        else if (cell.editor) cell.editor.focus();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const idx = getCellIndex(state.activeCellId);
      if (idx > 0) {
        setActiveCell(state.cells[idx - 1].id);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const idx = getCellIndex(state.activeCellId);
      if (idx >= 0 && idx < state.cells.length - 1) {
        setActiveCell(state.cells[idx + 1].id);
      }
    }
  });

  // Pre-boot Pyodide quietly in the background
  bootPyodide().catch(() => {});
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
