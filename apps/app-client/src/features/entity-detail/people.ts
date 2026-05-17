import { sortBy } from "@ryot/ts-utils/lodash";
import { getQueryEngineField } from "@ryot/ts-utils/query-engine";
import { normalizeSlug } from "@ryot/ts-utils/slug";

import { toEntityImage } from "@/lib/entity-image";

import {
	loadQueryEngineEntities,
	type QueryEngineClient,
	type QueryEngineEntityItem,
} from "./query-engine";
import type { UnlinkedCreator } from "./types";

export function formatRoleLabel(role: string) {
	return role
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[._-]+/g, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map((part) =>
			part === part.toUpperCase() || (/^[a-z]{2,5}$/.test(part) && !/[aeiou]/.test(part))
				? part.toUpperCase()
				: `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`,
		)
		.join(" ");
}

export function mergeCreators(base: UnlinkedCreator[], related: UnlinkedCreator[]) {
	const creatorsById = new Map<string, UnlinkedCreator>();
	const creatorsWithoutId: UnlinkedCreator[] = [];

	for (const creator of [...base, ...related]) {
		if (!creator.id) {
			creatorsWithoutId.push({ ...creator });
			continue;
		}

		const existing = creatorsById.get(creator.id);
		if (!existing) {
			creatorsById.set(creator.id, { ...creator });
			continue;
		}

		const merged: UnlinkedCreator = { ...existing };
		if (!merged.image && creator.image) {
			merged.image = creator.image;
		}
		if (
			creator.role !== "Person" &&
			(merged.role === "Person" || creator.role.length > merged.role.length)
		) {
			merged.role = creator.role;
		}

		creatorsById.set(creator.id, merged);
	}

	return [...creatorsWithoutId, ...creatorsById.values()];
}

function matchesPrimaryCreatorRole(role: string) {
	const normalizedRole = role.toLowerCase();
	return ["director", "creator", "author", "host"].some((needle) =>
		normalizedRole.includes(needle),
	);
}

export function getPrimaryCreator(creators: UnlinkedCreator[]): UnlinkedCreator | undefined {
	if (creators.length === 0) {
		return undefined;
	}

	return creators.find((creator) => matchesPrimaryCreatorRole(creator.role)) ?? creators[0];
}

type RelatedCreator = UnlinkedCreator & {
	position: number;
	order: number | null;
	createdAt: string | null;
};

function readRelatedCreator(item: QueryEngineEntityItem, position: number): RelatedCreator | null {
	const nameValue = getQueryEngineField(item, "personName")?.value;
	const name = typeof nameValue === "string" ? nameValue : null;
	if (!name) {
		return null;
	}

	const roleValues = getQueryEngineField(item, "relationshipRoles")?.value;
	const roles = Array.isArray(roleValues)
		? roleValues.filter(
				(role): role is string => typeof role === "string" && role.trim().length > 0,
			)
		: [];
	const role = roles.length > 0 ? roles.map(formatRoleLabel).join(", ") : "Person";
	const personIdValue = getQueryEngineField(item, "personId")?.value;
	const createdAtValue = getQueryEngineField(item, "relationshipCreatedAt")?.value;
	const orderValue = getQueryEngineField(item, "relationshipOrder")?.value;
	const image = toEntityImage(getQueryEngineField(item, "personImage")?.value);

	return {
		name,
		role,
		position,
		image: image ?? undefined,
		id: typeof personIdValue === "string" ? personIdValue : undefined,
		createdAt: typeof createdAtValue === "string" ? createdAtValue : null,
		order: typeof orderValue === "number" && Number.isFinite(orderValue) ? orderValue : null,
	};
}

export async function loadRelatedCreators(
	apiClient: QueryEngineClient,
	input: { entityId: string; entitySchemaSlug: string },
) {
	const relationshipSchemaSlug = normalizeSlug(`person to ${input.entitySchemaSlug}`);
	const creators = await loadQueryEngineEntities({
		apiClient,
		errorMessage: "Failed to load related creators",
		requestForPage: (page) => ({
			mode: "entities",
			scope: ["person"],
			pagination: { page, limit: 100 },
			sort: {
				direction: "asc",
				expression: {
					type: "reference",
					reference: {
						path: ["createdAt"],
						type: "relationship-join",
						joinKey: "personRelationship",
					},
				},
			},
			relationshipJoins: [
				{
					required: true,
					direction: "outgoing",
					relationshipSchemaSlug,
					key: "personRelationship",
					kind: "latestRelationship",
					targetEntityId: input.entityId,
				},
			],
			fields: [
				{
					key: "personId",
					expression: {
						type: "reference",
						reference: { type: "entity", slug: "person", path: ["id"] },
					},
				},
				{
					key: "personName",
					expression: {
						type: "reference",
						reference: { type: "entity", slug: "person", path: ["name"] },
					},
				},
				{
					key: "personImage",
					expression: {
						type: "reference",
						reference: { type: "entity", slug: "person", path: ["image"] },
					},
				},
				{
					key: "relationshipRoles",
					expression: {
						type: "reference",
						reference: {
							type: "relationship-join",
							path: ["properties", "roles"],
							joinKey: "personRelationship",
						},
					},
				},
				{
					key: "relationshipOrder",
					expression: {
						type: "reference",
						reference: {
							type: "relationship-join",
							path: ["properties", "order"],
							joinKey: "personRelationship",
						},
					},
				},
				{
					key: "relationshipCreatedAt",
					expression: {
						type: "reference",
						reference: {
							path: ["createdAt"],
							type: "relationship-join",
							joinKey: "personRelationship",
						},
					},
				},
			],
		}),
		mapItem: (item, position) => readRelatedCreator(item, position),
	});

	return sortBy(creators, [
		(c) => c.order ?? Number.POSITIVE_INFINITY,
		(c) => c.createdAt ?? "",
		(c) => c.position,
	]).map(({ id, image, name, role }) => ({
		id,
		image,
		name,
		role,
	}));
}
