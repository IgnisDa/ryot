import { SandboxBoundaryReason } from "@ryot-app/contract/modules/sandbox/boundary-reason";
import type { SandboxExecutionError } from "@ryot-app/contract/modules/sandbox/schemas";
import { Schema } from "@ryot-app/sandbox-sdk/effect";

import { SANDBOX_LIMITS } from "./limits";

export type SandboxLogCollector = {
	readonly logs: string[];
	readonly console: {
		readonly log: (...args: unknown[]) => void;
		readonly info: (...args: unknown[]) => void;
		readonly warn: (...args: unknown[]) => void;
		readonly debug: (...args: unknown[]) => void;
		readonly error: (...args: unknown[]) => void;
	};
};

export type SandboxRunnerError = SandboxExecutionError;

const arrayIsArray = Array.isArray;
const arrayJoinMethod = Object.getOwnPropertyDescriptor(Array.prototype, "join")?.value;
const arrayPushMethod = Object.getOwnPropertyDescriptor(Array.prototype, "push")?.value;
const arraySomeMethod = Object.getOwnPropertyDescriptor(Array.prototype, "some")?.value;
const regexpExecMethod = Object.getOwnPropertyDescriptor(RegExp.prototype, "exec")?.value;
const regexpTestMethod = Object.getOwnPropertyDescriptor(RegExp.prototype, "test")?.value;
const stringTrimMethod = Object.getOwnPropertyDescriptor(String.prototype, "trim")?.value;
const stringSplitMethod = Object.getOwnPropertyDescriptor(String.prototype, "split")?.value;
const stringSliceMethod = Object.getOwnPropertyDescriptor(String.prototype, "slice")?.value;
const stringStartsWithMethod = Object.getOwnPropertyDescriptor(
	String.prototype,
	"startsWith",
)?.value;
const stringIncludesMethod = Object.getOwnPropertyDescriptor(String.prototype, "includes")?.value;
const stringReplaceMethod = Object.getOwnPropertyDescriptor(String.prototype, "replace")?.value;
const uint8ArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const uint8ArraySubarrayMethod = Object.getOwnPropertyDescriptor(
	uint8ArrayPrototype,
	"subarray",
)?.value;
const boundArrayJoin = arrayJoinMethod.call.bind(arrayJoinMethod);
const boundArrayPush = arrayPushMethod.call.bind(arrayPushMethod);
const boundArraySome = arraySomeMethod.call.bind(arraySomeMethod);
const boundRegExpExec = regexpExecMethod.call.bind(regexpExecMethod);
const boundRegExpTest = regexpTestMethod.call.bind(regexpTestMethod);
const boundStringTrim = stringTrimMethod.call.bind(stringTrimMethod);
const boundStringSplit = stringSplitMethod.call.bind(stringSplitMethod);
const boundStringSlice = stringSliceMethod.call.bind(stringSliceMethod);
const boundStringStartsWith = stringStartsWithMethod.call.bind(stringStartsWithMethod);
const boundStringIncludes = stringIncludesMethod.call.bind(stringIncludesMethod);
const boundStringReplace = stringReplaceMethod.call.bind(stringReplaceMethod);
const boundUint8ArraySubarray = uint8ArraySubarrayMethod.call.bind(uint8ArraySubarrayMethod);
const nativeError = globalThis.Error;
const nativeNumber = globalThis.Number;
const nativeString = globalThis.String;
const objectDefineProperty = Object.defineProperty;
const textEncoder = new TextEncoder();
const encodeText = textEncoder.encode.bind(textEncoder);
const fatalDecoder = new TextDecoder("utf-8", { fatal: true });
const decodeFatalText = fatalDecoder.decode.bind(fatalDecoder);
const jsonStringify = JSON.stringify.bind(JSON);
const mathMax = Math.max;
const mathMin = Math.min;
const decodeComponent = globalThis.decodeURIComponent;
const decodeBoundaryReason = Schema.decodeUnknownSync(SandboxBoundaryReason, {
	onExcessProperty: "error",
});
const failureKinds = new WeakMap<object, SandboxExecutionError["kind"]>();
const failurePhases = new WeakMap<object, SandboxExecutionError["phase"]>();
const getFailureKind = failureKinds.get.bind(failureKinds);
const setFailureKind = failureKinds.set.bind(failureKinds);
const getFailurePhase = failurePhases.get.bind(failurePhases);
const setFailurePhase = failurePhases.set.bind(failurePhases);
const stackFramePattern = /(?:^|[\s(])([^\s()]+):(\d+):(\d+)\)?$/;
const diagnosticLimit = SANDBOX_LIMITS.diagnostics.stderrBytes;

