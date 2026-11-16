# Shockwave

An entry for make.fun's bounty **ai-excited-01 — Make the AI judge excited**.

A shockwave tearing a ring of machinery apart from the inside. Every pixel is
computed in `main.ts`: no input files, no dependencies, no network. Standard
library only — `node:fs`, `node:zlib`, `node:path`.

## Run it

```bash
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts
```

The program writes `entry.png` into `MAKEFUN_OUTPUT_DIR` (default `/output`)
and prints a statistics block: byte size against the 1,048,576 limit, render
and encode timings, luminance and saturation summaries, and a determinism check.

## License

MIT — see [LICENSE](LICENSE).
