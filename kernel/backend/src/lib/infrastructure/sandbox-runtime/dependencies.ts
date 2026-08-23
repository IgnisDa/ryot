import { createSha256Hasher, sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Data, Effect, FileSystem, Schema } from "effect";

import { sandboxRuntimePayloadMetadataSchema, sandboxRuntimePayloadSchema } from "./payload";
import { sandboxRuntimePayload } from "./runtime-payload.generated";

export class SandboxRuntimeDependencyError extends Data.TaggedError(
	"SandboxRuntimeDependencyError",
)<{ readonly message: string }> {}

const runtimeModuleDirectoryName = "modules";

const payloadError = (message: string) => new SandboxRuntimeDependencyError({ message });
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const validatePayload = (payload: unknown) =>
	Effect.gen(function* () {
		if (!payload || typeof payload !== "object") {
			return yield* payloadError("Trusted sandbox runtime payload is missing");
		}
		const candidate = yield* Schema.decodeUnknownEffect(sandboxRuntimePayloadSchema)(payload).pipe(
			Effect.mapError(() => payloadError("Trusted sandbox runtime payload metadata is invalid")),
		);
		const expectedFiles = new Map(candidate.metadata.files.map((file) => [file.path, file]));
		const actualFiles = new Map(candidate.files.map((file) => [file.path, file.contents]));
		if (
			expectedFiles.size + 1 !== actualFiles.size ||
			!actualFiles.has("runtime-metadata.json") ||
			[...actualFiles.keys()].some(
				(file) =>
					file.includes("/") ||
					file === runtimeModuleDirectoryName ||
					(file !== "runtime-metadata.json" && !expectedFiles.has(file)),
			)
		) {
			return yield* payloadError("Trusted sandbox runtime payload file set is inconsistent");
		}
		for (const [file, expected] of expectedFiles) {
			const contents = actualFiles.get(file);
			const bytes = typeof contents === "string" ? new TextEncoder().encode(contents) : undefined;
			if (
				!bytes ||
				bytes.byteLength !== expected.byteLength ||
				sha256Hex(bytes) !== expected.sha256
			) {
				return yield* payloadError(`Trusted sandbox runtime payload file is corrupt: ${file}`);
			}
		}
		const metadataContents = actualFiles.get("runtime-metadata.json");
		if (typeof metadataContents !== "string") {
			return yield* payloadError("Trusted sandbox runtime payload metadata file is missing");
		}
		const fileMetadata = yield* Schema.decodeUnknownEffect(
			Schema.fromJsonString(sandboxRuntimePayloadMetadataSchema),
		)(metadataContents).pipe(
			Effect.mapError(() =>
				payloadError("Trusted sandbox runtime payload metadata file is invalid"),
			),
		);
		if (
			encodeJson(fileMetadata) !== encodeJson(candidate.metadata) ||
			canonicalRuntimeHash(candidate.files) !== candidate.contentHash
		) {
			return yield* payloadError("Trusted sandbox runtime payload integrity check failed");
		}
		return candidate;
	});

const canonicalRuntimeHash = (
	files: readonly { readonly path: string; readonly contents: string }[],
) => {
	const hasher = createSha256Hasher();
	for (const { path, contents } of files
		.slice()
		.sort(({ path: left }, { path: right }) => left.localeCompare(right))) {
		const bytes = new TextEncoder().encode(contents);
		hasher.update(`${path.length}:${path}:${bytes.byteLength}:`);
		hasher.update(bytes);
	}
	return hasher.digest("hex");
};

const trustedPayload = sandboxRuntimePayload;

export const SANDBOX_APPROVED_DEPENDENCIES = trustedPayload.metadata.dependencies;
export const SANDBOX_RUNTIME_IMPORT_MAP_CONTENT =
	trustedPayload.files.find(({ path }) => path === "import-map.json")?.contents ?? "";

const runtimeDirectoryPrefix = `runtime-v${trustedPayload.metadata.format}-${trustedPayload.metadata.dependencies
	.map(({ name, version }) => `${name}-${version}`)
	.join("_")}`;
const runtimeFiles = trustedPayload.files.map(({ path }) => path).sort();
const runtimeDirectoryEntries = [...runtimeFiles, runtimeModuleDirectoryName].sort();

export type SandboxRuntimePaths = {
	readonly directory: string;
	readonly importMapPath: string;
	readonly cacheDirectory: string;
	readonly moduleDirectory: string;
};

const sandboxRuntimePaths = (
	denoDir: string,
	contentHash: string,
	suffix = "",
): SandboxRuntimePaths => {
	const directory = `${denoDir}/${runtimeDirectoryPrefix}-${contentHash}${suffix}`;
	return {
		directory,
		importMapPath: `${directory}/import-map.json`,
		moduleDirectory: `${directory}/${runtimeModuleDirectoryName}`,
		cacheDirectory: `${denoDir}/cache-v${trustedPayload.metadata.format}-${contentHash}`,
	};
};

const runtimeContentHash = (fs: FileSystem.FileSystem, directory: string) =>
	Effect.gen(function* () {
		const entries = (yield* fs.readDirectory(directory)).sort();
		if (
			entries.length !== runtimeDirectoryEntries.length ||
			entries.some((entry, index) => entry !== runtimeDirectoryEntries[index])
		) {
			return yield* payloadError("Sandbox runtime dependency directory has unexpected files");
		}
		if ((yield* fs.stat(`${directory}/${runtimeModuleDirectoryName}`)).type !== "Directory") {
			return yield* payloadError("Sandbox runtime module path is not a directory");
		}
		const files = yield* Effect.forEach(runtimeFiles, (file) =>
			fs
				.readFileString(`${directory}/${file}`)
				.pipe(Effect.map((contents) => ({ contents, path: file }))),
		);
		return canonicalRuntimeHash(files);
	});

