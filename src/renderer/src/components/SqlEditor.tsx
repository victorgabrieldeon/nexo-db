import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorState, Compartment, StateEffect, StateField, RangeSetBuilder, Prec, type Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
  placeholder as placeholderExt,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from '@codemirror/commands'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle, LanguageSupport } from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { PostgreSQL } from '@codemirror/lang-sql'
import { tags as t } from '@lezer/highlight'
import type { CompletionSchema } from '@shared/types'
import { completionExtension } from '@/lib/completion'
import { statementAt, type Statement } from '@/lib/sqlSplit'

export interface RunTarget extends Statement {
  isSelection: boolean
}

export interface SqlEditorHandle {
  getRunTarget: () => RunTarget | null
  getValue: () => string
  focus: () => void
  markError: (from: number, to: number) => void
  flash: (from: number, to: number) => void
  insert: (text: string) => void
}

interface Props {
  value: string
  onChange?: (v: string) => void
  completion?: CompletionSchema | null
  readOnly?: boolean
  onRun?: () => void
  onRunScript?: () => void
  onExplain?: () => void
  placeholder?: string
  highlightStatement?: boolean
  lineNumbersOn?: boolean
}

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: '#7aa2ff', fontWeight: '500' },
  { tag: [t.string, t.special(t.string)], color: '#9ece6a' },
  { tag: [t.number, t.bool, t.null], color: '#ff9e64' },
  { tag: [t.lineComment, t.blockComment, t.comment], color: '#5b6273', fontStyle: 'italic' },
  { tag: [t.typeName, t.standard(t.name)], color: '#5ccfe6' },
  { tag: [t.function(t.name), t.function(t.variableName)], color: '#bb9af7' },
  { tag: [t.operator, t.punctuation, t.paren, t.squareBracket, t.brace], color: '#89ddff' },
  { tag: t.special(t.name), color: '#e0af68' },
  { tag: [t.variableName, t.name, t.propertyName], color: '#e4e7ee' },
  { tag: t.labelName, color: '#f7768e' }
])

const theme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: '#e4e7ee' },
    '.cm-content': { caretColor: '#6d8cff', padding: '10px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#6d8cff', borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
      { backgroundColor: '#6d8cff38 !important' },
    '.cm-gutters': { backgroundColor: 'transparent', color: '#3d4350', border: 'none', paddingLeft: '6px' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 8px', minWidth: '34px' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#8b93a7' },
    '.cm-activeLine': { backgroundColor: '#ffffff05' },
    '.cm-matchingBracket': { backgroundColor: '#6d8cff30', outline: 'none', color: 'inherit !important' },
    '.cm-selectionMatch': { backgroundColor: '#ffffff12' },
    '.cm-searchMatch': { backgroundColor: '#f5b84a40', outline: '1px solid #f5b84a80' },
    '.cm-placeholder': { color: '#4b5262', fontStyle: 'italic' },
    '.cm-panels': { backgroundColor: '#11141b', color: '#e4e7ee', borderColor: '#1d222c' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid #1d222c' },
    '.cm-panel.cm-search': { padding: '6px 10px', fontFamily: 'var(--font-sans)' },
    '.cm-panel.cm-search input, .cm-panel.cm-search button': { borderRadius: '6px', fontSize: '12px' },
    '.cm-textfield': { backgroundColor: '#0b0d12', border: '1px solid #2a303c', color: '#e4e7ee' },
    '.cm-button': { backgroundImage: 'none', backgroundColor: '#1b2029', border: '1px solid #2a303c', color: '#e4e7ee' }
  },
  { dark: true }
)

// ── marca de erro ──
const setErrorEffect = StateEffect.define<{ from: number; to: number } | null>()
const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setErrorEffect)) {
        return e.value && e.value.to > e.value.from
          ? Decoration.set([Decoration.mark({ class: 'cm-error-mark' }).range(e.value.from, e.value.to)])
          : Decoration.none
      }
    }
    return tr.docChanged ? Decoration.none : deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f)
})

// ── flash ao executar ──
const flashEffect = StateEffect.define<{ from: number; to: number } | null>()
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(flashEffect)) {
        return e.value && e.value.to > e.value.from
          ? Decoration.set([Decoration.mark({ class: 'cm-run-flash' }).range(e.value.from, e.value.to)])
          : Decoration.none
      }
    }
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f)
})

