import { lineNumbers, highlightActiveLine, highlightActiveLineGutter, EditorView, keymap } from '@codemirror/view';
import { history } from '@codemirror/commands';
import { indentOnInput, bracketMatching } from '@codemirror/language';
import { closeBrackets } from '@codemirror/autocomplete';

export const minimalSetup = [
  lineNumbers(),
  highlightActiveLineGutter(),
  history(),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  highlightActiveLine(),
  keymap.of([]),
];
