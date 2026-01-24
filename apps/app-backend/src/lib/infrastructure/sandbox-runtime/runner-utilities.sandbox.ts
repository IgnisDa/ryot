export interface SandboxRunnerLimits {
	readonly resultBytes: number;
	readonly hostCallCount: number;
	readonly httpCallCount: number;
	readonly logEntryBytes: number;
	readonly logEntryCount: number;
	readonly logTotalBytes: number;
	readonly bridgeRequestBytes: number;
	readonly bridgeResponseBytes: number;
	readonly logTruncationMarker: string;
}

export interface SandboxRunnerPayload {
	readonly token: string;
	readonly apiBase: string;
	readonly scriptId: string;
	readonly context?: unknown;
	readonly executionId: string;
	readonly compiledCode: string;
	readonly apiFunctions?: unknown;
	readonly compiledFormat: number;
	readonly limits: SandboxRunnerLimits;
	readonly metadata?: Record<string, unknown>;
}

export interface SandboxRunnerError {
	readonly line?: number;
	readonly phase: string;
	readonly stack?: string;
	readonly column?: number;
	readonly message: string;
}

export interface SandboxLogCollector {
	readonly logs: string[];
	readonly console: {
		readonly log: (...args: unknown[]) => void;
		readonly info: (...args: unknown[]) => void;
		readonly warn: (...args: unknown[]) => void;
		readonly debug: (...args: unknown[]) => void;
		readonly error: (...args: unknown[]) => void;
	};
}

const mathMax = Math.max;
const mathMin = Math.min;
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const reflectApply = Reflect.apply;
const arrayIsArray = Array.isArray;
const nativeError = globalThis.Error;
const nativeNumber = globalThis.Number;
const nativeString = globalThis.String;
const failurePhases = new WeakMap<object, string>();
const jsonStringify = JSON.stringify.bind(JSON);
const encodeText = encoder.encode.bind(encoder);
const decodeText = decoder.decode.bind(decoder);
const getFailurePhase = failurePhases.get.bind(failurePhases);
const setFailurePhase = failurePhases.set.bind(failurePhases);
const truncationDecoder = new TextDecoder("utf-8", { fatal: true });
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const decodeTruncatedText = truncationDecoder.decode.bind(truncationDecoder);
const sourceFramePattern =
	/(?:(?:sandbox-user:)?script\.ts|sandbox-built-in:[a-zA-Z0-9_./-]+\.ts|(?:automations|providers|script-helpers)\/[a-zA-Z0-9_./-]+\.ts):(\d+):(\d+)/;

const ownMethod = <T>(prototype: object, name: string): T => {
	const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
	if (!descriptor) {
		throw new nativeError(`Sandbox runner could not resolve ${name}`);
	}
	return descriptor.value as T;
};

const arrayJoin = ownMethod<(this: readonly unknown[], separator?: string) => string>(
	Array.prototype,
	"join",
);
const arrayPush = ownMethod<(this: unknown[], value: unknown) => number>(Array.prototype, "push");
const regexpExec = ownMethod<(this: RegExp, value: string) => RegExpExecArray | null>(
	RegExp.prototype,
	"exec",
);
const stringTrim = ownMethod<(this: string) => string>(String.prototype, "trim");
const stringSplit = ownMethod<(this: string, separator: string | RegExp) => string[]>(
	String.prototype,
	"split",
);
const typedArraySet = ownMethod<
	(this: Uint8Array, array: ArrayLike<number>, offset?: number) => void
>(typedArrayPrototype, "set");
const stringReplace = ownMethod<
	(this: string, pattern: string | RegExp, replacement: string) => string
>(String.prototype, "replace");
const typedArraySubarray = ownMethod<
	(this: Uint8Array, begin?: number, end?: number) => Uint8Array
>(typedArrayPrototype, "subarray");

const join = (values: readonly unknown[], separator: string): string =>
	reflectApply(arrayJoin, values, [separator]);
const push = <T>(values: T[], value: T): number => reflectApply(arrayPush, values, [value]);
const replace = (value: string, pattern: string | RegExp, replacement: string): string =>
	reflectApply(stringReplace, value, [pattern, replacement]);
const split = (value: string, separator: string | RegExp): string[] =>
	reflectApply(stringSplit, value, [separator]);
const trim = (value: string): string => reflectApply(stringTrim, value, []);

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !arrayIsArray(value);

const formatArg = (value: unknown): string => {
	if (typeof value === "string") {
		return value;
	}
	try {
		return nativeString(jsonStringify(value));
	} catch {
		try {
			return nativeString(value);
		} catch {
			return "[unprintable]";
		}
	}
};

const truncateUtf8 = (value: string, maximumBytes: number): string => {
	const encoded = encodeText(value);
	if (encoded.byteLength <= maximumBytes) {
		return value;
	}

	for (let end = maximumBytes; end >= mathMax(0, maximumBytes - 3); end -= 1) {
		try {
			return decodeTruncatedText(reflectApply(typedArraySubarray, encoded, [0, end]));
		} catch {
			continue;
		}
	}
	return "";
};

