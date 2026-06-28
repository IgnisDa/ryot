const mathMax = Math.max;
const mathMin = Math.min;
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const reflectApply = Reflect.apply;
const arrayIsArray = Array.isArray;
const failurePhases = new WeakMap();
const nativeError = globalThis.Error;
const nativeNumber = globalThis.Number;
const nativeString = globalThis.String;
const jsonStringify = JSON.stringify.bind(JSON);
const encodeText = encoder.encode.bind(encoder);
const decodeText = decoder.decode.bind(decoder);
const sourceFramePattern =
	/(?:(?:sandbox-user:)?script\.ts|(?:sandbox-built-in:)?(?:providers|triggers|script-helpers)\/[a-zA-Z0-9_./-]+\.ts):(\d+):(\d+)/;
const getFailurePhase = failurePhases.get.bind(failurePhases);
const setFailurePhase = failurePhases.set.bind(failurePhases);
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const truncationDecoder = new TextDecoder("utf-8", { fatal: true });
const decodeTruncatedText = truncationDecoder.decode.bind(truncationDecoder);
const arrayJoin = Object.getOwnPropertyDescriptor(Array.prototype, "join").value;
const arrayPush = Object.getOwnPropertyDescriptor(Array.prototype, "push").value;
const regexpExec = Object.getOwnPropertyDescriptor(RegExp.prototype, "exec").value;
const stringTrim = Object.getOwnPropertyDescriptor(String.prototype, "trim").value;
const stringSplit = Object.getOwnPropertyDescriptor(String.prototype, "split").value;
const typedArraySet = Object.getOwnPropertyDescriptor(typedArrayPrototype, "set").value;
const stringReplace = Object.getOwnPropertyDescriptor(String.prototype, "replace").value;
const typedArraySubarray = Object.getOwnPropertyDescriptor(typedArrayPrototype, "subarray").value;

const join = (values, separator) => reflectApply(arrayJoin, values, [separator]);
const push = (values, value) => reflectApply(arrayPush, values, [value]);
const replace = (value, pattern, replacement) =>
	reflectApply(stringReplace, value, [pattern, replacement]);
const split = (value, separator) => reflectApply(stringSplit, value, [separator]);
const trim = (value) => reflectApply(stringTrim, value, []);

export const isRecord = (value) =>
	value !== null && typeof value === "object" && !arrayIsArray(value);

const formatArg = (value) => {
	if (typeof value === "string") {
		return value;
	}
	try {
		return jsonStringify(value);
	} catch {
		try {
			return nativeString(value);
		} catch {
			return "[unprintable]";
		}
	}
};

const truncateUtf8 = (value, maximumBytes) => {
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

export const createLogCollector = (limits) => {
	const logs = [];
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

	const append = (entry) => {
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

	const write = (prefix, args) => {
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

export const readBridgeResponse = async (response, maximumBytes) => {
	if (!response.body) {
		return { body: "", oversized: false };
	}
	const reader = response.body.getReader();
	const chunks = [];
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
		reflectApply(typedArraySet, body, [chunk, offset]);
		offset += chunk.byteLength;
	}
	return { body: decodeText(body), oversized: false };
};

export const throwPhase = (phase, error) => {
	const failure = isRecord(error) ? error : new nativeError(nativeString(error));
	setFailurePhase(failure, phase);
	throw failure;
};

export const failurePhase = (error, fallback) =>
	isRecord(error) ? (getFailurePhase(error) ?? fallback) : fallback;

const safeErrorProperty = (error, property) => {
	try {
		const value = isRecord(error) ? error[property] : undefined;
		return typeof value === "string" ? value : undefined;
	} catch {
		return undefined;
	}
};

const sanitizeMessage = (message, payload, phase, hasMappedFrames) => {
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
			if (trim(lines[index])) {
				return lines[index];
			}
		}
		return "Sandbox module failed to load";
	}
	return sanitized;
};

export const executionError = (error, phase, payload) => {
	const rawStack = safeErrorProperty(error, "stack") ?? "";
	const frames = [];
	const lines = split(rawStack, "\n");
	for (let index = 0; index < lines.length; index += 1) {
		const match = reflectApply(regexpExec, sourceFramePattern, [lines[index]]);
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
		sanitizedStack += `${sanitizedStack ? "\n" : ""}    at script.ts:${frame.line}:${frame.column}`;
	}
	return {
		phase,
		message: sanitizeMessage(rawMessage, payload, phase, frames.length > 0),
		...(firstFrame ? { line: firstFrame.line, column: firstFrame.column } : {}),
		...(sanitizedStack ? { stack: sanitizedStack } : {}),
	};
};

export const validateLimits = (limits) => {
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
		if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) {
			return false;
		}
	}
	return typeof limits.logTruncationMarker === "string" && limits.logTruncationMarker.length > 0;
};

export default "";
