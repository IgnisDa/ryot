const KiB = 1024;
const MiB = 1024 * KiB;

const encoder = new TextEncoder();

const artifactBytes = 8 * MiB;
const diagnosticCount = 100;
const diagnosticMessageCharacters = 2_000;

export const CLIENT_PLUGIN_COMPILER_LIMITS = {
	artifactBytes,
	concurrency: 2,
	diagnosticCount,
	sourceBytes: MiB,
	timeoutMs: 30_000,
	assetBytes: 256 * KiB,
	artifactFileCount: 128,
	idleTimeoutMs: 300_000,
	memoryPollIntervalMs: 5,
	memoryBytes: 1024 * MiB,
	startupTimeoutMs: 60_000,
	diagnosticMessageCharacters,
	recycleMemoryBytes: 768 * MiB,
	goMemoryLimitBytes: 384 * MiB,
	responseBytes:
		Math.ceil(artifactBytes / 3) * 4 + diagnosticCount * diagnosticMessageCharacters + 64 * KiB,
} as const;

export const utf8ByteLength = (value: string) => encoder.encode(value).byteLength;
