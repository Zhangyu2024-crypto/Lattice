# BusyTeX vendored assets

Origin: https://github.com/busytex/busytex
License: MIT (see upstream README)
Release tag: `build_wasm_4499aa69fd3cf77ad86a47287d9a5193cf5ad993_7936974349_1`

Assets are loaded at runtime by `src/lib/latex/busytex-runner.ts`. Path at
runtime (both dev and packaged Electron) is `/busytex/<file>`.

### Re-vendoring

```
BASE=https://github.com/busytex/busytex/releases/download/<TAG>
# Plus each .wasm / .data / .js listed above.
```
