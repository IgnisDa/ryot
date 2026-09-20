import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const INDEX_LIMIT = 10_000;
export const API_BASE_URL = "https://pokeapi.co/api/v2";

export type PokeApiHost = Pick<ScriptHost, "httpCall">;
export type PokeApiEntry = { readonly id: number; readonly name: string };

export class PokeApiError extends Error {
	readonly _tag = "PokeApiError";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

export const asRecord = (value: unknown) => (isRecord(value) ? value : null);

export const stringValue = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim() : null;

export const integerValue = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;

export const namedValue = (value: unknown) => stringValue(asRecord(value)?.["name"]);

export const titleCase = (value: string) =>
	value
		.split("-")
		.map((word) => (word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word))
		.join(" ");

export const loadJson = (host: PokeApiHost, url: string) =>
	host
		.httpCall("GET", url)
		.pipe(
			Effect.flatMap((response) =>
				Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(response.body).pipe(
					Effect.mapError(() => new PokeApiError(`PokeAPI returned invalid JSON: ${url}`)),
				),
			),
		);

const toEntry = (value: unknown): PokeApiEntry | null => {
	const record = asRecord(value);
	const url = stringValue(record?.["url"]);
	const name = stringValue(record?.["name"]);
	if (!url || !name) {
		return null;
	}
	const segments = url.split("/").filter(Boolean);
	const id = Number(segments[segments.length - 1]);
	return Number.isInteger(id) ? { id, name } : null;
};

export const toEntries = (value: unknown) =>
	(Array.isArray(value) ? value : []).flatMap((item) => {
		const entry = toEntry(item);
		return entry ? [entry] : [];
	});

export const intersectEntries = (groups: ReadonlyArray<ReadonlyArray<PokeApiEntry>>) => {
	const [first, ...rest] = groups;
	if (!first) {
		return [];
	}
	return rest.reduce<ReadonlyArray<PokeApiEntry>>((accumulator, group) => {
		const ids = new Set(group.map((entry) => entry.id));
		return accumulator.filter((entry) => ids.has(entry.id));
	}, first);
};
