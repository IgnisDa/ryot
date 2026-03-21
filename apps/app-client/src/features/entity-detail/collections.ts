import { getQueryEngineField } from "@ryot/ts-utils/query-engine";

import {
	loadQueryEngineEntities,
	type QueryEngineClient,
	type QueryEngineEntityItem,
} from "./query-engine";

export async function loadRelatedCollections(
	apiClient: QueryEngineClient,
	input: { entityId: string },
) {
	return loadQueryEngineEntities({
		apiClient,
		errorMessage: "Failed to load related collections",
		requestForPage: (page) => ({
			mode: "entities",
			scope: ["collection"],
			pagination: { page, limit: 100 },
			sort: {
				direction: "asc",
				expression: {
					type: "reference",
					reference: { type: "entity", slug: "collection", path: ["name"] },
				},
			},
			relationshipJoins: [
				{
					required: true,
					direction: "incoming",
					kind: "latestRelationship",
					key: "collectionMembership",
					sourceEntityId: input.entityId,
					relationshipSchemaSlug: "member-of",
				},
			],
			fields: [
				{
					key: "collectionId",
					expression: {
						type: "reference",
						reference: { type: "entity", slug: "collection", path: ["id"] },
					},
				},
				{
					key: "collectionName",
					expression: {
						type: "reference",
						reference: { type: "entity", slug: "collection", path: ["name"] },
					},
				},
			],
		}),
		mapItem: (item: QueryEngineEntityItem) => {
			const idValue = getQueryEngineField(item, "collectionId")?.value;
			const nameValue = getQueryEngineField(item, "collectionName")?.value;
			const id = typeof idValue === "string" ? idValue : null;
			const name = typeof nameValue === "string" ? nameValue : null;
			return id && name ? { id, name } : null;
		},
	});
}
