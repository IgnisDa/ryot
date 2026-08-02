import type { JsonValue } from "@ryot/sandbox-sdk/wire";

const systemRef = (sourceAlias: string, name: string): JsonValue => ({
	type: "ref",
	sourceAlias,
	field: { type: "system", name },
});

const queryField = (key: string, sourceAlias: string, name: string): JsonValue => ({
	key,
	expr: systemRef(sourceAlias, name),
});

const ascending = (sourceAlias: string): JsonValue => ({
	order: "asc",
	expr: systemRef(sourceAlias, "id"),
});

export const buildUserLibraryQuery = () =>
	({
		source: {
			type: "entities",
			alias: "library",
			schemas: ["library"],
			where: { type: "isNotNull", expr: systemRef("library", "userId") },
		},
		output: {
			type: "rows",
			fields: [queryField("entityId", "library", "id")],
			orderBy: [ascending("library")],
			pagination: { page: 1, limit: 1 },
		},
	}) satisfies JsonValue;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const fieldString = (row: UnknownRecord, key: string) => {
	const field = row[key];
	return isRecord(field) && typeof field["value"] === "string" ? field["value"] : null;
};

export const queryFirstEntityId = (response: unknown) => {
	if (!isRecord(response) || !isRecord(response["data"])) {
		return null;
	}
	const items = response["data"]["items"];
	const first = Array.isArray(items) ? items[0] : undefined;
	return isRecord(first) ? fieldString(first, "entityId") : null;
};
