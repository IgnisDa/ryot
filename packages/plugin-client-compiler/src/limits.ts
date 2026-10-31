const KiB = 1024;
const MiB = 1024 * KiB;

const encoder = new TextEncoder();

export const CLIENT_PLUGIN_COMPILER_LIMITS = {
	concurrency: 2,
	sourceBytes: MiB,
	timeoutMs: 30_000,
	diagnosticCount: 100,
	assetBytes: 256 * KiB,
	artifactFileCount: 128,
	artifactBytes: 8 * MiB,
	memoryPollIntervalMs: 5,
	memoryBytes: 1024 * MiB,
	diagnosticMessageCharacters: 2_000,
} as const;

export const utf8ByteLength = (value: string) => encoder.encode(value).byteLength;
