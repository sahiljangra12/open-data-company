# Third-party code shipped with the site

Loaded only when a visitor opens a file that needs it, or turns on the on-device model in the chat app. Only `web-llm.js` makes network requests: it downloads the model the visitor chose from Hugging Face and its WebGPU program from GitHub.

| File | What | Version | Licence | Where it came from |
|---|---|---|---|---|
| `xlsx.full.min.js` | SheetJS Community Edition: reads Excel, OpenDocument, Numbers, dBase and Lotus files | 0.20.3 | Apache-2.0 (`xlsx.LICENSE`) | `dist/` of the npm package `@e965/xlsx@0.20.3`, a republish of the official SheetJS build (SheetJS no longer publishes to npm) |
| `xlsx.mini.min.js` | The same library, write-only subset used by the explorer's Excel download | 0.20.3 | Apache-2.0 | same package |
| `hyparquet.min.js` | Reads Parquet files, with the common compression codecs | hyparquet 1.33.1, hyparquet-compressors 1.1.3 | MIT (`hyparquet.LICENSE`) | bundled from npm with esbuild: `esbuild entry.js --bundle --format=esm --minify`, where `entry.js` re-exports `parquetReadObjects` and `compressors` |
| `web-llm.js` | WebLLM: runs an open language model in the browser on WebGPU, for the on-device brain of the chat app (`assets/brain-local.js`) | 0.2.89 | Apache-2.0 (`web-llm.LICENSE`) | `lib/index.js` of the npm package `@mlc-ai/web-llm@0.2.89`, minified with `esbuild --minify --format=esm` |

SPSS, Stata, CSV and JSON files are read by the site's own code in `docs/assets/readers.js`.
