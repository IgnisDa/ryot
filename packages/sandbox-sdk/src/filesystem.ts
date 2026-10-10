import { SandboxBoundaryReason } from "@ryot-app/contract/modules/sandbox/boundary-reason";
import { Effect, Option, Schema } from "@ryot-app/sandbox-sdk/effect";

const encoder = new TextEncoder();
const NativeError = Error;
let filesystemRuntime: (() => SandboxFilesystemBinding | undefined) | undefined;

export type SandboxFilesystemBinding = {
	readonly readArtifactRange: (
		offset: number,
		length: number,
		key?: string,
	) => Promise<{ bytes: Uint8Array; size: number }>;
	readonly readArtifact: () => Promise<Uint8Array>;
	readonly readNamedArtifact: (key: string) => Promise<Uint8Array>;
	readonly writeScratchChunks: (
		chunks: ReadonlyArray<{ readonly name: string; readonly contents: Uint8Array }>,
	) => Promise<void>;
};

export type SandboxFilesystemError = {
	readonly message: string;
	readonly _tag: "SandboxFilesystemError";
	readonly data?: SandboxBoundaryReason;
};

export type SandboxScratchChunk = { readonly name: string; readonly contents: string | Uint8Array };

export const sandboxScratchManifestSchema = Schema.Struct({
	chunkFiles: Schema.Array(Schema.String),
});

export type SandboxScratchManifest = Schema.Schema.Type<typeof sandboxScratchManifestSchema>;

const isSandboxBoundaryReason = Schema.is(SandboxBoundaryReason);
const decodeFilesystemFailure = Schema.decodeUnknownOption(
	Schema.Struct({ message: Schema.String, data: Schema.optional(Schema.Unknown) }),
);

const filesystemError = (error: unknown, data?: SandboxBoundaryReason): SandboxFilesystemError => {
	const failure = decodeFilesystemFailure(error);
	const message = Option.isSome(failure) ? failure.value.message : String(error);
	const errorData = Option.isSome(failure) ? failure.value.data : undefined;
	let reason = data;
	if (reason === undefined && isSandboxBoundaryReason(errorData)) {
		reason = errorData;
	}
	return {
		message,
		_tag: "SandboxFilesystemError",
		...(reason === undefined ? {} : { data: reason }),
	};
};

const missingGrant = (message: string, operation: string) =>
	filesystemError(message, { operation, code: "missing-artifact-grant" });

export const configureSandboxFilesystem = (runtime: () => SandboxFilesystemBinding | undefined) => {
	if (filesystemRuntime !== undefined) {
		throw new NativeError("Sandbox filesystem runtime is already configured");
	}
	filesystemRuntime = runtime;
};

const binding = () => filesystemRuntime?.();

export const readArtifactRange = (offset: number, length: number, key?: string) =>
	Effect.suspend(() => {
		if (
			!Number.isSafeInteger(offset) ||
			offset < 0 ||
			!Number.isSafeInteger(length) ||
			length < 1 ||
			length > 1024 * 1024
		) {
			return Effect.fail(
				filesystemError("Artifact range requires a nonnegative offset and 1..1048576 bytes"),
			);
		}
		const filesystem = binding();
		return filesystem
			? Effect.tryPromise({
					catch: filesystemError,
					try: () => filesystem.readArtifactRange(offset, length, key),
				})
			: Effect.fail(missingGrant("Sandbox artifact grant is unavailable", "readArtifactRange"));
	});

export const readArtifact = Effect.suspend(() => {
	const filesystem = binding();
	return filesystem
		? Effect.tryPromise({ catch: filesystemError, try: () => filesystem.readArtifact() })
		: Effect.fail(missingGrant("Sandbox artifact grant is unavailable", "readArtifact"));
});

export const readNamedArtifact = (key: string) =>
	Effect.suspend(() => {
		const filesystem = binding();
		return filesystem
			? Effect.tryPromise({ catch: filesystemError, try: () => filesystem.readNamedArtifact(key) })
			: Effect.fail(missingGrant("Sandbox artifact grant is unavailable", "readNamedArtifact"));
	});

export const writeScratchChunks = (chunks: ReadonlyArray<SandboxScratchChunk>) =>
	Effect.suspend(() => {
		const filesystem = binding();
		if (!filesystem) {
			return Effect.fail(
				missingGrant("Sandbox scratch grant is unavailable", "writeScratchChunks"),
			);
		}
		const encoded = chunks.map(({ name, contents }) => ({
			name,
			contents: typeof contents === "string" ? encoder.encode(contents) : contents,
		}));
		return Effect.tryPromise({
			catch: filesystemError,
			try: () => filesystem.writeScratchChunks(encoded),
		}).pipe(Effect.as({ chunkFiles: encoded.map(({ name }) => name) }));
	});
