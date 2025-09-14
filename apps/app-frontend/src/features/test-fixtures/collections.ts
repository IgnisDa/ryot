import type { AppCollection } from "~/features/collections/model";
import { queryEngineEntityFieldKeys } from "~/features/entities/model";
import type { ApiPostResponseData } from "~/lib/api/types";

type ApiQueryEngineCollection =
	ApiPostResponseData<"/query-engine/execute">["items"][number];

type CollectionField = ApiQueryEngineCollection[number];

function createJsonField(key: string, value: unknown): CollectionField {
	return { key, kind: "json", value };
}

export function createQueryEngineCollectionFixture(
	overrides: Partial<{
		id: string;
		name: string;
		image: unknown;
		createdAt: string;
		updatedAt: string;
		fields: CollectionField[];
	}> = {},
): ApiQueryEngineCollection {
	const id = overrides.id ?? "collection-1";
	const name = overrides.name ?? "My Collection";
	const image = overrides.image ?? null;
	const createdAt = overrides.createdAt ?? "2026-03-08T08:00:00.000Z";
	const updatedAt = overrides.updatedAt ?? "2026-03-08T08:30:00.000Z";
	return [
		{ key: queryEngineEntityFieldKeys.id, kind: "text", value: id },
		{ key: queryEngineEntityFieldKeys.name, kind: "text", value: name },
		{
			key: queryEngineEntityFieldKeys.image,
			kind: image ? "image" : "null",
			value: image,
		},
		{
			key: queryEngineEntityFieldKeys.createdAt,
			kind: "date",
			value: createdAt,
		},
		{
			key: queryEngineEntityFieldKeys.updatedAt,
			kind: "date",
			value: updatedAt,
		},
		{
			key: queryEngineEntityFieldKeys.externalId,
			kind: "null",
			value: null,
		},
		{
			key: queryEngineEntityFieldKeys.sandboxScriptId,
			kind: "null",
			value: null,
		},
		...(overrides.fields ?? []),
	];
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
	fields: Record<string, { type: string; label: string; description: string }>,
) {
	return { fields };
}

export function createQueryEngineCollectionWithSchema(
	id: string,
	name: string,
	schema: {
		fields: Record<
			string,
			{ type: string; label: string; description: string }
		>;
	},
): ApiQueryEngineCollection {
	return createQueryEngineCollectionFixture({
		id,
		name,
		fields: [createJsonField("membershipPropertiesSchema", schema)],
	});
}
