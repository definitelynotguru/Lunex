import { Assembler, CPU } from './cpu-core.js';
import { DEMOS } from './demos.js';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';

const REG_NAMES = ['A', 'B', 'C', 'D', 'SP', 'PC'] as const;

const editorHost = document.getElementById('editor')!;
const regsEl = document.getElementById('regs')!;
const flagsEl = document.getElementById('flags')!;
const memEl = document.getElementById('mem')!;
const outEl = document.getElementById('output')!;
const statusEl = document.getElementById('statusLeft')!;
const demoSelect = document.getElementById('demoSelect') as HTMLSelectElement;
const speedSelect = document.getElementById('speed') as HTMLSelectElement;

const cpu = new CPU();
const assembler = new Assembler();
let running = false;
let timer: number | null = null;
const breakpoints = new Set<number>(); // addresses
let skipBpOnce: number | undefined;

const keys = Object.keys(DEMOS);
for (const key of keys) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = key.replace(/_/g, ' ');
  demoSelect.appendChild(opt);
}

const view = new EditorView({
  parent: editorHost,
  state: EditorState.create({
    doc: DEMOS[keys[0]],
    extensions: [
      basicSetup,
      keymap.of([
        ...defaultKeymap,
        {
          key: 'Mod-Enter',
          run: () => {
            assemble();
            return true;
          },
        },
        {
          key: 'Mod-.',
          run: () => {
            step();
            return true;
          },
        },
        {
          key: 'Mod-r',
          run: () => {
            toggleRun();
            return true;
          },
        },
      ]),
      EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
    ],
  }),
});

demoSelect.addEventListener('change', () => {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: DEMOS[demoSelect.value] } });
});

function hex2(n: number) {
  return (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

function updateUI() {
  regsEl.innerHTML = REG_NAMES.map((name, i) => {
    const n = cpu.readRegister(i);
    return `<div class="reg"><span>${name}</span><strong>0x${hex2(n)}</strong><small>${n.toString(2).padStart(8, '0')}</small></div>`;
  }).join('');

  flagsEl.innerHTML = [cpu.FLAG_Z, cpu.FLAG_C, cpu.FLAG_N, cpu.FLAG_V]
    .map((f, bit) => `<span class="flag ${cpu.getFlag(bit) ? 'on' : ''}">${f}</span>`)
    .join('');

  const pc = cpu.readRegister(cpu.REG_PC);
  let html = '';
  for (let row = 0; row < 16; row++) {
    const base = row * 16;
    const bytes = [];
    for (let col = 0; col < 16; col++) {
      const addr = base + col;
      const cls = [addr === pc ? 'pc' : '', breakpoints.has(addr) ? 'bp' : ''].filter(Boolean).join(' ');
      bytes.push(`<span class="${cls}" data-addr="${addr}">${hex2(cpu.memory[addr])}</span>`);
    }
    html += `<div><code>${hex2(base)}</code> ${bytes.join(' ')}</div>`;
  }
  memEl.innerHTML = html;
  outEl.textContent = (cpu.output || []).join('');
  const state = cpu.state;
  statusEl.textContent = `${state} · PC=0x${hex2(pc)} · ticks=${cpu.ticks ?? 0}`;
}

function assemble() {
  stop();
  const source = view.state.doc.toString();
  const result = assembler.assemble(source);
  if (result.errors?.length || !result.bytes) {
    const err = result.errors?.[0];
    statusEl.textContent = err ? `Assemble error line ${err.line}: ${err.message}` : 'Assemble failed';
    outEl.textContent = (result.errors || []).map((e: any) => `L${e.line}: ${e.message}`).join('\n');
    return;
  }
  cpu.loadProgram(result.bytes, result.lineMap);
  statusEl.textContent = `Assembled ${result.bytes.length} bytes`;
  updateUI();
}

function step() {
  if (cpu.state === 'halted' || cpu.state === 'error') return;
  cpu.step();
  updateUI();
}

function toggleRun() {
  if (running) stop();
  else start();
}

function start() {
  if (cpu.state === 'halted' || cpu.state === 'error') return;
  running = true;
  const hz = Number(speedSelect.value) || 10;
  timer = window.setInterval(() => {
    if (cpu.state === 'halted' || cpu.state === 'error') {
      stop();
      return;
    }
    const pc = cpu.readRegister(cpu.REG_PC);
    if (breakpoints.has(pc) && skipBpOnce !== pc) {
      stop();
      return;
    }
    skipBpOnce = undefined;
    cpu.step();
    updateUI();
  }, Math.max(1, Math.floor(1000 / hz)));
  updateUI();
}

function stop() {
  running = false;
  if (timer != null) clearInterval(timer);
  timer = null;
  updateUI();
}

function reset() {
  stop();
  cpu.fullReset();
  updateUI();
}

memEl.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (!t.dataset.addr) return;
  const addr = Number(t.dataset.addr);
  if (breakpoints.has(addr)) breakpoints.delete(addr);
  else breakpoints.add(addr);
  // resume past bp: mark skip
  skipBpOnce = addr;
  updateUI();
});

document.getElementById('btnAssemble')!.addEventListener('click', assemble);
document.getElementById('btnRun')!.addEventListener('click', toggleRun);
document.getElementById('btnStep')!.addEventListener('click', step);
document.getElementById('btnReset')!.addEventListener('click', reset);

updateUI();
