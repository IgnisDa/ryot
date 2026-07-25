import {
	FILESYSTEM_GRANT_SANDBOX_CAPABILITIES,
	type FilesystemGrantSandboxCapability,
} from "@ryot/sandbox-sdk/core";
import { sandboxScratchManifestSchema } from "@ryot/sandbox-sdk/filesystem";
import { Effect, Schema, FileSystem, Path } from "effect";
import type { PlatformError } from "effect/PlatformError";

import { SANDBOX_LIMITS } from "./limits";

const SANDBOX_SCRATCH_DIRECTORY_PREFIX = "ryot-sandbox-scratch-";
export const SANDBOX_HARVEST_DIRECTORY_PREFIX = "ryot-sandbox-harvest-";

export const sanitizeSandboxExecutionSegment = (executionId: string) =>
	executionId.replace(/[^a-zA-Z0-9._-]/g, "-");

const filesystemGrantCapabilities = new Set<string>(FILESYSTEM_GRANT_SANDBOX_CAPABILITIES);

export const isSandboxFilesystemGrantCapability = (capability: string) =>
	filesystemGrantCapabilities.has(capability);

export type SandboxProcessGrants = {
	readonly artifactPath?: string;
	readonly scratchDirectory?: string;
	readonly namedArtifactPaths?: Readonly<Record<string, string>>;
};

export const declaresSandboxFilesystemGrant = (
	allowedHostFunctions: readonly string[],
	capability: FilesystemGrantSandboxCapability,
) => allowedHostFunctions.includes(capability);

// The capability is the gate and the dispatched path is only its parameter: a script that never
// declared `artifact-read` gets no read grant even when a path is supplied.
export const sandboxArtifactGrantPath = (
	allowedHostFunctions: readonly string[],
	suppliedPath: string | undefined,
) =>
	declaresSandboxFilesystemGrant(allowedHostFunctions, "artifact-read") ? suppliedPath : undefined;

export const sandboxNamedArtifactGrantPaths = (
	allowedHostFunctions: readonly string[],
	suppliedPaths: Readonly<Record<string, string>> | undefined,
) =>
	declaresSandboxFilesystemGrant(allowedHostFunctions, "artifact-read") ? suppliedPaths : undefined;

export const sandboxGrantPathError = (
	path: Path.Path,
	label: string,
	candidate: string,
	tempRoot: string,
) => {
	if (!path.isAbsolute(candidate)) {
		return `${label} must be an absolute path`;
	}
	if (path.resolve(candidate) !== candidate) {
		return `${label} must be a normalized path without traversal segments`;
	}
	const root = path.resolve(tempRoot);
	if (candidate !== root && !candidate.startsWith(root + path.sep)) {
		return `${label} must be inside ${root}`;
	}
	return null;
};

export const sandboxHarvestPathError = (
	path: Path.Path,
	filePath: string,
	expectedDirectoryPrefix: string,
) => {
	const resolvedFile = path.resolve(filePath);
	const directory = path.dirname(resolvedFile);
	const executionSegment = path.basename(directory);
	const expectedRoot = path.dirname(expectedDirectoryPrefix);
	const expectedExecutionPrefix = path.basename(expectedDirectoryPrefix);
	const activityStep = executionSegment.slice(expectedExecutionPrefix.length);
	return !path.isAbsolute(filePath) ||
		resolvedFile !== filePath ||
		path.dirname(directory) !== expectedRoot ||
		!executionSegment.startsWith(expectedExecutionPrefix) ||
		!/^(0|[1-9]\d*)$/.test(activityStep)
		? "Import chunk path is outside the trusted harvest"
		: null;
};

// Cleanup is kernel-owned and unconditional: the finalizer is registered with the directory, so the
// scratch directory disappears on success, on quota failure, on script error, on timeout, and on
// process kill alike.
export const acquireSandboxScratchDirectory = Effect.fn("sandbox.acquireScratchDirectory")(
	function* (tempRoot: string) {
		const fs = yield* FileSystem.FileSystem;
		const directory = yield* fs.makeTempDirectory({
			directory: tempRoot,
			prefix: SANDBOX_SCRATCH_DIRECTORY_PREFIX,
		});
		yield* Effect.addFinalizer(() =>
			fs.remove(directory, { force: true, recursive: true }).pipe(Effect.ignore),
		);
		return directory;
	},
);

const inspectSandboxScratchEntry = (fs: FileSystem.FileSystem, entryPath: string) =>
	fs.readLink(entryPath).pipe(
		Effect.as({ type: "SymbolicLink" as const }),
		Effect.catch(() => fs.stat(entryPath)),
	);

