declare module 'y-indexeddb' {
  import type * as Y from 'yjs'

  export class IndexeddbPersistence {
    whenSynced: Promise<void>
    constructor(name: string, doc: Y.Doc)
    destroy(): void | Promise<void>
  }
}

declare module 'y-codemirror.next' {
  import type { Extension } from '@codemirror/state'
  import type * as Y from 'yjs'
  import type { Awareness } from 'y-protocols/awareness'

  export function yCollab(
    ytext: Y.Text,
    awareness?: Awareness,
    options?: { undoManager?: Y.UndoManager },
  ): Extension
}
