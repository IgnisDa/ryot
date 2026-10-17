import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { asRecord, type JsonValue } from "@ryot-app/plugin-backend-sdk/wire";

import { MediaSandboxError } from "./failures";

export type UnknownRecord = Record<string, unknown>;

export const isJsonObject = (value: JsonValue): value is Readonly<Record<string, JsonValue>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const jsonObject = (value: JsonValue) => (isJsonObject(value) ? value : null);

export const eventTimestamp = (value: string) => {
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : 0;
};

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

export const scaledRating = (value: number | null, factor: number) =>
	value === null ? null : Math.round(value * factor * 100) / 100;

export const trimmedString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const parseJsonResponse = (responseBody: string, label: string) => {
	try {
		const value: unknown = JSON.parse(responseBody);
		return value;
	} catch {
		throw new Error(`${label} returned invalid JSON`);
	}
};

export const decodeJsonResponse = (responseBody: string, label: string) =>
	Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(responseBody).pipe(
		Effect.mapError(() => new MediaSandboxError({ message: `${label} returned invalid JSON` })),
	);
