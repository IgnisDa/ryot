import { stableStringify } from "@ryot/ts-utils/json";

export const sandboxArtifactLimits = {
	maxLogs: 100,
	maxLogBytes: 4 * 1024,
	maxErrorBytes: 16 * 1024,
	maxValueBytes: 64 * 1024,
	maxTotalLogBytes: 64 * 1024,
} as const;

export const providerSandboxArtifactLimits = {
	maxValueBytes: 4 * 1024 * 1024,
} as const;

const truncationMarker = "…[truncated]";
export const utf8ByteLength = (value: string) => new TextEncoder().encode(value).byteLength;

const truncateUtf8 = (value: string, maximumBytes: number) => {
	if (utf8ByteLength(value) <= maximumBytes) {
		return value;
	}
	const markerBytes = utf8ByteLength(truncationMarker);
	let output = "";
	for (const character of value) {
		if (utf8ByteLength(output) + utf8ByteLength(character) + markerBytes > maximumBytes) {
			break;
		}
		output += character;
	}
	return `${output}${truncationMarker}`;
};

export const boundSandboxError = (error: string | null) =>
	error === null ? null : truncateUtf8(error, sandboxArtifactLimits.maxErrorBytes);

export const boundSandboxLogs = (logs: ReadonlyArray<string>) => {
	const bounded: string[] = [];
	let truncated = logs.length > sandboxArtifactLimits.maxLogs;
	for (const log of logs.slice(0, sandboxArtifactLimits.maxLogs)) {
		const entry = truncateUtf8(log, sandboxArtifactLimits.maxLogBytes);
		if (
			utf8ByteLength(stableStringify([...bounded, entry])) > sandboxArtifactLimits.maxTotalLogBytes
		) {
			truncated = true;
			break;
		}
		bounded.push(entry);
		if (entry !== log) {
			truncated = true;
		}
	}
	if (truncated) {
		const marker = "[logs truncated]";
		while (
			utf8ByteLength(stableStringify([...bounded, marker])) > sandboxArtifactLimits.maxTotalLogBytes
		) {
			bounded.pop();
		}
		bounded.push(marker);
	}
	return bounded;
};

export const boundSandboxValue = (value: unknown) => {
	const serialized = stableStringify(value);
	return utf8ByteLength(serialized) <= sandboxArtifactLimits.maxValueBytes
		? ({ kind: "accepted", value } as const)
		: ({ kind: "result_too_large", byteSize: utf8ByteLength(serialized) } as const);
};

export const boundProviderSandboxValue = (value: unknown) => {
	const serialized = stableStringify(value);
	const byteSize = utf8ByteLength(serialized);
	if (byteSize > providerSandboxArtifactLimits.maxValueBytes) {
		return { kind: "result_too_large" as const, byteSize };
	}
	if (byteSize <= sandboxArtifactLimits.maxValueBytes) {
		return { kind: "accepted" as const, value };
	}
	return { kind: "artifact" as const, byteSize };
};
