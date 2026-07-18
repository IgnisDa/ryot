import { SANDBOX_RUNTIME_REGISTRY } from "@ryot-app/sandbox-sdk/runtime-registry";
import { Effect, FileSystem, Path, Schema } from "effect";

import type { SourceWalkLimits } from "./walk-source-tree";
import {
	createSourceWalkBudget,
	readSourceWithin,
	walkSourceFiles,
	walkSourcePaths,
} from "./walk-source-tree";

const defaultLimits: SourceWalkLimits = {
	maxDepth: 16,
	maxFiles: 1_000,
	maxTotalBytes: 16 * 1024 * 1024,
};

const workspaceScope = "@ryot-app/";

const toolchainPackages = ["typescript-compiler", "vite-compiler"];

const WorkspaceManifest = Schema.fromJsonString(
	Schema.Struct({ dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)) }),
);

const packageDirectory = (workspaceRoot: string, name: string) =>
	`${workspaceRoot}/packages/${name.slice(workspaceScope.length)}`;

const runtimePackageDirectories = (workspaceRoot: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const pending = [
			`${workspaceScope}sandbox-sdk`,
			...SANDBOX_RUNTIME_REGISTRY.map(({ packageName }) => packageName).filter((name) =>
				name.startsWith(workspaceScope),
			),
		];
		const reached = new Set<string>();
		while (pending.length > 0) {
			const name = pending.pop();
			if (name === undefined || reached.has(name)) {
				continue;
			}
			reached.add(name);
			const manifest = yield* Schema.decodeUnknownEffect(WorkspaceManifest)(
				yield* fs.readFileString(`${packageDirectory(workspaceRoot, name)}/package.json`),
			);
			pending.push(
				...Object.keys(manifest.dependencies ?? {}).filter((dependency) =>
					dependency.startsWith(workspaceScope),
				),
			);
		}
		return [
			...new Set([
				...[...reached].map((name) => packageDirectory(workspaceRoot, name)),
				...toolchainPackages.map((name) => `${workspaceRoot}/packages/${name}`),
			]),
		].sort();
	});

const sandboxSource = (file: string) => file.endsWith(".sandbox.ts");

const runtimeTypeScriptSource = (file: string) =>
	file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".generated.ts");

export const sandboxRuntimeInputs = (
	kernelDirectory: string,
	sandboxRuntimeDirectory: string,
	limitOverrides: Partial<SourceWalkLimits> = {},
) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const limits = { ...defaultLimits, ...limitOverrides };
		const budget = createSourceWalkBudget();
		const options = { limits, budget };
		const workspaceRoot = path.resolve(kernelDirectory, "../..");
		const sources: Record<string, string> = {
			...(yield* walkSourceFiles(sandboxRuntimeDirectory, workspaceRoot, sandboxSource, options)),
			...(yield* walkSourceFiles(
				path.join(kernelDirectory, "src/modules/definition-registry/kernel-scripts"),
				workspaceRoot,
				sandboxSource,
				options,
			)),
		};
		const packageDirectories = yield* runtimePackageDirectories(workspaceRoot);
		for (const directory of packageDirectories) {
			Object.assign(
				sources,
				yield* walkSourceFiles(
					path.join(directory, "src"),
					workspaceRoot,
					runtimeTypeScriptSource,
					options,
				),
			);
		}
		const scriptPaths = yield* walkSourcePaths(
			path.join(kernelDirectory, "scripts"),
			runtimeTypeScriptSource,
			options,
		);
		const relativeTo = (file: string) =>
			path.relative(workspaceRoot, file).split(path.sep).join("/");
		const fs = yield* FileSystem.FileSystem;
		for (const file of scriptPaths) {
			sources[relativeTo(file)] = yield* fs.readFileString(file);
		}
		for (const file of [
			path.join(workspaceRoot, "package.json"),
			path.join(workspaceRoot, "bun.lock"),
			path.join(kernelDirectory, "package.json"),
			path.join(kernelDirectory, "src/lib/infrastructure/sandbox-runtime/payload.ts"),
			...packageDirectories.map((directory) => path.join(directory, "package.json")),
		]) {
			sources[relativeTo(file)] = yield* readSourceWithin(file, limits, budget);
		}
		return Object.fromEntries(
			Object.entries(sources).sort(([left], [right]) => left.localeCompare(right)),
		);
	});