const sandboxScratchEntryError = (entryPath: string, type: string) =>
	`Sandbox scratch entry "${entryPath}" must be a regular file or directory (found ${type})`;

export const measureSandboxScratchBytes = Effect.fn("sandbox.measureScratchBytes")(function* (
	directory: string,
) {
	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;
	let entryCount = 0;
	const walk = (current: string, depth: number): Effect.Effect<number, PlatformError | string> =>
		Effect.gen(function* () {
			if (depth > SANDBOX_LIMITS.scratch.maxDepth) {
				return yield* Effect.fail(
					`Sandbox scratch directory exceeds ${SANDBOX_LIMITS.scratch.maxDepth} directory levels`,
				);
			}

			let total = 0;
			for (const entry of yield* fs.readDirectory(current)) {
				entryCount += 1;
				if (entryCount > SANDBOX_LIMITS.scratch.maxEntries) {
					return yield* Effect.fail(
						`Sandbox scratch directory exceeds ${SANDBOX_LIMITS.scratch.maxEntries} entries`,
					);
				}

				const entryPath = path.join(current, entry);
				const info = yield* inspectSandboxScratchEntry(fs, entryPath);
				if (info.type === "Directory") {
					total += yield* walk(entryPath, depth + 1);
				} else if (info.type === "File") {
					total += Number(info.size);
				} else {
					return yield* Effect.fail(sandboxScratchEntryError(entryPath, info.type));
				}
			}
			return total;
		});

	return yield* walk(directory, 0);
});

export const SandboxScratchManifest = sandboxScratchManifestSchema;

export type SandboxScratchManifest = Schema.Schema.Type<typeof SandboxScratchManifest>;

export const decodeSandboxScratchManifest = Schema.decodeUnknownOption(SandboxScratchManifest);

// Only files the returned manifest names are harvested; anything else left in the scratch directory
// is ignored and disappears with the unconditional cleanup.
export const harvestSandboxScratchChunks = Effect.fn("sandbox.harvestScratchChunks")(
	function* (input: {
		readonly destination: string;
		readonly scratchDirectory: string;
		readonly chunkFiles: readonly string[];
	}) {
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const scratchRoot = path.resolve(input.scratchDirectory);
		yield* fs.makeDirectory(input.destination, { recursive: true });

		const chunkPaths: string[] = [];
		for (const chunkFile of input.chunkFiles) {
			const source = path.resolve(scratchRoot, chunkFile);
			if (!source.startsWith(scratchRoot + path.sep)) {
				return yield* Effect.fail(
					`Sandbox scratch manifest entry "${chunkFile}" escapes the scratch directory`,
				);
			}
			if (!(yield* fs.exists(source))) {
				return yield* Effect.fail(
					`Sandbox scratch manifest names a missing chunk file "${chunkFile}"`,
				);
			}

			const relativeParts = path.relative(scratchRoot, source).split(path.sep).filter(Boolean);
			let current = scratchRoot;
			for (const [index, part] of relativeParts.entries()) {
				current = path.join(current, part);
				const info = yield* inspectSandboxScratchEntry(fs, current);
				if (info.type === "SymbolicLink") {
					return yield* Effect.fail(
						`Sandbox scratch entry "${current}" must not be a symbolic link`,
					);
				}
				if (index < relativeParts.length - 1 && info.type !== "Directory") {
					return yield* Effect.fail(sandboxScratchEntryError(current, info.type));
				}
				if (index === relativeParts.length - 1 && info.type !== "File") {
					return yield* Effect.fail(sandboxScratchEntryError(current, info.type));
				}
			}

			if (relativeParts.length === 0) {
				return yield* Effect.fail(
					`Sandbox scratch manifest names an invalid chunk file "${chunkFile}"`,
				);
			}

			const target = path.join(input.destination, path.relative(scratchRoot, source));
			yield* fs.makeDirectory(path.dirname(target), { recursive: true });
			yield* fs.copyFile(source, target);
			chunkPaths.push(target);
		}

		return chunkPaths;
	},
);

export const removeSandboxHarvestDirectories = Effect.fn("sandbox.removeHarvestDirectories")(
	function* (input: { readonly harvestRoot: string; readonly executionPrefix: string }) {
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		if (!(yield* fs.exists(input.harvestRoot))) {
			return;
		}
		const prefix = sanitizeSandboxExecutionSegment(input.executionPrefix);
		for (const entry of yield* fs.readDirectory(input.harvestRoot)) {
			if (entry.startsWith(prefix)) {
				yield* fs.remove(path.join(input.harvestRoot, entry), { force: true, recursive: true });
			}
		}
	},
);
