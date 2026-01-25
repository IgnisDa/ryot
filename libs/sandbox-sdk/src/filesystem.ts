import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

const encoder = new TextEncoder();
const SANDBOX_FILESYSTEM_KEY = Symbol.for("@ryot/sandbox-sdk/filesystem");

type SandboxFilesystemBinding = {
	readonly readArtifact: () => Promise<Uint8Array>;
	readonly writeScratchChunks: (
		chunks: ReadonlyArray<{ readonly name: string; readonly contents: Uint8Array }>,
	) => Promise<void>;
};

export type SandboxFilesystemError = {
	readonly message: string;
	readonly _tag: "SandboxFilesystemError";
};

export type SandboxScratchChunk = {
	readonly name: string;
	readonly contents: string | Uint8Array;
};

export const sandboxScratchManifestSchema = Schema.Struct({
	chunkFiles: Schema.Array(Schema.String),
});

export type SandboxScratchManifest = Schema.Schema.Type<typeof sandboxScratchManifestSchema>;

const filesystemError = (error: unknown): SandboxFilesystemError => ({
	_tag: "SandboxFilesystemError",
	message: error instanceof Error ? error.message : String(error),
});

const binding = () =>
	(globalThis as typeof globalThis & { [SANDBOX_FILESYSTEM_KEY]?: SandboxFilesystemBinding })[
		SANDBOX_FILESYSTEM_KEY
	];

export const readArtifact = () =>
	Effect.suspend(() => {
		const filesystem = binding();
		return filesystem
			? Effect.tryPromise({ try: () => filesystem.readArtifact(), catch: filesystemError })
			: Effect.fail(filesystemError("Sandbox artifact grant is unavailable"));
	});

export const writeScratchChunks = (chunks: ReadonlyArray<SandboxScratchChunk>) =>
	Effect.suspend(() => {
		const filesystem = binding();
		if (!filesystem) {
			return Effect.fail(filesystemError("Sandbox scratch grant is unavailable"));
		}
		const encoded = chunks.map(({ name, contents }) => ({
			name,
			contents: typeof contents === "string" ? encoder.encode(contents) : contents,
		}));
		return Effect.tryPromise({
			try: () => filesystem.writeScratchChunks(encoded),
			catch: filesystemError,
		}).pipe(Effect.as({ chunkFiles: encoded.map(({ name }) => name) }));
	});
