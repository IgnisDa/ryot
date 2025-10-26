#!/usr/bin/env bun
/**
 * Generates a self-contained HTML view of the app-backend module dependency DAG.
 * Usage:
 *   bun run apps/app-backend/scripts/module-dag.ts
 * Output:
 *   ./tmp/module-dag.html
 */

import { FileSystem, Path } from "@effect/platform";
import { BunFileSystem, BunPath, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";

type FileKind = "runtime" | "test";
type EdgeKind = "runtime" | "test";

type FileEntry = { path: string; kind: FileKind };

type Edge = { to: string; from: string; kind: EdgeKind };

const importPattern =
	/(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

const parseImportPaths = (content: string) => {
	const paths: string[] = [];
	let match: RegExpExecArray | null;

	importPattern.lastIndex = 0;
	while ((match = importPattern.exec(content)) !== null) {
		const path = match[1] ?? match[2];
		if (path) {
			paths.push(path);
		}
	}

	return paths;
};

const edgeKey = (from: string, to: string) => `${from}|${to}`;

const nodeIdFor = (name: string) => `module_${name.replace(/[^a-zA-Z0-9_]/g, "_")}`;

const walkTsFiles = (
	dir: string,
): Effect.Effect<FileEntry[], unknown, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const files: FileEntry[] = [];
		const fs = yield* FileSystem.FileSystem;
		const entries = (yield* fs.readDirectory(dir)).sort();

		for (const entry of entries) {
			const fullPath = path.join(dir, entry);
			const info = yield* fs.stat(fullPath);

			if (info.type === "Directory") {
				files.push(...(yield* walkTsFiles(fullPath)));
				continue;
			}

			if (!entry.endsWith(".ts") || entry.endsWith(".d.ts")) {
				continue;
			}

			files.push({ path: fullPath, kind: entry.endsWith(".test.ts") ? "test" : "runtime" });
		}

		return files;
	});

const getModuleNames = (modulesDir: string) =>
	Effect.gen(function* () {
		const modules: string[] = [];
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const entries = (yield* fs.readDirectory(modulesDir)).sort();

		for (const entry of entries) {
			const info = yield* fs.stat(path.join(modulesDir, entry));
			if (info.type === "Directory") {
				modules.push(entry);
			}
		}

		return modules;
	});

const resolveToModule = (
	sourceFile: string,
	importPath: string,
	modulesDir: string,
	moduleNames: ReadonlySet<string>,
	path: Path.Path,
) => {
	if (importPath.startsWith("#modules/")) {
		const aliasTarget = importPath.slice("#modules/".length).split("/")[0];
		return aliasTarget && moduleNames.has(aliasTarget) ? aliasTarget : null;
	}

	if (!importPath.startsWith(".")) {
		return null;
	}

	const absolutePath = path.resolve(path.dirname(sourceFile), importPath);
	const relativePath = path.relative(modulesDir, absolutePath);
	if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
		return null;
	}

	const [topSegment] = relativePath.split(path.sep);
	return topSegment && moduleNames.has(topSegment) ? topSegment : null;
};

const buildEdges = (modulesDir: string, moduleNames: string[]) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const knownModules = new Set(moduleNames);
		const edgeSources = new Map<string, Set<FileKind>>();

		for (const moduleName of moduleNames) {
			const moduleDir = path.join(modulesDir, moduleName);
			const files = yield* walkTsFiles(moduleDir);

			for (const file of files) {
				const content = yield* fs.readFileString(file.path);
				for (const importPath of parseImportPaths(content)) {
					const target = resolveToModule(file.path, importPath, modulesDir, knownModules, path);

					if (!target || target === moduleName) {
						continue;
					}

					const key = edgeKey(moduleName, target);
					const kinds = edgeSources.get(key) ?? new Set<FileKind>();
					kinds.add(file.kind);
					edgeSources.set(key, kinds);
				}
			}
		}

		return [...edgeSources.entries()]
			.map(([key, kinds]) => {
				const divider = key.indexOf("|");
				return {
					from: key.slice(0, divider),
					kind: kinds.has("runtime") ? "runtime" : "test",
					to: key.slice(divider + 1),
				} satisfies Edge;
			})
			.sort(
				(a, b) =>
					a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind),
			);
	});