// ── destaque do comando sob o cursor ──
const currentStatement = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.selectionSet || u.focusChanged) this.decorations = this.build(u.view)
    }
    build(view: EditorView): DecorationSet {
      const { state } = view
      const sel = state.selection.main
      if (!sel.empty || !view.hasFocus) return Decoration.none
      const doc = state.doc.toString()
      const stmt = statementAt(doc, sel.head)
      if (!stmt) return Decoration.none
      const b = new RangeSetBuilder<Decoration>()
      const startLine = state.doc.lineAt(stmt.from).number
      const endLine = state.doc.lineAt(stmt.to).number
      if (startLine === endLine && state.doc.lines === 1) return Decoration.none
      for (let l = startLine; l <= endLine; l++) {
        b.add(state.doc.line(l).from, state.doc.line(l).from, Decoration.line({ class: 'cm-current-stmt' }))
      }
      return b.finish()
    }
  },
  { decorations: (v) => v.decorations }
)

export const SqlEditor = forwardRef<SqlEditorHandle, Props>(function SqlEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const completionComp = useRef(new Compartment())
  const readOnlyComp = useRef(new Compartment())

  useEffect(() => {
    const runKeys = Prec.highest(
      keymap.of([
        { key: 'Mod-Enter', run: () => (propsRef.current.onRun?.(), true) },
        { key: 'Mod-Shift-Enter', run: () => (propsRef.current.onRunScript?.(), true) },
        { key: 'Alt-x', run: () => (propsRef.current.onRunScript?.(), true) },
        { key: 'Mod-Shift-e', run: () => (propsRef.current.onExplain?.(), true) },
        { key: 'Mod-/', run: toggleComment }
      ])
    )
    const extensions: Extension[] = [
      props.lineNumbersOn !== false ? [lineNumbers(), highlightActiveLineGutter()] : [],
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(highlight),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      autocompletion({ icons: true, activateOnTypingDelay: 40, maxRenderedOptions: 80, closeOnBlur: true }),
      runKeys,
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
      new LanguageSupport(PostgreSQL.language),
      completionComp.current.of(completionExtension(props.completion ?? null)),
      readOnlyComp.current.of([EditorState.readOnly.of(!!props.readOnly), EditorView.editable.of(!props.readOnly)]),
      errorField,
      flashField,
      props.highlightStatement !== false && !props.readOnly ? currentStatement : [],
      props.placeholder ? placeholderExt(props.placeholder) : [],
      EditorView.lineWrapping,
      theme,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) propsRef.current.onChange?.(u.state.doc.toString())
      })
    ]
    const view = new EditorView({ parent: host.current!, state: EditorState.create({ doc: props.value, extensions }) })
    viewRef.current = view
    return () => view.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: completionComp.current.reconfigure(completionExtension(props.completion ?? null)) })
  }, [props.completion])

  // valor controlado externamente (ex.: DDL carregado depois)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (props.value !== current && (props.readOnly || !view.hasFocus)) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: props.value } })
    }
  }, [props.value, props.readOnly])

  useImperativeHandle(ref, () => ({
    getRunTarget: () => {
      const view = viewRef.current
      if (!view) return null
      const sel = view.state.selection.main
      const doc = view.state.doc.toString()
      if (!sel.empty) {
        const text = doc.slice(sel.from, sel.to)
        const lead = text.length - text.trimStart().length
        return { from: sel.from + lead, to: sel.from + lead + text.trim().length, text: text.trim(), isSelection: true }
      }
      const stmt = statementAt(doc, sel.head)
      return stmt ? { ...stmt, isSelection: false } : null
    },
    getValue: () => viewRef.current?.state.doc.toString() ?? '',
    focus: () => viewRef.current?.focus(),
    markError: (from, to) => {
      const view = viewRef.current
      if (!view) return
      const len = view.state.doc.length
      const f = Math.max(0, Math.min(from, len))
      view.dispatch({
        effects: setErrorEffect.of({ from: f, to: Math.max(f, Math.min(to, len)) }),
        selection: { anchor: f },
        scrollIntoView: true
      })
    },
    flash: (from, to) => {
      const view = viewRef.current
      if (!view) return
      view.dispatch({ effects: [flashEffect.of({ from, to }), setErrorEffect.of(null)] })
      setTimeout(() => view.dispatch({ effects: flashEffect.of(null) }), 700)
    },
    insert: (text) => {
      const view = viewRef.current
      if (!view) return
      const sel = view.state.selection.main
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length } })
      view.focus()
    }
  }))

  return <div ref={host} className="h-full min-h-0 w-full overflow-hidden select-text" />
})
