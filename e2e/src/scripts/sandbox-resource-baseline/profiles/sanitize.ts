const MAX_ARRAY_ENTRIES = 200;
const MAX_STRING_LENGTH = 200;

const sensitiveKey = /token|authorization|cookie|password|secret|externalid|userid|executionid/i;
const externalIdKey = /externalid/i;
const youtubeId = /^[A-Za-z0-9_-]{11}$/;

const stringRules: ReadonlyArray<readonly [RegExp, string]> = [
	[/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, "UUID"],
	[/[0-9a-f]{20,}/i, "long hex run"],
	[/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, "JWT-like token"],
	[/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "email address"],
	[/https?:\/\//i, "URL"],
	[/bearer\s/i, "bearer credential"],
];

const stringFindings = (value: string) => [
	...stringRules.filter(([pattern]) => pattern.test(value)).map(([, reason]) => reason),
	...(value.length > MAX_STRING_LENGTH ? [`string longer than ${MAX_STRING_LENGTH}`] : []),
];

/**
 * Reports `path: reason` for every value in a summary that could carry a secret or an identifier,
 * and for arrays that are not bounded. Keys are checked as well as values.
 */
export const findSensitiveStrings = (value: unknown, path = "$"): ReadonlyArray<string> => {
	if (typeof value === "string") {
		return stringFindings(value).map((reason) => `${path}: ${reason}`);
	}
	if (Array.isArray(value)) {
		return [
			...(value.length > MAX_ARRAY_ENTRIES
				? [`${path}: array has ${value.length} entries (max ${MAX_ARRAY_ENTRIES})`]
				: []),
			...value.flatMap((entry, index) => findSensitiveStrings(entry, `${path}[${index}]`)),
		];
	}
	if (typeof value !== "object" || value === null) {
		return [];
	}
	const findings: Array<string> = [];
	for (const [key, entry] of Object.entries(value)) {
		const entryPath = `${path}.${key}`;
		findings.push(...stringFindings(key).map((reason) => `${entryPath}: key is a ${reason}`));
		if (sensitiveKey.test(key)) {
			findings.push(`${entryPath}: sensitive key name`);
		}
		if (externalIdKey.test(key) && typeof entry === "string" && youtubeId.test(entry)) {
			findings.push(`${entryPath}: external video identifier`);
		}
		findings.push(...findSensitiveStrings(entry, entryPath));
	}
	return findings;
};

export class UnsanitizedSummaryError extends Error {
	constructor(readonly findings: ReadonlyArray<string>) {
		super(`summary contains sensitive or unbounded values:\n${findings.join("\n")}`);
	}
}

export const assertSanitized = (value: unknown) => {
	const findings = findSensitiveStrings(value);
	if (findings.length > 0) {
		throw new UnsanitizedSummaryError(findings);
	}
};
