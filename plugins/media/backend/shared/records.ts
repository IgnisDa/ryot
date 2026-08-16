export type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
	value !== null && typeof value === "object" && !Array.isArray(value);

export const asRecord = (value: unknown): UnknownRecord | null => (isRecord(value) ? value : null);

export const recordsValue = (value: unknown) =>
	Array.isArray(value)
		? value.flatMap((item) => {
				const record = asRecord(item);
				return record ? [record] : [];
			})
		: [];

export const stringValue = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim() : null;

export const numberValue = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

export const trimmedString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const parseJsonResponse = (responseBody: string, label: string) => {
	try {
		const value: unknown = JSON.parse(responseBody);
		return value;
	} catch {
		throw new Error(`${label} returned invalid JSON`);
	}
};
