import { FileSystem, Path } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import {
	FILESYSTEM_GRANT_SANDBOX_CAPABILITIES,
	type FilesystemGrantSandboxCapability,
} from "@ryot/sandbox-sdk/core";
import { sandboxScratchManifestSchema } from "@ryot/sandbox-sdk/filesystem";
import { Effect, Schema } from "effect";

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

export const measureSandboxScratchBytes = Effect.fn("sandbox.measureScratchBytes")(function* (
	directory: string,
) {
	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;
	const walk = (current: string): Effect.Effect<number, PlatformError> =>
		fs.readDirectory(current).pipe(
			Effect.flatMap((entries) =>
				Effect.forEach(entries, (entry) => {
					const entryPath = path.join(current, entry);
					return fs
						.stat(entryPath)
						.pipe(
							Effect.flatMap((info) =>
								info.type === "Directory" ? walk(entryPath) : Effect.succeed(Number(info.size)),
							),
						);
				}),
			),
			Effect.map((sizes) => sizes.reduce((total, size) => total + size, 0)),
		);

	return yield* walk(directory);
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

			const target = path.join(input.destination, path.relative(scratchRoot, source));
			yield* fs.makeDirectory(path.dirname(target), { recursive: true });
			yield* fs.copyFile(source, target);
			chunkPaths.push(target);
		}

		return chunkPaths;
	},
);
