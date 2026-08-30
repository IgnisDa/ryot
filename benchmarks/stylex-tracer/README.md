# StyleX tracer benchmark

Run from the repository root:

```sh
bun benchmarks/stylex-tracer/run.ts
```

The command compiles the production StyleX tracer and the equivalent benchmark-local Tailwind fixture through `compileClientPlugin` with graph `application: "page"` inputs. It writes machine-readable JSON and Markdown reports to `results/result.json` and `results/result.md`.

Each variant gets one uninstrumented fresh-process compilation. A separate warm process performs one discarded forced warmup per variant, then five measured rounds with alternating StyleX/Tailwind order. Direct compiler calls do not use the artifact cache. Separate opt-in compiler runs report only exact monotonic hook spans. Inclusive spans are labeled and are not additive with nested spans.

The runner also compares one and two builds through the kernel's configured `ClientPluginCompiler.layer` boundary. That boundary has a semaphore limit of two and starts one supervised Bun child per request; each compiler worker starts a `tsc` semantic-check child. Distinct uncached inputs prove overlap and CSS isolation. A 5 ms `ps` sampler records the orchestrator and observed descendants; summed RSS can double-count shared pages and can miss short peaks. macOS does not exercise the Linux `/proc` proportional-memory limit. `/usr/bin/time -l` fresh-process RSS is a process high-water mark, not an aggregate process-tree peak.

The runner separately reports raw and gzip JavaScript/CSS, compiler-owned fonts, the local SVG, summed generated artifact bytes, and a canonical source archive verified with `readPluginArchive`.

The report records Git HEAD, the requested baseline, lockfile hash, platform, activation setting, exact versions, graph-input file manifests, and a content manifest for every dirty or untracked file except the two self-generated reports. Its source-backed accounting inventory classifies permanent StyleX integration, experiment-only coexistence, general safeguards, removable in-scope Tailwind work, candidate UI, and disposable demonstration UI. Responsibility ranges can overlap and are not a net line-count score.

The direct dependency inventory reads exact installed versions from each owning package's `node_modules`, lists every declaring manifest, and checks that each exact version occurs in `bun.lock`.

This fixture is local evidence only. It does not flush filesystem caches, control thermal/background load, execute browser behavior, prove visual equivalence, or predict whole-application results. Current hooks do not separate all pipeline work; unresolved attribution is explicit in the report. The benchmark defines no performance or size threshold.
