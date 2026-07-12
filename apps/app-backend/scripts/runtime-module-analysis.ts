import { FileSystem, Path } from "@effect/platform";
import { Effect } from "effect";

type FileKind = "runtime" | "test";

type FileEntry = {
	path: string;
	kind: FileKind;
};

export type ModuleEdge = {
	to: string;
	from: string;
	kind: FileKind;
};

export type ModuleSource = FileEntry & {
	content: string;
	moduleName: string;
};

const importPattern =
	/(?:import|export)\s+(type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

export const extractImportPaths = (content: string) => {
	const paths: string[] = [];
	let match: RegExpExecArray | null;

	importPattern.lastIndex = 0;
	while ((match = importPattern.exec(content)) !== null) {
		const path = match[2] ?? match[3];
		if (!match[1] && path) {
			paths.push(path);
		}
	}

	return paths;
};

const moduleEdgeKey = (from: string, to: string) => `${from}|${to}`;

const isRuntimeFile = (file: string) =>
	file.endsWith(".ts") &&
	!file.endsWith(".d.ts") &&
	!file.endsWith(".test.ts") &&
	!file.endsWith(".spec.ts") &&
	!file.endsWith(".test-support.ts") &&
	!file.endsWith(".test-fixture.ts") &&
	!file.endsWith(".typecheck.ts") &&
	!file.endsWith("runner.generated.ts") &&
	!file.replaceAll("\\", "/").includes("/test-fixtures/");

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

			files.push({ path: fullPath, kind: isRuntimeFile(fullPath) ? "runtime" : "test" });
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

export const extractImportEdges = (
	source: ModuleSource,
	modulesDir: string,
	moduleNames: ReadonlySet<string>,
) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const targets = new Set<string>();

		for (const importPath of extractImportPaths(source.content)) {
			const target = resolveToModule(source.path, importPath, modulesDir, moduleNames, path);
			if (target && target !== source.moduleName) {
				targets.add(target);
			}
		}

		return [...targets]
			.sort((left, right) => left.localeCompare(right))
			.map((to) => ({ to, from: source.moduleName, kind: source.kind }) satisfies ModuleEdge);
	});

const resolveFileImport = (
	sourceFile: string,
	importPath: string,
	srcDir: string,
	files: ReadonlySet<string>,
	path: Path.Path,
) => {
	let target: string | null = null;
	if (importPath.startsWith("#")) {
		target = path.resolve(srcDir, importPath.slice(1));
	} else if (importPath.startsWith(".")) {
		target = path.resolve(path.dirname(sourceFile), importPath);
	}
	if (!target) {
		return null;
	}

	for (const candidate of [target, `${target}.ts`, path.join(target, "index.ts")]) {
		if (files.has(candidate)) {
			return candidate;
		}
	}
	return null;
};

const resolveFileModule = (
	file: string,
	modulesDir: string,
	moduleNames: ReadonlySet<string>,
	path: Path.Path,
) => {
	const relativePath = path.relative(modulesDir, file);
	if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
		return null;
	}
	const [moduleName] = relativePath.split(path.sep);
	return moduleName && moduleNames.has(moduleName) ? moduleName : null;
};

const buildEdges = (srcDir: string, modulesDir: string, moduleNames: string[]) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const knownModules = new Set(moduleNames);
		const files = (yield* walkTsFiles(srcDir)).filter((file) => file.kind === "runtime");
		const contents = new Map(
			yield* Effect.forEach(files, (file) =>
				fs.readFileString(file.path).pipe(Effect.map((content) => [file.path, content] as const)),
			),
		);
		const filePaths = new Set(contents.keys());
		const edges = new Set<string>();

		for (const moduleName of moduleNames) {
			const visited = new Set<string>();
			const visit = (file: string): Effect.Effect<void> =>
				Effect.gen(function* () {
					if (visited.has(file)) {
						return;
					}
					visited.add(file);
					for (const importPath of extractImportPaths(contents.get(file) ?? "")) {
						const target = resolveFileImport(file, importPath, srcDir, filePaths, path);
						if (!target) {
							continue;
						}
						const targetModule = resolveFileModule(target, modulesDir, knownModules, path);
						if (targetModule && targetModule !== moduleName) {
							edges.add(moduleEdgeKey(moduleName, targetModule));
							continue;
						}
						yield* visit(target);
					}
				});

			for (const file of filePaths) {
				if (resolveFileModule(file, modulesDir, knownModules, path) === moduleName) {
					yield* visit(file);
				}
			}
		}

		return [...edges]
			.map((key) => {
				const divider = key.indexOf("|");
				return {
					kind: "runtime",
					to: key.slice(divider + 1),
					from: key.slice(0, divider),
				} satisfies ModuleEdge;
			})
			.sort(
				(left, right) =>
					left.from.localeCompare(right.from) ||
					left.to.localeCompare(right.to) ||
					left.kind.localeCompare(right.kind),
			);
	});

export const detectRuntimeCycles = (
	moduleNames: ReadonlyArray<string>,
	edges: ReadonlyArray<ModuleEdge>,
) => {
	type VisitState = "white" | "gray" | "black";

	const orderedModuleNames = [...moduleNames].sort((left, right) => left.localeCompare(right));
	const adjacency = new Map(orderedModuleNames.map((moduleName) => [moduleName, [] as string[]]));
	for (const edge of edges) {
		if (edge.kind === "runtime") {
			adjacency.get(edge.from)?.push(edge.to);
		}
	}
	for (const neighbors of adjacency.values()) {
		neighbors.sort((left, right) => left.localeCompare(right));
	}

	const stack: string[] = [];
	const cycles: string[][] = [];
	const seenCycles = new Set<string>();
	const state = new Map<string, VisitState>(
		orderedModuleNames.map((moduleName) => [moduleName, "white"]),
	);

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

				continue;
			}

			if (dependencyState === "white") {
				visit(dependency);
			}
		}

		stack.pop();
		state.set(moduleName, "black");
	};

	for (const moduleName of orderedModuleNames) {
		if (state.get(moduleName) === "white") {
			visit(moduleName);
		}
	}

	return cycles;
};

export const formatRuntimeCycleDiagnostics = (cycles: ReadonlyArray<ReadonlyArray<string>>) =>
	`Runtime module cycles detected:\n${cycles.map((cycle) => `- ${cycle.join(" -> ")}`).join("\n")}`;

export const analyzeRuntimeModules = (modulesDir: string) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const srcDir = path.dirname(modulesDir);
		const moduleNames = yield* getModuleNames(modulesDir);
		const edges = yield* buildEdges(srcDir, modulesDir, moduleNames);
		return detectRuntimeCycles(moduleNames, edges);
	});
