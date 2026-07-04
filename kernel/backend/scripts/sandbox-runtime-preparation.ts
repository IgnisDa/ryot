import { Data, Effect, FileSystem, Path } from "effect";
import type { PlatformError } from "effect/PlatformError";

export interface SandboxRuntimePreparationLimits {
	readonly maxDepth: number;
	readonly maxFiles: number;
	readonly maxTotalBytes: number;
}

export class SandboxRuntimePreparationError extends Data.TaggedError(
	"SandboxRuntimePreparationError",
)<{
	readonly path: string;
	readonly message: string;
	readonly reason: "depth-limit" | "file-limit" | "size-limit" | "symbolic-link";
}> {}

const defaultLimits: SandboxRuntimePreparationLimits = {
	maxDepth: 16,
	maxFiles: 1_000,
	maxTotalBytes: 16 * 1024 * 1024,
};

type SourceBudget = { files: number; totalBytes: number };

const preparationError = (
	reason: SandboxRuntimePreparationError["reason"],
	path: string,
	message: string,
) => new SandboxRuntimePreparationError({ path, reason, message });

const rejectSymbolicLink = (file: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const target = yield* fs.readLink(file).pipe(Effect.option);
		if (target._tag === "Some") {
			return yield* preparationError(
				"symbolic-link",
				file,
				`Sandbox runtime preparation input must not be a symbolic link: ${file}`,
			);
		}
		return undefined;
	});

const readSource = (
	file: string,
	limits: SandboxRuntimePreparationLimits,
	budget: SourceBudget,
): Effect.Effect<string, PlatformError | SandboxRuntimePreparationError, FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		yield* rejectSymbolicLink(file);
		const info = yield* fs.stat(file);
		if (budget.files >= limits.maxFiles) {
			return yield* preparationError(
				"file-limit",
				file,
				`Sandbox runtime preparation exceeds the ${limits.maxFiles} file limit at: ${file}`,
			);
		}
		const size = Number(info.size);
		if (budget.totalBytes + size > limits.maxTotalBytes) {
			return yield* preparationError(
				"size-limit",
				file,
				`Sandbox runtime preparation exceeds the ${limits.maxTotalBytes} byte limit at: ${file}`,
			);
		}
		const source = yield* fs.readFileString(file);
		budget.files += 1;
		budget.totalBytes += size;
		return source;
	});

const walkSources = (
	directory: string,
	root: string,
	include: (entry: string) => boolean,
	limits: SandboxRuntimePreparationLimits,
	budget: SourceBudget,
	depth = 0,
): Effect.Effect<
	Readonly<Record<string, string>>,
	PlatformError | SandboxRuntimePreparationError,
	FileSystem.FileSystem | Path.Path
> =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const files: Record<string, string> = {};
		yield* rejectSymbolicLink(directory);
		for (const entry of (yield* fs.readDirectory(directory)).sort()) {
			const absolutePath = path.join(directory, entry);
			yield* rejectSymbolicLink(absolutePath);
			const info = yield* fs.stat(absolutePath);
			if (info.type === "Directory") {
				if (depth >= limits.maxDepth) {
					return yield* preparationError(
						"depth-limit",
						absolutePath,
						`Sandbox runtime preparation exceeds the ${limits.maxDepth} directory depth limit at: ${absolutePath}`,
					);
				}
				Object.assign(
					files,
					yield* walkSources(absolutePath, root, include, limits, budget, depth + 1),
				);
			} else if (include(entry)) {
				const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
				files[relativePath] = yield* readSource(absolutePath, limits, budget);
			}
		}
		return files;
	});

const runtimeTypeScriptSource = (entry: string) =>
	entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".generated.ts");

export const preparationSources = (
	kernelDirectory: string,
	sandboxRuntimeDirectory: string,
	limitOverrides: Partial<SandboxRuntimePreparationLimits> = {},
) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const limits = { ...defaultLimits, ...limitOverrides };
		const budget: SourceBudget = { files: 0, totalBytes: 0 };
		const workspaceRoot = path.resolve(kernelDirectory, "../..");
		const packageDirectories = [
			"contract",
			"ryotql",
			"ryotql-recipes",
			"sandbox-sdk",
			"ts-utils",
			"typescript-compiler",
			"vite-compiler",
		].map((name) => path.join(workspaceRoot, "packages", name));
		const sources: Record<string, string> = {
			...(yield* walkSources(
				sandboxRuntimeDirectory,
				workspaceRoot,
				(entry) => entry.endsWith(".sandbox.ts"),
				limits,
				budget,
			)),
			...(yield* walkSources(
				path.join(kernelDirectory, "src/modules/definition-registry/kernel-scripts"),
				workspaceRoot,
				(entry) => entry.endsWith(".sandbox.ts"),
				limits,
				budget,
			)),
		};
		for (const directory of packageDirectories) {
			Object.assign(
				sources,
				yield* walkSources(
					path.join(directory, "src"),
					workspaceRoot,
					runtimeTypeScriptSource,
					limits,
					budget,
				),
			);
		}
		for (const file of [
			path.join(workspaceRoot, "package.json"),
			path.join(workspaceRoot, "bun.lock"),
			path.join(kernelDirectory, "package.json"),
			path.join(kernelDirectory, "scripts/generate-sandbox-runtime.ts"),
			path.join(kernelDirectory, "scripts/sandbox-runtime-payload.ts"),
			path.join(kernelDirectory, "scripts/sandbox-runtime-preparation.ts"),
			path.join(kernelDirectory, "scripts/sandbox-runtime-registry.ts"),
			path.join(kernelDirectory, "src/lib/infrastructure/sandbox-runtime/payload.ts"),
			...packageDirectories.map((directory) => path.join(directory, "package.json")),
		]) {
			sources[path.relative(workspaceRoot, file).split(path.sep).join("/")] = yield* readSource(
				file,
				limits,
				budget,
			);
		}
		return Object.fromEntries(
			Object.entries(sources).sort(([left], [right]) => left.localeCompare(right)),
		);
	});
