import { Option } from "effect";

const KiB = 1024;
const MiB = 1024 * KiB;

const encoder = new TextEncoder();
const stringifyJson = Option.liftThrowable((value: unknown): unknown =>
	Reflect.apply(JSON.stringify, JSON, [value]),
);

export const SANDBOX_COMPILER_LIMITS = {
	concurrency: 2,
	timeoutMs: 5_000,
	diagnosticCount: 100,
	javascriptBytes: MiB,
	memoryBytes: 256 * MiB,
	sourceBytes: 256 * KiB,
	memoryPollIntervalMs: 5,
	manifestBytes: 16 * KiB,
	diagnosticBytes: 256 * KiB,
} as const;

export const utf8ByteLength = (value: string) => encoder.encode(value).byteLength;

export const jsonByteLength = (value: unknown) =>
	Option.match(stringifyJson(value), {
		onNone: () => null,
		onSome: (serialized) => (typeof serialized === "string" ? utf8ByteLength(serialized) : null),
	});
