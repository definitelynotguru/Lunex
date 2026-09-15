import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { createRuntime } from '../lua';
import { DEMOS } from './demos';
import { renderAst, renderLocals } from './ast-view';
import { readInitialCode, writeShareUrl } from './share';

const editorEl = document.getElementById('editor')!;
const consoleEl = document.getElementById('console')!;
const inspectorEl = document.getElementById('inspector')!;
const statusLeft = document.getElementById('statusLeft')!;
const demoSelect = document.getElementById('demoSelect') as HTMLSelectElement;
const btnRun = document.getElementById('btnRun') as HTMLButtonElement;
const btnStep = document.getElementById('btnStep') as HTMLButtonElement;
const btnContinue = document.getElementById('btnContinue') as HTMLButtonElement;
const btnClear = document.getElementById('btnClear') as HTMLButtonElement;
const btnShare = document.getElementById('btnShare') as HTMLButtonElement;

let inspectMode: 'ast' | 'bc' | 'locals' = 'ast';
let lastAst: unknown = null;
let lastDisasm = '';
let lastLocals: Record<string, unknown> = {};
let stepResolver: (() => void) | null = null;
let stepping = false;

for (const d of DEMOS) {
  const opt = document.createElement('option');
  opt.value = d.id;
  opt.textContent = d.name;
  demoSelect.appendChild(opt);
}

const initial = readInitialCode() ?? DEMOS[0].code;

const view = new EditorView({
  parent: editorEl,
  state: EditorState.create({
    doc: initial,
    extensions: [
      basicSetup,
      history(),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        {
          key: 'Mod-Enter',
          run: () => {
            void runCode(false);
            return true;
          },
        },
      ]),
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto' },
      }),
    ],
  }),
});

function appendConsole(text: string, cls = '') {
  const line = document.createElement('div');
  line.className = 'line' + (cls ? ' ' + cls : '');
  line.textContent = text;
  consoleEl.appendChild(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function refreshInspector() {
  if (inspectMode === 'ast') {
    inspectorEl.innerHTML = lastAst ? renderAst(lastAst) : '<span class="hint">Run to see AST.</span>';
  } else if (inspectMode === 'bc') {
    inspectorEl.textContent = lastDisasm || 'Run to see bytecode.';
  } else {
    inspectorEl.innerHTML = renderLocals(lastLocals);
  }
}

document.getElementById('inspectTabs')!.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.tagName !== 'BUTTON') return;
  inspectMode = t.dataset.insp as typeof inspectMode;
  for (const b of document.querySelectorAll('#inspectTabs button')) b.classList.toggle('active', b === t);
  refreshInspector();
});

demoSelect.addEventListener('change', () => {
  const demo = DEMOS.find((d) => d.id === demoSelect.value);
  if (!demo) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: demo.code } });
});

btnClear.addEventListener('click', () => {
  consoleEl.innerHTML = '';
});

btnShare.addEventListener('click', async () => {
  const url = writeShareUrl(view.state.doc.toString());
  try {
    await navigator.clipboard.writeText(url);
    statusLeft.textContent = 'Share URL copied';
  } catch {
    statusLeft.textContent = 'Share URL in address bar';
  }
});

function makeRuntime(stepMode: boolean) {
  return createRuntime({
    sink: {
      print: (t) => appendConsole(t),
      write: (t) => {
        const last = consoleEl.lastElementChild as HTMLElement | null;
        if (last && last.dataset.io === '1') last.textContent = (last.textContent || '') + t;
        else {
          const line = document.createElement('div');
          line.className = 'line';
          line.dataset.io = '1';
          line.textContent = t;
          consoleEl.appendChild(line);
        }
      },
    },
    hooks: {
      stepMode,
      onStatement: (info) => {
        lastLocals = info.locals as Record<string, unknown>;
        if (inspectMode === 'locals') refreshInspector();
        statusLeft.textContent = `pc line ${info.line ?? '?'} · stepped`;
      },
    },
  });
}

async function runCode(stepMode: boolean) {
  stepping = stepMode;
  btnContinue.disabled = !stepMode;
  const source = view.state.doc.toString();
  statusLeft.textContent = stepMode ? 'Stepping…' : 'Running…';
  const rt = makeRuntime(stepMode);
  if (stepMode) {
    rt.setStepGate(
      () =>
        new Promise<void>((resolve) => {
          stepResolver = resolve;
        }),
    );
  }
  try {
    const result = await rt.run(source);
    lastAst = result.ast;
    lastDisasm = result.disasm;
    lastLocals = rt.vm.lastLocals as Record<string, unknown>;
    refreshInspector();
    statusLeft.textContent = `Done · ${result.proto.code.length} ops · line ${rt.vm.lastLine || '—'}`;
    appendConsole('— ok —', 'meta');
  } catch (e: any) {
    appendConsole(String(e?.message || e), 'err');
    statusLeft.textContent = 'Error';
    try {
      const compiled = rt.compile(source);
      lastAst = compiled.ast;
      lastDisasm = compiled.disasm;
      refreshInspector();
    } catch {
      /* parse error already shown */
    }
  } finally {
    stepping = false;
    btnContinue.disabled = true;
    stepResolver = null;
  }
}

btnRun.addEventListener('click', () => void runCode(false));
btnStep.addEventListener('click', () => {
  if (stepResolver) {
    stepResolver();
    stepResolver = null;
  } else void runCode(true);
});
btnContinue.addEventListener('click', () => {
  // disable step gate for rest of run
  if (stepResolver) {
    // drain by resolving and turning off step mode is hard mid-flight;
    // resolve current and keep resolving via auto
    const id = setInterval(() => {
      if (stepResolver) {
        stepResolver();
        stepResolver = null;
      } else clearInterval(id);
    }, 0);
  }
});

refreshInspector();
statusLeft.textContent = 'Ready · Lua 5.2–oriented register VM';