const join = (values: readonly unknown[], separator: string): string => {
	const result: unknown = boundArrayJoin(values, separator);
	if (typeof result !== "string") {
		throw new nativeError("Sandbox runner could not join diagnostic values");
	}
	return result;
};
const push = <T>(values: T[], value: T): number => {
	const result: unknown = boundArrayPush(values, value);
	if (typeof result !== "number") {
		throw new nativeError("Sandbox runner could not append a diagnostic value");
	}
	return result;
};
const some = <T>(values: readonly T[], predicate: (value: T) => boolean): boolean => {
	const result: unknown = boundArraySome(values, predicate);
	if (typeof result !== "boolean") {
		throw new nativeError("Sandbox runner could not inspect source-map paths");
	}
	return result;
};
const replace = (value: string, pattern: string | RegExp, replacement: string): string => {
	const result: unknown = boundStringReplace(value, pattern, replacement);
	if (typeof result !== "string") {
		throw new nativeError("Sandbox runner could not sanitize diagnostics");
	}
	return result;
};
const split = (value: string, separator: string | RegExp): string[] => {
	const result: unknown = boundStringSplit(value, separator);
	if (!arrayIsArray(result)) {
		throw new nativeError("Sandbox runner could not split diagnostics");
	}
	return result;
};
const slice = (value: string, start?: number, end?: number): string => {
	const result: unknown = boundStringSlice(value, start, end);
	if (typeof result !== "string") {
		throw new nativeError("Sandbox runner could not read diagnostic paths");
	}
	return result;
};
const startsWith = (value: string, search: string): boolean => {
	const result: unknown = boundStringStartsWith(value, search);
	if (typeof result !== "boolean") {
		throw new nativeError("Sandbox runner could not inspect a diagnostic path");
	}
	return result;
};
const includes = (value: string, search: string): boolean => {
	const result: unknown = boundStringIncludes(value, search);
	if (typeof result !== "boolean") {
		throw new nativeError("Sandbox runner could not inspect a diagnostic path");
	}
	return result;
};
const trim = (value: string): string => {
	const result: unknown = boundStringTrim(value);
	if (typeof result !== "string") {
		throw new nativeError("Sandbox runner could not trim a diagnostic line");
	}
	return result;
};
const execRegExp = (expression: RegExp, value: string) => {
	const result: unknown = boundRegExpExec(expression, value);
	if (result === null || arrayIsArray(result)) {
		return result;
	}
	throw new nativeError("Sandbox runner could not parse a diagnostic frame");
};
const testRegExp = (expression: RegExp, value: string) => {
	const result: unknown = boundRegExpTest(expression, value);
	if (typeof result !== "boolean") {
		throw new nativeError("Sandbox runner could not inspect a diagnostic frame");
	}
	return result;
};
const uint8ArraySubarray = (bytes: Uint8Array, begin: number, end: number) => {
	const result: unknown = boundUint8ArraySubarray(bytes, begin, end);
	if (!(result instanceof Uint8Array)) {
		throw new nativeError("Sandbox runner could not truncate UTF-8 bytes");
	}
	return result;
};

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
			return decodeFatalText(uint8ArraySubarray(encoded, 0, end));
		} catch {
			continue;
		}
	}
	return "";
};

export const createLogCollector = (limits: {
	readonly logEntryBytes: number;
	readonly logEntryCount: number;
	readonly logTotalBytes: number;
	readonly logTruncationMarker: string;
}): SandboxLogCollector => {
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
			debug: (...args) => write("", args),
			warn: (...args) => write("[warn] ", args),
			error: (...args) => write("[error] ", args),
		},
	};
};

export const throwPhase = (
	phase: SandboxExecutionError["phase"],
	error: unknown,
	kind?: SandboxExecutionError["kind"],
): never => {
	const failure =
		error instanceof nativeError
			? error
			: new nativeError(
					isRecord(error) && typeof error["message"] === "string"
						? error["message"]
						: nativeString(error),
				);
	if (!(error instanceof nativeError) && isRecord(error) && error["data"] !== undefined) {
		objectDefineProperty(failure, "data", { value: error["data"] });
	}
	setFailurePhase(failure, phase);
	if (kind !== undefined) {
		setFailureKind(failure, kind);
	}
	throw failure;
};

export const failurePhase = (
	error: unknown,
	fallback: SandboxExecutionError["phase"],
): SandboxExecutionError["phase"] =>
	isRecord(error) ? (getFailurePhase(error) ?? fallback) : fallback;

export const failureKind = (
	error: unknown,
	fallback: SandboxExecutionError["kind"],
): SandboxExecutionError["kind"] =>
	isRecord(error) ? (getFailureKind(error) ?? fallback) : fallback;

const safeErrorProperty = (error: unknown, property: string): string | undefined => {
	try {
		const value = isRecord(error) ? error[property] : undefined;
		return typeof value === "string" ? value : undefined;
	} catch {
		return undefined;
	}
};

const boundaryErrorData = (error: unknown) => {
	try {
		return decodeBoundaryReason(isRecord(error) ? error["data"] : undefined);
	} catch {
		return undefined;
	}
};

