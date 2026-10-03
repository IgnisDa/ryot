import {
	FILESYSTEM_GRANT_SANDBOX_CAPABILITIES,
	type FilesystemGrantSandboxCapability,
} from "@ryot-app/sandbox-sdk/core";
import { sandboxScratchManifestSchema } from "@ryot-app/sandbox-sdk/filesystem";
import { Effect, Schema, FileSystem, Path } from "effect";

import { SANDBOX_LIMITS } from "./limits";

export const SANDBOX_SCRATCH_DIRECTORY_PREFIX = "ryot-sandbox-scratch-";
export const SANDBOX_HARVEST_DIRECTORY_PREFIX = "ryot-sandbox-harvest-";

export const sanitizeSandboxExecutionSegment = (executionId: string) =>
	executionId.replace(/[^a-zA-Z0-9._-]/g, "-");

const filesystemGrantCapabilities = new Set<string>(FILESYSTEM_GRANT_SANDBOX_CAPABILITIES);

export const isSandboxFilesystemGrantCapability = (capability: string) =>
	filesystemGrantCapabilities.has(capability);

export const declaresSandboxFilesystemGrant = (
	allowedHostFunctions: readonly string[],
	capability: FilesystemGrantSandboxCapability,
) => allowedHostFunctions.includes(capability);

// The capability is the gate and the dispatched path is only its parameter: a script that never
// declared `artifact-read` gets no read grant even when a path is supplied.
export const sandboxArtifactGrant = <T>(
	allowedHostFunctions: readonly string[],
	supplied: T | undefined,
) => (declaresSandboxFilesystemGrant(allowedHostFunctions, "artifact-read") ? supplied : undefined);

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

export const measureSandboxScratchBytes = Effect.fn("sandbox.measureScratchBytes")(function* (
	directory: string,
) {
	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;
	const entries = yield* fs.readDirectory(directory);
	if (entries.length > SANDBOX_LIMITS.scratch.maxEntries) {
		return yield* Effect.fail(
			`Sandbox scratch directory exceeds ${SANDBOX_LIMITS.scratch.maxEntries} entries`,
		);
	}
	let total = 0;
	for (const entry of entries) {
		const entryPath = path.join(directory, entry);
		const info = yield* fs.readLink(entryPath).pipe(
			Effect.as({ type: "SymbolicLink" as const }),
			Effect.catch(() => fs.stat(entryPath)),
		);
		if (info.type !== "File") {
			return yield* Effect.fail(
				`Sandbox scratch entry "${entryPath}" must be a regular file (found ${info.type})`,
			);
		}
		total += Number(info.size);
	}
	return total;
});

export const decodeSandboxScratchManifest = Schema.decodeUnknownOption(
	sandboxScratchManifestSchema,
);