const detectCycles = (moduleNames: string[], edges: Edge[]) => {
	type VisitState = "white" | "gray" | "black";

	const adjacency = new Map(moduleNames.map((moduleName) => [moduleName, [] as string[]]));
	for (const edge of edges) {
		if (edge.kind === "runtime") {
			adjacency.get(edge.from)?.push(edge.to);
		}
	}
	for (const neighbors of adjacency.values()) {
		neighbors.sort();
	}

	const stack: string[] = [];
	const cycles: string[][] = [];
	const seenCycles = new Set<string>();
	const cycleEdgeKeys = new Set<string>();
	const state = new Map<string, VisitState>(moduleNames.map((moduleName) => [moduleName, "white"]));

	const visit = (moduleName: string) => {
		state.set(moduleName, "gray");
		stack.push(moduleName);

		for (const dependency of adjacency.get(moduleName) ?? []) {
			const dependencyState = state.get(dependency);
			if (dependencyState === "gray") {
				const cycleStartIndex = stack.indexOf(dependency);
				const cycle = [...stack.slice(cycleStartIndex), dependency];
				const cycleId = cycle.join("|");

				if (!seenCycles.has(cycleId)) {
					seenCycles.add(cycleId);
					cycles.push(cycle);
				}

				for (let i = 0; i < cycle.length - 1; i += 1) {
					const from = cycle[i];
					const to = cycle[i + 1];
					if (from && to) {
						cycleEdgeKeys.add(edgeKey(from, to));
					}
				}
				continue;
			}

			if (dependencyState === "white") {
				visit(dependency);
			}
		}

		stack.pop();
		state.set(moduleName, "black");
	};

	for (const moduleName of moduleNames) {
		if (state.get(moduleName) === "white") {
			visit(moduleName);
		}
	}

	return { cycleEdgeKeys, cycles };
};

const computeSpecificityDepths = (moduleNames: string[], edges: Edge[]) => {
	const depths = new Map(moduleNames.map((moduleName) => [moduleName, 0]));
	const remainingDependencies = new Map(moduleNames.map((moduleName) => [moduleName, 0]));
	const dependents = new Map(moduleNames.map((moduleName) => [moduleName, [] as string[]]));

	for (const edge of edges) {
		if (edge.kind !== "runtime") {
			continue;
		}

		dependents.get(edge.to)?.push(edge.from);
		remainingDependencies.set(edge.from, (remainingDependencies.get(edge.from) ?? 0) + 1);
	}

	for (const directDependents of dependents.values()) {
		directDependents.sort();
	}

	const queue = moduleNames.filter(
		(moduleName) => (remainingDependencies.get(moduleName) ?? 0) === 0,
	);

	while (queue.length > 0) {
		const dependency = queue.shift();
		if (!dependency) {
			continue;
		}

		for (const dependent of dependents.get(dependency) ?? []) {
			const nextDepth = (depths.get(dependency) ?? 0) + 1;
			if (nextDepth > (depths.get(dependent) ?? 0)) {
				depths.set(dependent, nextDepth);
			}

			const nextRemaining = (remainingDependencies.get(dependent) ?? 0) - 1;
			remainingDependencies.set(dependent, nextRemaining);
			if (nextRemaining === 0) {
				queue.push(dependent);
			}
		}
	}

	return depths;
};

const nodeTier = (depth: number, maxDepth: number) => {
	if (depth === 0) {
		return "leaf";
	}

	if (depth === maxDepth) {
		return "top";
	}

	return "mid";
};

