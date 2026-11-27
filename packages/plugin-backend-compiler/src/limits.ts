import { Option } from "effect";

const KiB = 1024;
const MiB = 1024 * KiB;

const encoder = new TextEncoder();
const stringifyJson = Option.liftThrowable((value: unknown): unknown =>
	Reflect.apply(JSON.stringify, JSON, [value]),
);

export const SANDBOX_COMPILER_LIMITS = {
	concurrency: 2,
	cpuTimeMs: 5_000,
	// Below the sandbox execution timeout, so an overloaded host reports the compiler as unavailable.
	timeoutMs: 20_000,
	diagnosticCount: 100,
	javascriptBytes: MiB,
	responseBytes: 8 * MiB,
	memoryBytes: 768 * MiB,
	sourceBytes: 256 * KiB,
	idleTimeoutMs: 300_000,
	memoryPollIntervalMs: 5,
	manifestBytes: 16 * KiB,
	startupTimeoutMs: 30_000,
	diagnosticBytes: 256 * KiB,
	recycleMemoryBytes: 512 * MiB,
	goMemoryLimitBytes: 256 * MiB,
	executionAnalysisSteps: 100_000,
} as const;

export const utf8ByteLength = (value: string) => encoder.encode(value).byteLength;

export const jsonByteLength = (value: unknown) =>
	Option.match(stringifyJson(value), {
		onNone: () => null,
		onSome: (serialized) => (typeof serialized === "string" ? utf8ByteLength(serialized) : null),
	});