export const createLogCollector = (limits: SandboxRunnerLimits): SandboxLogCollector => {
	const logs: string[] = [];
	let totalBytes = 0;
	let truncated = false;
	const marker = limits.logTruncationMarker;
	const markerBytes = encodeText(marker).byteLength;

	const appendMarker = () => {
		if (!truncated) {
			push(logs, marker);
			totalBytes += markerBytes;
			truncated = true;
		}
	};

	const append = (entry: string) => {
		if (truncated) {
			return;
		}
		if (logs.length >= limits.logEntryCount - 1) {
			appendMarker();
			return;
		}

		const entryBytes = encodeText(entry).byteLength;
		if (
			entryBytes <= limits.logEntryBytes &&
			totalBytes + entryBytes + markerBytes <= limits.logTotalBytes
		) {
			push(logs, entry);
			totalBytes += entryBytes;
			return;
		}

		const availableBytes = mathMax(
			0,
			mathMin(limits.logEntryBytes, limits.logTotalBytes - totalBytes - markerBytes),
		);
		const prefix = truncateUtf8(entry, availableBytes);
		if (prefix) {
			push(logs, prefix);
			totalBytes += encodeText(prefix).byteLength;
		}
		appendMarker();
	};

	const write = (prefix: string, args: unknown[]) => {
		let entry = prefix;
		for (let index = 0; index < args.length; index += 1) {
			entry += (index === 0 ? "" : " ") + formatArg(args[index]);
		}
		append(entry);
	};

	return {
		logs,
		console: {
			log: (...args) => write("", args),
			info: (...args) => write("", args),
			warn: (...args) => write("[warn] ", args),
			debug: (...args) => write("", args),
			error: (...args) => write("[error] ", args),
		},
	};
};

export const readBridgeResponse = async (
	response: Response,
	maximumBytes: number,
): Promise<{ body: string; oversized: boolean }> => {
	if (!response.body) {
		return { body: "", oversized: false };
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	for (;;) {
		const next = await reader.read();
		if (next.done) {
			break;
		}
		bytes += next.value.byteLength;
		if (bytes > maximumBytes) {
			await reader.cancel();
			return { body: "", oversized: true };
		}
		push(chunks, next.value);
	}

	const body = new Uint8Array(bytes);
	let offset = 0;
	for (let index = 0; index < chunks.length; index += 1) {
		const chunk = chunks[index];
		if (!chunk) {
			continue;
		}
		reflectApply(typedArraySet, body, [chunk, offset]);
		offset += chunk.byteLength;
	}
	return { body: decodeText(body), oversized: false };
};

export const throwPhase = (phase: string, error: unknown): never => {
	const failure = isRecord(error) ? error : new nativeError(nativeString(error));
	setFailurePhase(failure, phase);
	throw failure;
};

export const failurePhase = (error: unknown, fallback: string): string =>
	isRecord(error) ? (getFailurePhase(error) ?? fallback) : fallback;

const safeErrorProperty = (error: unknown, property: string): string | undefined => {
	try {
		const value = isRecord(error) ? error[property] : undefined;
		return typeof value === "string" ? value : undefined;
	} catch {
		return undefined;
	}
};

const sanitizeMessage = (
	message: string,
	payload: SandboxRunnerPayload | undefined,
	phase: string,
	hasMappedFrames: boolean,
): string => {
	let sanitized = message;
	const secrets = [payload?.token, payload?.apiBase, payload?.executionId];
	for (let index = 0; index < secrets.length; index += 1) {
		const secret = secrets[index];
		if (typeof secret === "string" && secret) {
			sanitized = join(split(sanitized, secret), "[redacted]");
		}
	}
	sanitized = replace(sanitized, /data:text\/javascript[^\s)]*/g, "script.ts");
	sanitized = replace(sanitized, /https?:\/\/127\.0\.0\.1:\d+\/rpc\/[^\s)]*/g, "[bridge]");
	sanitized = replace(sanitized, /file:\/\/\/[^\s)]*/g, "[internal]");
	if (phase === "load" && !hasMappedFrames) {
		const lines = split(sanitized, "\n");
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index];
			if (line && trim(line)) {
				return line;
			}
		}
		return "Sandbox module failed to load";
	}
	return sanitized;
};

export const executionError = (
	error: unknown,
	phase: string,
	payload: SandboxRunnerPayload | undefined,
): SandboxRunnerError => {
	const rawStack = safeErrorProperty(error, "stack") ?? "";
	const frames: Array<{ line: number; column: number }> = [];
	const lines = split(rawStack, "\n");
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line) {
			continue;
		}
		const match = reflectApply(regexpExec, sourceFramePattern, [line]);
		if (!match?.[1] || !match[2]) {
			continue;
		}
		const mappedLine = nativeNumber(match[1]);
		const mappedColumn = nativeNumber(match[2]);
		if (mappedLine > 0 && mappedColumn > 0) {
			push(frames, { line: mappedLine, column: mappedColumn });
		}
		if (frames.length === 10) {
			break;
		}
	}

	let rawMessage = safeErrorProperty(error, "message");
	if (!rawMessage) {
		try {
			rawMessage = nativeString(error);
		} catch {
			rawMessage = "Sandbox execution failed";
		}
	}
	const firstFrame = frames[0];
	let sanitizedStack = "";
	for (let index = 0; index < frames.length; index += 1) {
		const frame = frames[index];
		if (!frame) {
			continue;
		}
		sanitizedStack += `${sanitizedStack ? "\n" : ""}    at script.ts:${frame.line}:${frame.column}`;
	}
	return {
		phase,
		message: sanitizeMessage(rawMessage, payload, phase, frames.length > 0),
		...(firstFrame ? { line: firstFrame.line, column: firstFrame.column } : {}),
		...(sanitizedStack ? { stack: sanitizedStack } : {}),
	};
};

export const validateLimits = (limits: unknown): limits is SandboxRunnerLimits => {
	if (!isRecord(limits)) {
		return false;
	}
	for (const key of [
		"resultBytes",
		"hostCallCount",
		"httpCallCount",
		"logEntryBytes",
		"logEntryCount",
		"logTotalBytes",
		"bridgeRequestBytes",
		"bridgeResponseBytes",
	]) {
		const value = limits[key];
		if (!Number.isSafeInteger(value) || (typeof value === "number" && value <= 0)) {
			return false;
		}
	}
	return typeof limits.logTruncationMarker === "string" && limits.logTruncationMarker.length > 0;
};