const generateMermaid = (moduleNames: string[], edges: Edge[], cycleEdgeKeys: Set<string>) => {
	const cycleNodes = new Set<string>();
	const depths = computeSpecificityDepths(moduleNames, edges);
	const maxDepth = Math.max(0, ...depths.values());

	for (const key of cycleEdgeKeys) {
		const divider = key.indexOf("|");
		cycleNodes.add(key.slice(0, divider));
		cycleNodes.add(key.slice(divider + 1));
	}

	const runtimeEdges = edges.filter((edge) => edge.kind === "runtime");
	const testEdges = edges.filter((edge) => edge.kind === "test");
	const orderedEdges = [...runtimeEdges, ...testEdges];
	const linkStyleIndexes: number[] = [];
	const lines = [
		"flowchart TD",
		"  classDef leaf fill:#e2e8f0,stroke:#94a3b8,color:#1e293b",
		"  classDef mid fill:#bfdbfe,stroke:#3b82f6,color:#1e3a8a",
		"  classDef top fill:#fed7aa,stroke:#ea580c,color:#7c2d12",
		"  classDef cycle fill:#fecaca,stroke:#dc2626,color:#7f1d1d",
		"",
	];

	for (const moduleName of moduleNames) {
		const tier = cycleNodes.has(moduleName)
			? "cycle"
			: nodeTier(depths.get(moduleName) ?? 0, maxDepth);
		lines.push(`  ${nodeIdFor(moduleName)}["${moduleName}"]:::${tier}`);
	}

	lines.push("");

	orderedEdges.forEach((edge, index) => {
		const connector = edge.kind === "runtime" ? "-->" : "-.->";
		lines.push(`  ${nodeIdFor(edge.to)} ${connector} ${nodeIdFor(edge.from)}`);
		if (cycleEdgeKeys.has(edgeKey(edge.from, edge.to))) {
			linkStyleIndexes.push(index);
		}
	});

	if (linkStyleIndexes.length > 0) {
		lines.push("");
		lines.push(`  linkStyle ${linkStyleIndexes.join(",")} stroke:#dc2626,stroke-width:2px`);
	}

	return lines.join("\n");
};

const getModuleConnections = (moduleNames: string[], edges: Edge[]) => {
	const connections = new Map(moduleNames.map((moduleName) => [moduleName, new Set<string>()]));

	for (const edge of edges) {
		connections.get(edge.from)?.add(edge.to);
	}

	return Object.fromEntries(
		[...connections.entries()].map(([moduleName, connected]) => [
			moduleName,
			[...connected].sort(),
		]),
	);
};

