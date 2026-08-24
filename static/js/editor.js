// ============ Monaco 编辑器 ============
// 硬性要求：Monaco Editor + Consolas 字体 + 回车自动缩进(autoIndent: 'full')
let editor = null;
let monacoReady = null;

const DEFAULT_CODE = `#include<bits/stdc++.h>
using namespace std;

int main()
{
    
    return 0;
}`;

function loadMonaco() {
  if (monacoReady) return monacoReady;
  monacoReady = new Promise((resolve, reject) => {
    if (typeof require === 'undefined') {
      reject(new Error('Monaco 加载失败：请检查网络（CDN 不可达）'));
      return;
    }
    require.config({
      paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.43.0/min/vs' },
    });
    require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
  });
  return monacoReady;
}

// 在指定容器里创建编辑器（页面切换时旧编辑器会被 dispose）
async function createEditor(container) {
  const monaco = await loadMonaco();
  if (editor) editor.dispose();
  editor = monaco.editor.create(container, {
    value: DEFAULT_CODE,
    language: 'cpp',
    theme: 'vs-dark',
    // ↓↓↓ 硬性要求三连 ↓↓↓
    fontFamily: 'Consolas',
    autoIndent: 'full',
    // ↓↓↓ 顺手加的舒适配置 ↓↓↓
    fontSize: 15,
    lineHeight: 22,
    tabSize: 4,
    insertSpaces: true,
    minimap: { enabled: false },
    automaticLayout: true,
    scrollBeyondLastLine: false,
    renderLineHighlight: 'all',
    roundedSelection: true,
    contextmenu: true,
  });
  return editor;
}

function disposeEditor() {
  if (editor) { editor.dispose(); editor = null; }
}

function getEditorCode() {
  return editor ? editor.getValue() : '';
}

function setEditorCode(code) {
  if (editor) editor.setValue(code);
}