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

export function requireString(value: unknown, message: string): string {
	if (typeof value !== "string") {
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

export function requireResponseData<T>(
	response: { status: number },
	data: { data?: T } | undefined,
	message: string,
): T {
	if (response.status !== 200 || data?.data == null) {
		throw new Error(message);
	}

	return data.data;
}
