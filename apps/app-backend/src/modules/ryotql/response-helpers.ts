import type { FieldValue, RowItem, RyotQLResponse } from "@ryot/contract/modules/ryotql/language";
import { DateTime, Effect, Option } from "effect";

const toIsoString = (value: Date | string) => {
	const parsed = DateTime.make(value instanceof Date ? value.getTime() : value);
	return Option.isSome(parsed) ? DateTime.formatIso(parsed.value) : null;
};

export const requireRowsResult = Effect.fn("requireRyotQLRowsResult")(function* (
	response: RyotQLResponse,
	queryName: string,
) {
	const result = response.data[queryName];
	if (!result) {
		return yield* Effect.die(`Expected RyotQL rows result '${queryName}'`);
	}
	return result;
});

export const requireFieldValue = Effect.fn("requireRyotQLFieldValue")(function* (
	item: RowItem,
	key: string,
) {
	const value = item[key];
	if (!value || !("kind" in value)) {
		return yield* Effect.die(`Expected RyotQL field '${key}'`);
	}
	return value;
});

export const requireStringField = Effect.fn("requireRyotQLStringField")(function* (
	item: RowItem,
	key: string,
) {
	const field = yield* requireFieldValue(item, key);
	if (typeof field.value !== "string") {
		return yield* Effect.die(`Expected RyotQL field '${key}' to be a string`);
	}
	return field.value;
});

export const getOptionalStringField = Effect.fn("getOptionalRyotQLStringField")(function* (
	item: RowItem,
	key: string,
) {
	const field = yield* requireFieldValue(item, key);
	if (field.kind === "null") {
		return null;
	}
	if (typeof field.value !== "string") {
		return yield* Effect.die(`Expected RyotQL field '${key}' to be a string or null`);
	}
	return field.value;
});

const optionalIsoString = (field: FieldValue) => {
	if (field.kind === "null") {
		return null;
	}
	if (field.value instanceof Date) {
		return toIsoString(field.value) ?? field.value.toISOString();
	}
	return typeof field.value === "string" ? toIsoString(field.value) : null;
};

export const requireIsoStringField = Effect.fn("requireRyotQLIsoStringField")(function* (
	item: RowItem,
	key: string,
) {
	const value = optionalIsoString(yield* requireFieldValue(item, key));
	if (value === null) {
		return yield* Effect.die(`Expected RyotQL field '${key}' to be a date`);
	}
	return value;
});

export const getOptionalIsoStringField = Effect.fn("getOptionalRyotQLIsoStringField")(function* (
	item: RowItem,
	key: string,
) {
	const field = yield* requireFieldValue(item, key);
	const value = optionalIsoString(field);
	if (field.kind !== "null" && value === null) {
		return yield* Effect.die(`Expected RyotQL field '${key}' to be a date or null`);
	}
	return value;
});
