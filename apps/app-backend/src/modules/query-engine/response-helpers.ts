import { DateTime, Effect, Option } from "effect";

import { isObjectRecord } from "#lib/predicates";

import type { FieldValue, QueryResponse, RowItem, RowValue } from "./language";

const isFieldValue = (value: RowValue | undefined): value is FieldValue =>
	value !== undefined && "kind" in value;

const toIsoString = (value: Date | string) => {
	const parsed = DateTime.make(value instanceof Date ? value.getTime() : value);
	return Option.isSome(parsed) ? DateTime.formatIso(parsed.value) : null;
};

export const requireRowsResponse = Effect.fn("requireRowsResponse")(function* (
	response: QueryResponse,
) {
	if (response.type !== "rows") {
		return yield* Effect.die(`Expected rows response, received ${response.type}`);
	}

	return response;
});

export const requireFieldValue = Effect.fn("requireFieldValue")(function* (
	item: RowItem,
	key: string,
) {
	const value = item[key];
	if (!isFieldValue(value)) {
		return yield* Effect.die(`Expected query-engine field '${key}'`);
	}

	return value;
});

export const requireStringField = Effect.fn("requireStringField")(function* (
	item: RowItem,
	key: string,
) {
	const field = yield* requireFieldValue(item, key);
	if (typeof field.value !== "string") {
		return yield* Effect.die(`Expected query-engine field '${key}' to be a string`);
	}

	return field.value;
});

export const getOptionalStringField = Effect.fn("getOptionalStringField")(function* (
	item: RowItem,
	key: string,
) {
	const field = yield* requireFieldValue(item, key);
	if (field.kind === "null") {
		return null;
	}
	if (typeof field.value !== "string") {
		return yield* Effect.die(`Expected query-engine field '${key}' to be a string or null`);
	}

	return field.value;
});

export const requireIsoStringField = Effect.fn("requireIsoStringField")(function* (
	item: RowItem,
	key: string,
) {
	const field = yield* requireFieldValue(item, key);
	if (field.value instanceof Date) {
		return toIsoString(field.value) ?? field.value.toISOString();
	}
	if (typeof field.value === "string") {
		const isoString = toIsoString(field.value);
		if (isoString) {
			return isoString;
		}
	}

	return yield* Effect.die(`Expected query-engine field '${key}' to be a date`);
});

export const getOptionalIsoStringField = Effect.fn("getOptionalIsoStringField")(function* (
	item: RowItem,
	key: string,
) {
	const field = yield* requireFieldValue(item, key);
	if (field.kind === "null") {
		return null;
	}
	if (field.value instanceof Date) {
		return toIsoString(field.value) ?? field.value.toISOString();
	}
	if (typeof field.value === "string") {
		const isoString = toIsoString(field.value);
		if (isoString) {
			return isoString;
		}
	}

	return yield* Effect.die(`Expected query-engine field '${key}' to be a date or null`);
});

export const requireRecordField = Effect.fn("requireRecordField")(function* (
	item: RowItem,
	key: string,
) {
	const field = yield* requireFieldValue(item, key);
	if (!isObjectRecord(field.value)) {
		return yield* Effect.die(`Expected query-engine field '${key}' to be an object`);
	}

	return field.value;
});