const decodeUrlPath = (value: string) => {
	try {
		return decodeComponent(value);
	} catch {
		return value;
	}
};

const authoredPath = (source: string, specifier: string) => {
	if (source === specifier) {
		return undefined;
	}
	const modulePrefix = `${specifier}/`;
	const virtualPrefix = "ryot-module:/";
	let path: string | undefined;
	if (startsWith(source, modulePrefix)) {
		path = decodeUrlPath(slice(source, modulePrefix.length));
	} else if (startsWith(source, virtualPrefix)) {
		path = decodeUrlPath(slice(source, virtualPrefix.length));
	}
	const hasTraversal = some(split(path ?? "", "/"), (part) => part === ".." || part === ".");
	if (
		!path ||
		startsWith(path, "/") ||
		includes(path, "\\") ||
		hasTraversal ||
		startsWith(path, "external/") ||
		startsWith(path, "runtime/") ||
		startsWith(path, "bootstrap/") ||
		startsWith(path, "@ryot-app/") ||
		testRegExp(/^[a-f0-9]{64}\.js$/, path) ||
		testRegExp(/^[a-z][a-z0-9+.-]*:/i, path)
	) {
		return undefined;
	}
	return path;
};

const redact = (message: string, secret: string | undefined) =>
	secret ? join(split(message, secret), "[redacted]") : message;

const sanitizeMessage = (
	message: string,
	invocation:
		| {
				readonly executionId: string;
				readonly scriptId?: string | undefined;
				readonly workflowExecutionId?: string | undefined;
		  }
		| undefined,
	specifier: string,
	phase: SandboxExecutionError["phase"],
	hasMappedFrames: boolean,
) => {
	let sanitized = replace(message, /file:\/\/\/[^\s)]*/g, "[internal]");
	sanitized = redact(sanitized, specifier);
	sanitized = redact(sanitized, invocation?.executionId);
	sanitized = redact(sanitized, invocation?.scriptId);
	sanitized = redact(sanitized, invocation?.workflowExecutionId);
	sanitized = replace(sanitized, /ryot-module:\/\/[^\s)]*/g, "[internal]");
	sanitized = replace(sanitized, /ryot-module:\/[^\s)]*/g, "[internal]");
	sanitized = replace(
		sanitized,
		/\/(?:sandboxd|sandbox|runtime|bootstrap)\/[^\s)]*/g,
		"[internal]",
	);
	sanitized = replace(sanitized, /data:text\/javascript[^\s)]*/g, "script.ts");
	sanitized = replace(sanitized, /https?:\/\/[^\s)]*/g, "[external URL]");
	if (phase === "load" && !hasMappedFrames) {
		for (const line of split(sanitized, "\n")) {
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
	phase: SandboxExecutionError["phase"],
	invocation:
		| {
				readonly executionId: string;
				readonly scriptId?: string | undefined;
				readonly workflowExecutionId?: string | undefined;
		  }
		| undefined,
	specifier: string,
	kind: SandboxExecutionError["kind"],
): SandboxExecutionError => {
	const rawStack = safeErrorProperty(error, "stack") ?? "";
	const frames: Array<{ path: string; line: number; column: number }> = [];
	for (const line of split(rawStack, "\n")) {
		const match = execRegExp(stackFramePattern, trim(line));
		if (!match?.[1] || !match[2] || !match[3]) {
			continue;
		}
		const path = authoredPath(match[1], specifier);
		const mappedLine = nativeNumber(match[2]);
		const mappedColumn = nativeNumber(match[3]);
		const containsIdentifier =
			path !== undefined &&
			some(
				[invocation?.executionId, invocation?.scriptId, invocation?.workflowExecutionId],
				(identifier) =>
					identifier !== undefined && identifier.length > 0 && includes(path, identifier),
			);
		if (path && !containsIdentifier && mappedLine > 0 && mappedColumn > 0) {
			push(frames, { path, line: mappedLine, column: mappedColumn });
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
	const data = boundaryErrorData(error);
	const firstFrame = frames[0];
	let stack = "";
	for (const frame of frames) {
		const next = `${stack ? "\n" : ""}    at ${frame.path}:${frame.line}:${frame.column}`;
		if (encodeText(stack + next).byteLength > diagnosticLimit / 2) {
			break;
		}
		stack += next;
	}
	const message = truncateUtf8(
		sanitizeMessage(rawMessage, invocation, specifier, phase, frames.length > 0),
		diagnosticLimit / 2,
	);
	return {
		...(data ? { data } : {}),
		kind,
		phase,
		message,
		...(firstFrame ? { line: firstFrame.line, column: firstFrame.column } : {}),
		...(stack ? { stack } : {}),
	};
};

export const utf8ByteLength = (value: string) => encodeText(value).byteLength;
