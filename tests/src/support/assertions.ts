export function requirePresent<T>(value: T, message: string): NonNullable<T> {
	if (!value) {
		throw new Error(message);
	}
	return value;
}

export function assertPresent<T>(value: T, message: string): asserts value is NonNullable<T> {
	if (!value) {
		throw new Error(message);
	}
}

export function assertCondition(condition: boolean, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

export function requireString(value: unknown, message: string): string {
	if (typeof value !== "string") {
		throw new Error(message);
	}
	return value;
}

export function requireNumber(value: unknown, message: string): number {
	if (typeof value !== "number") {
		throw new Error(message);
	}
	return value;
}

export function requireObjectRecord(value: unknown, message: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(message);
	}
	return Object.fromEntries(Object.entries(value));
}

export function requireArray(value: unknown, message: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(message);
	}
	return value;
}

function isNonEmptyArray<T>(arr: readonly T[]): arr is [T, ...T[]] {
	return arr.length > 0;
}

export function requireNonEmptyArray<T>(
	value: readonly T[] | undefined,
	message: string,
): [T, ...T[]] {
	if (!value || !isNonEmptyArray(value)) {
		throw new Error(message);
	}
	return value;
}

export function assertCompleted<T extends { status: string }>(
	result: T,
	label: string,
): asserts result is Extract<T, { status: "completed" }> {
	if (result.status !== "completed") {
		const detail = "error" in result && typeof result.error === "string" ? `: ${result.error}` : "";
		throw new Error(`Expected ${label} to complete, got '${result.status}'${detail}`);
	}
}

export function assertTaggedError<E extends { readonly _tag: string }, T extends E["_tag"]>(
	error: E,
	tag: T,
): asserts error is Extract<E, { readonly _tag: T }> {
	if (error._tag !== tag) {
		throw new Error(`Expected error tag '${tag}' but received '${error._tag}'`);
	}
}