const wrapInHtml = (mermaid: string, cycles: string[][], moduleNames: string[], edges: Edge[]) => {
	const cycleBanner =
		cycles.length === 0
			? ""
			: `<div class="banner"><strong>Runtime import cycles detected:</strong><ul>${cycles
					.map((cycle) => `<li>${cycle.join(" → ")}</li>`)
					.join("")}</ul></div>`;
	const safeModuleConnections = JSON.stringify(getModuleConnections(moduleNames, edges)).replace(
		/</g,
		"\\u003c",
	);
	const safeMermaid = mermaid.replace(/<\/script>/gi, "<\\/script>");

	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>app-backend module DAG</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; flex-direction: column; }
    header { display: flex; gap: 1rem; align-items: flex-start; padding: 1rem 1.5rem; border-bottom: 1px solid #1e293b; flex-wrap: wrap; }
    h1 { margin: 0; font-size: 1.05rem; font-weight: 600; }
    .subtitle { color: #94a3b8; font-size: 0.85rem; margin-top: 0.2rem; }
    .legend { margin-left: auto; display: grid; grid-template-columns: repeat(3, max-content); gap: 0.65rem 1rem; font-size: 0.8rem; align-items: center; }
    .legend-item { display: inline-flex; gap: 0.45rem; align-items: center; }
    .swatch { width: 12px; height: 12px; border-radius: 3px; border: 1.5px solid; flex: none; }
    .leaf { background: #e2e8f0; border-color: #94a3b8; }
    .mid { background: #bfdbfe; border-color: #3b82f6; }
    .top { background: #fed7aa; border-color: #ea580c; }
    .line { width: 28px; height: 2px; flex: none; background: #64748b; }
    .line.dashed { background: repeating-linear-gradient(90deg, #64748b 0 5px, transparent 5px 9px); }
    .banner { margin: 1rem 1.5rem 0; border: 1px solid #dc2626; background: #450a0a; border-radius: 8px; padding: 0.75rem 1rem; font-size: 0.85rem; }
    .banner ul { margin: 0.5rem 0 0; padding-left: 1.2rem; }
    main { position: relative; flex: 1; padding: 1.5rem 1rem 2rem; }
    #diagram { height: 100%; min-height: 70vh; border-radius: 10px; overflow: hidden; }
    .mermaid, .mermaid svg { width: 100%; height: 100%; }
    .mermaid svg { display: block; cursor: grab; user-select: none; touch-action: none; }
    .mermaid svg.dragging { cursor: grabbing; }
    .mermaid svg g.node { transition: opacity 120ms ease, filter 120ms ease; }
    .mermaid svg g.node:focus { outline: none; }
    .mermaid svg.has-highlight g.node { opacity: 0.22; }
    .mermaid svg.has-highlight g.node.is-highlighted, .mermaid svg.has-highlight g.node.is-connected { opacity: 1; filter: drop-shadow(0 0 7px rgba(96, 165, 250, 0.65)); }
    .toolbar { position: absolute; top: 2rem; right: 1.5rem; z-index: 1; display: flex; gap: 0.5rem; }
    .toolbar button { width: 2.4rem; height: 2.4rem; border: 1px solid #334155; border-radius: 8px; background: rgba(15, 23, 42, 0.92); color: #e2e8f0; font-size: 1.1rem; cursor: pointer; }
    .toolbar button:hover { background: #1e293b; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>app-backend module DAG</h1>
      <div class="subtitle">Solid arrows are runtime imports. Dashed arrows are test-only imports. Arrows point from dependency to dependent so the graph reads top-down from generic modules to orchestrators.</div>
    </div>
    <div class="legend">
      <span class="legend-item"><span class="swatch leaf"></span>leaf</span>
      <span class="legend-item"><span class="swatch mid"></span>mid-tier</span>
      <span class="legend-item"><span class="swatch top"></span>orchestrator</span>
      <span class="legend-item"><span class="line"></span>runtime</span>
      <span class="legend-item"><span class="line dashed"></span>test-only</span>
      <span class="legend-item"><span class="swatch" style="background:#fecaca;border-color:#dc2626"></span>cycle</span>
    </div>
  </header>
  ${cycleBanner}
  <main>
    <div class="toolbar">
      <button type="button" data-action="zoom-in" aria-label="Zoom in">+</button>
      <button type="button" data-action="zoom-out" aria-label="Zoom out">-</button>
      <button type="button" data-action="reset" aria-label="Reset zoom">&#8634;</button>
    </div>
    <div id="diagram"><pre class="mermaid">
${safeMermaid}
    </pre></div>
  </main>
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs"

    const moduleConnections = ${safeModuleConnections}
    const toViewBox = (box) => [box.x, box.y, box.width, box.height].join(" ")
    const copyViewBox = (box) => ({ x: box.x, y: box.y, width: box.width, height: box.height })
    const getNodeModuleName = (node) => node.querySelector(".nodeLabel")?.textContent?.trim() ?? node.textContent?.trim()

    const ensureViewBox = (svg) => {
      if (svg.getAttribute("viewBox")) return
      const box = svg.getBBox()
      svg.setAttribute("viewBox", toViewBox(box))
    }

    const setupZoom = (svg) => {
      ensureViewBox(svg)
      const original = copyViewBox(svg.viewBox.baseVal)
      const state = { pointer: null, viewBox: { ...original } }
      const zoomStep = 1.08
      const minWidth = original.width * 0.18
      const maxWidth = original.width * 4

      const apply = () => svg.setAttribute("viewBox", toViewBox(state.viewBox))

      const zoom = (factor, clientX, clientY) => {
        const rect = svg.getBoundingClientRect()
        const offsetX = clientX === undefined ? rect.width / 2 : clientX - rect.left
        const offsetY = clientY === undefined ? rect.height / 2 : clientY - rect.top
        const anchorX = state.viewBox.x + (offsetX / rect.width) * state.viewBox.width
        const anchorY = state.viewBox.y + (offsetY / rect.height) * state.viewBox.height
        const width = Math.min(maxWidth, Math.max(minWidth, state.viewBox.width / factor))
        const height = width * (original.height / original.width)
        state.viewBox = {
          x: anchorX - (offsetX / rect.width) * width,
          y: anchorY - (offsetY / rect.height) * height,
          width,
          height
        }
        apply()
      }

      svg.addEventListener("wheel", (event) => {
        event.preventDefault()
        zoom(event.deltaY < 0 ? zoomStep : 1 / zoomStep, event.clientX, event.clientY)
      }, { passive: false })

      svg.addEventListener("pointerdown", (event) => {
        state.pointer = { clientX: event.clientX, clientY: event.clientY, viewBox: { ...state.viewBox } }
        svg.classList.add("dragging")
        svg.setPointerCapture(event.pointerId)
      })

      svg.addEventListener("pointermove", (event) => {
        if (!state.pointer) return
        const rect = svg.getBoundingClientRect()
        const deltaX = ((event.clientX - state.pointer.clientX) / rect.width) * state.pointer.viewBox.width
        const deltaY = ((event.clientY - state.pointer.clientY) / rect.height) * state.pointer.viewBox.height
        state.viewBox = {
          ...state.pointer.viewBox,
          x: state.pointer.viewBox.x - deltaX,
          y: state.pointer.viewBox.y - deltaY
        }
        apply()
      })

      const stopDragging = (event) => {
        if (!state.pointer) return
        state.pointer = null
        svg.classList.remove("dragging")
        svg.releasePointerCapture(event.pointerId)
      }

      svg.addEventListener("pointerup", stopDragging)
      svg.addEventListener("pointercancel", stopDragging)

      document.querySelector('[data-action="zoom-in"]')?.addEventListener("click", () => zoom(zoomStep))
      document.querySelector('[data-action="zoom-out"]')?.addEventListener("click", () => zoom(1 / zoomStep))
      document.querySelector('[data-action="reset"]')?.addEventListener("click", () => {
        state.viewBox = { ...original }
        apply()
      })
    }

    const setupHighlights = (svg) => {
      const nodeByModule = new Map()
      for (const node of svg.querySelectorAll("g.node")) {
        const moduleName = getNodeModuleName(node)
        if (!Array.isArray(moduleConnections[moduleName])) continue
        node.setAttribute("tabindex", "0")
        nodeByModule.set(moduleName, node)
      }

      const clearHighlight = () => {
        svg.classList.remove("has-highlight")
        for (const node of nodeByModule.values()) {
          node.classList.remove("is-highlighted", "is-connected")
        }
      }

      const highlight = (moduleName) => {
        const connected = new Set(moduleConnections[moduleName])
        svg.classList.add("has-highlight")
        for (const [nodeName, node] of nodeByModule) {
          node.classList.toggle("is-highlighted", nodeName === moduleName)
          node.classList.toggle("is-connected", connected.has(nodeName))
        }
      }

      for (const [moduleName, node] of nodeByModule) {
        node.addEventListener("pointerenter", () => highlight(moduleName))
        node.addEventListener("pointerleave", clearHighlight)
        node.addEventListener("focus", () => highlight(moduleName))
        node.addEventListener("blur", clearHighlight)
      }
    }

    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: {
        background: "#0f172a",
        lineColor: "#64748b",
        primaryTextColor: "#e2e8f0",
        edgeLabelBackground: "#1e293b"
      },
      flowchart: {
        curve: "basis",
        nodeSpacing: 60,
        rankSpacing: 90,
        padding: 24
      }
    })

    await mermaid.run({ querySelector: ".mermaid" })
    const svg = document.querySelector("#diagram svg")
    if (svg instanceof SVGSVGElement) {
      setupZoom(svg)
      setupHighlights(svg)
    }
  </script>
</body>
</html>
`;
};

const program = Effect.gen(function* () {
	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;
	const scriptPath = yield* path.fromFileUrl(new URL(import.meta.url));
	const scriptDir = path.dirname(scriptPath);
	const modulesDir = path.resolve(scriptDir, "..", "src", "modules");
	const outputFile = path.resolve(scriptDir, "..", "..", "..", "tmp", "module-dag.html");
	const moduleNames = yield* getModuleNames(modulesDir);
	const edges = yield* buildEdges(modulesDir, moduleNames);
	const { cycleEdgeKeys, cycles } = detectCycles(moduleNames, edges);
	const html = wrapInHtml(
		generateMermaid(moduleNames, edges, cycleEdgeKeys),
		cycles,
		moduleNames,
		edges,
	);

	if (cycles.length > 0) {
		yield* Effect.logWarning(
			`Detected runtime import cycles:\n${cycles.map((cycle) => `- ${cycle.join(" -> ")}`).join("\n")}`,
		);
	}

	yield* fs.makeDirectory(path.dirname(outputFile), { recursive: true });
	yield* fs.writeFileString(outputFile, html);
	yield* Effect.logInfo(
		`Generated ${outputFile} with ${moduleNames.length} modules and ${edges.length} edges.`,
	);
});

BunRuntime.runMain(
	program.pipe(Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))),
);
