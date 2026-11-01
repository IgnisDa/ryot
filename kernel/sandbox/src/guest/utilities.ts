import { boundaryReasonOfError } from "@ryot-app/contract/modules/scripts/boundary-reason";
import type { SandboxExecutionError } from "@ryot-app/contract/modules/scripts/schemas";

import { SANDBOX_LIMITS, SANDBOX_LOG_TRUNCATION_MARKER } from "../protocol/limits";
import {
	isBoolean,
	isNumber,
	isString,
	isStringArray,
	regExpExec,
	stringIncludes,
	uint8ArraySubarray,
	uncurry,
} from "./primordials";

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

const arrayIsArray = Array.isArray;
const some = (
	values: ReadonlyArray<string | undefined>,
	predicate: (value: string | undefined) => boolean,
) => {
	for (let index = 0; index < values.length; index += 1) {
		if (predicate(values[index])) {
			return true;
		}
	}
	return false;
};
const join = uncurry(Array.prototype, "join", isString);
const push = uncurry(Array.prototype, "push", isNumber);
const testRegExp = uncurry(RegExp.prototype, "test", isBoolean);
const trim = uncurry(String.prototype, "trim", isString);
const split = uncurry(String.prototype, "split", isStringArray);
const slice = uncurry(String.prototype, "slice", isString);
const startsWith = uncurry(String.prototype, "startsWith", isBoolean);
const replace = uncurry(String.prototype, "replace", isString);
const nativeNumber = globalThis.Number;
const nativeString = globalThis.String;
const textEncoder = new TextEncoder();
const encodeText = textEncoder.encode.bind(textEncoder);
const fatalDecoder = new TextDecoder("utf-8", { fatal: true });
const decodeFatalText = fatalDecoder.decode.bind(fatalDecoder);
const jsonStringify = JSON.stringify.bind(JSON);
const mathMax = Math.max;
const mathMin = Math.min;
const decodeComponent = globalThis.decodeURIComponent;
const stackFramePattern = /(?:^|[\s(])([^\s()]+):(\d+):(\d+)\)?$/;
const diagnosticLimit = SANDBOX_LIMITS.diagnostics.messageBytes;

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

export const createLogCollector = (
	limits: {
		readonly entryBytes: number;
		readonly entryCount: number;
		readonly totalBytes: number;
	} = SANDBOX_LIMITS.logs,
): SandboxLogCollector => {
	const logs: string[] = [];
	let totalBytes = 0;
	let truncated = false;
	const marker = SANDBOX_LOG_TRUNCATION_MARKER;
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
		if (logs.length >= limits.entryCount - 1) {
			appendMarker();
			return;
		}
		const entryBytes = encodeText(entry).byteLength;
		if (
			entryBytes <= limits.entryBytes &&
			totalBytes + entryBytes + markerBytes <= limits.totalBytes
		) {
			push(logs, entry);
			totalBytes += entryBytes;
			return;
		}
		const availableBytes = mathMax(
			0,
			mathMin(limits.entryBytes, limits.totalBytes - totalBytes - markerBytes),
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

const safeErrorProperty = (error: unknown, property: string): string | undefined => {
	try {
		const value = isRecord(error) ? error[property] : undefined;
		return typeof value === "string" ? value : undefined;
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
		stringIncludes(path, "\\") ||
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
		| undefined
		| {
				readonly executionId: string;
				readonly scriptId?: string | undefined;
				readonly workflowExecutionId?: string | undefined;
		  },
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
		| undefined
		| {
				readonly executionId: string;
				readonly scriptId?: string | undefined;
				readonly workflowExecutionId?: string | undefined;
		  },
	specifier: string,
	kind: SandboxExecutionError["kind"],
): SandboxExecutionError => {
	const rawStack = safeErrorProperty(error, "stack") ?? "";
	const frames: Array<{ path: string; line: number; column: number }> = [];
	for (const line of split(rawStack, "\n")) {
		const match = regExpExec(stackFramePattern, trim(line));
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
					identifier !== undefined && identifier.length > 0 && stringIncludes(path, identifier),
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
	const data = boundaryReasonOfError(error);
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
