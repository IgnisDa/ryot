import { getQueryEngineField, normalizeSlug } from "@ryot/ts-utils";

import {
	loadQueryEngineEntities,
	type QueryEngineClient,
	type QueryEngineEntityItem,
} from "./query-engine";

const ENTITY_TYPES_WITH_GROUPS = new Set([
	"book",
	"movie",
	"music",
	"audiobook",
	"comic-book",
	"video-game",
]);

export type RelatedGroup = { id: string; name: string };

export async function loadRelatedGroups(
	apiClient: QueryEngineClient,
	input: { entityId: string; entitySchemaSlug: string },
) {
	if (!ENTITY_TYPES_WITH_GROUPS.has(input.entitySchemaSlug)) {
		return [];
	}

	const groupSchemaSlug = `${input.entitySchemaSlug}-group`;
	const relationshipSchemaSlug = normalizeSlug(
		`${input.entitySchemaSlug}-group to ${input.entitySchemaSlug}`,
	);

	return loadQueryEngineEntities({
		apiClient,
		errorMessage: "Failed to load related groups",
		requestForPage: (page) => ({
			mode: "entities",
			scope: [groupSchemaSlug],
			pagination: { page, limit: 100 },
			sort: {
				direction: "asc",
				expression: {
					type: "reference",
					reference: { type: "entity", slug: groupSchemaSlug, path: ["name"] },
				},
			},
			relationshipJoins: [
				{
					required: true,
					direction: "outgoing",
					key: "groupMembership",
					relationshipSchemaSlug,
					kind: "latestRelationship",
					targetEntityId: input.entityId,
				},
			],
			fields: [
				{
					key: "groupId",
					expression: {
						type: "reference",
						reference: { type: "entity", slug: groupSchemaSlug, path: ["id"] },
					},
				},
				{
					key: "groupName",
					expression: {
						type: "reference",
						reference: { type: "entity", slug: groupSchemaSlug, path: ["name"] },
					},
				},
			],
		}),
		mapItem: (item: QueryEngineEntityItem) => {
			const idValue = getQueryEngineField(item, "groupId")?.value;
			const nameValue = getQueryEngineField(item, "groupName")?.value;
			const id = typeof idValue === "string" ? idValue : null;
			const name = typeof nameValue === "string" ? nameValue : null;
			return id && name ? { id, name } : null;
		},
	});
}