const runtimeMatches = (
	fs: FileSystem.FileSystem,
	paths: SandboxRuntimePaths,
	contentHash: string,
) =>
	runtimeContentHash(fs, paths.directory).pipe(
		Effect.map((actualHash) => actualHash === contentHash),
		Effect.orElseSucceed(() => false),
	);

const lockRuntimeDirectory = (fs: FileSystem.FileSystem, paths: SandboxRuntimePaths) =>
	Effect.gen(function* () {
		yield* Effect.forEach(
			runtimeFiles.map((file) => `${paths.directory}/${file}`),
			(file) => fs.chmod(file, 0o444),
			{ discard: true },
		);
		yield* fs.chmod(paths.directory, 0o555);
	});

const prepareRuntimePaths = (fs: FileSystem.FileSystem, paths: SandboxRuntimePaths) =>
	Effect.gen(function* () {
		yield* fs.makeDirectory(paths.cacheDirectory, { recursive: true });
		yield* lockRuntimeDirectory(fs, paths);
		return paths;
	});

const repairRuntimePaths = (denoDir: string, contentHash: string) =>
	sandboxRuntimePaths(denoDir, contentHash, "-repair");

const randomRepairRuntimePaths = (denoDir: string, contentHash: string) =>
	sandboxRuntimePaths(denoDir, contentHash, `-repair-${crypto.randomUUID()}`);

const findVerifiedRepair = (fs: FileSystem.FileSystem, denoDir: string, contentHash: string) =>
	Effect.gen(function* () {
		const baseName = `${runtimeDirectoryPrefix}-${contentHash}`;
		const entries = yield* fs.readDirectory(denoDir);
		for (const entry of entries.sort()) {
			if (!entry.startsWith(`${baseName}-repair`)) {
				continue;
			}
			const paths = sandboxRuntimePaths(denoDir, contentHash, entry.slice(baseName.length));
			if (yield* runtimeMatches(fs, paths, contentHash)) {
				return paths;
			}
		}
		return null;
	});

const publishRuntimeDirectory = (
	fs: FileSystem.FileSystem,
	denoDir: string,
	temporaryDirectory: string,
	contentHash: string,
) =>
	Effect.gen(function* () {
		const primaryPaths = sandboxRuntimePaths(denoDir, contentHash);
		if (yield* runtimeMatches(fs, primaryPaths, contentHash)) {
			return yield* prepareRuntimePaths(fs, primaryPaths);
		}
		const existingRepair = yield* findVerifiedRepair(fs, denoDir, contentHash);
		if (existingRepair) {
			return yield* prepareRuntimePaths(fs, existingRepair);
		}

		const deterministicRepair = repairRuntimePaths(denoDir, contentHash);
		let destination = primaryPaths;
		if (yield* fs.exists(primaryPaths.directory)) {
			if (yield* runtimeMatches(fs, primaryPaths, contentHash)) {
				return yield* prepareRuntimePaths(fs, primaryPaths);
			}
			destination = deterministicRepair;
			if (yield* fs.exists(deterministicRepair.directory)) {
				if (yield* runtimeMatches(fs, deterministicRepair, contentHash)) {
					return yield* prepareRuntimePaths(fs, deterministicRepair);
				}
				destination = randomRepairRuntimePaths(denoDir, contentHash);
			}
		}
		const paths = yield* fs.rename(temporaryDirectory, destination.directory).pipe(
			Effect.as(destination),
			Effect.catch(() =>
				Effect.gen(function* () {
					if (yield* runtimeMatches(fs, primaryPaths, contentHash)) {
						return primaryPaths;
					}
					const repairWinner = yield* findVerifiedRepair(fs, denoDir, contentHash);
					if (repairWinner) {
						return repairWinner;
					}
					const repairPaths = randomRepairRuntimePaths(denoDir, contentHash);
					yield* fs.rename(temporaryDirectory, repairPaths.directory);
					return repairPaths;
				}),
			),
		);
		return yield* prepareRuntimePaths(fs, paths);
	});

export const materializeSandboxRuntimePayload = (denoDir: string, payload: unknown) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const verified = yield* validatePayload(payload);
		yield* fs.makeDirectory(denoDir, { recursive: true });
		return yield* Effect.acquireUseRelease(
			fs.makeTempDirectory({ directory: denoDir, prefix: ".ryot-sandbox-runtime-" }),
			(temporaryDirectory) =>
				Effect.gen(function* () {
					yield* fs.makeDirectory(`${temporaryDirectory}/${runtimeModuleDirectoryName}`);
					yield* Effect.forEach(
						verified.files,
						({ path, contents }) => fs.writeFileString(`${temporaryDirectory}/${path}`, contents),
						{ discard: true },
					);
					return yield* publishRuntimeDirectory(
						fs,
						denoDir,
						temporaryDirectory,
						verified.contentHash,
					);
				}),
			(temporaryDirectory) =>
				fs.remove(temporaryDirectory, { recursive: true }).pipe(Effect.ignore),
		);
	});

export const ensureSandboxRuntimeDependencies = (denoDir: string) =>
	materializeSandboxRuntimePayload(denoDir, sandboxRuntimePayload);
