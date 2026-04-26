import type { AppCollection } from "~/features/collections/model";
import type { ApiPostResponseData } from "~/lib/api/types";

type ApiQueryEngineCollection =
	ApiPostResponseData<"/query-engine/execute">["items"][number];

type CollectionField = ApiQueryEngineCollection["fields"][number];

function createJsonField(key: string, value: unknown): CollectionField {
	return { key, kind: "json", value };
}

export function createQueryEngineCollectionFixture(
	overrides: Partial<ApiQueryEngineCollection> = {},
): ApiQueryEngineCollection {
	const id = overrides.id ?? "collection-1";
	return {
		id,
		fields: [],
		image: null,
		externalId: null,
		name: "My Collection",
		sandboxScriptId: null,
		createdAt: "2026-03-08T08:00:00.000Z",
		updatedAt: "2026-03-08T08:30:00.000Z",
		...overrides,
	};
}

export function createAppCollectionFixture(
	overrides: Partial<AppCollection> = {},
): AppCollection {
	const id = overrides.id ?? "collection-1";
	return {
		id,
		image: null,
		name: "My Collection",
		entitySchemaSlug: "collection",
		membershipPropertiesSchema: null,
		createdAt: new Date("2026-03-08T08:00:00.000Z"),
		updatedAt: new Date("2026-03-08T08:30:00.000Z"),
		...overrides,
	};
}

export function createMembershipPropertiesSchema(
	fields: Record<string, { type: string; label: string }>,
) {
	return { fields };
}

export function createQueryEngineCollectionWithSchema(
	id: string,
	name: string,
	schema: { fields: Record<string, { type: string; label: string }> },
): ApiQueryEngineCollection {
	return createQueryEngineCollectionFixture({
		id,
		name,
		fields: [createJsonField("membershipPropertiesSchema", schema)],
	});
}
