import { getQueryEngineField, normalizeSlug, sortBy } from "@ryot/ts-utils";

import { toEntityImage } from "@/lib/entity-image";

import { formatRoleLabel } from "./people";
import {
	loadQueryEngineEntities,
	type QueryEngineClient,
	type QueryEngineEntityItem,
} from "./query-engine";
import type { UnlinkedCreator } from "./types";

export type RelatedCompany = Pick<UnlinkedCreator, "id" | "image" | "name" | "role">;

type RelatedCompanyRecord = RelatedCompany & {
	position: number;
	order: number | null;
	createdAt: string | null;
};

function readRelatedCompany(
	item: QueryEngineEntityItem,
	position: number,
): RelatedCompanyRecord | null {
	const nameValue = getQueryEngineField(item, "companyName")?.value;
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
	const role = roles.length > 0 ? roles.map(formatRoleLabel).join(", ") : "Company";
	const companyIdValue = getQueryEngineField(item, "companyId")?.value;
	const createdAtValue = getQueryEngineField(item, "relationshipCreatedAt")?.value;
	const orderValue = getQueryEngineField(item, "relationshipOrder")?.value;
	const image = toEntityImage(getQueryEngineField(item, "companyImage")?.value);

	return {
		name,
		role,
		position,
		image: image ?? undefined,
		id: typeof companyIdValue === "string" ? companyIdValue : undefined,
		createdAt: typeof createdAtValue === "string" ? createdAtValue : null,
		order: typeof orderValue === "number" && Number.isFinite(orderValue) ? orderValue : null,
	};
}

export async function loadRelatedCompanies(
	apiClient: QueryEngineClient,
	input: { entityId: string; entitySchemaSlug: string },
) {
	const relationshipSchemaSlug = normalizeSlug(`company to ${input.entitySchemaSlug}`);
	const companies = await loadQueryEngineEntities({
		apiClient,
		errorMessage: "Failed to load related companies",
		requestForPage: (page) => ({
			mode: "entities",
			scope: ["company"],
			pagination: { page, limit: 100 },
			sort: {
				direction: "asc",
				expression: {
					type: "reference",
					reference: {
						path: ["createdAt"],
						type: "relationship-join",
						joinKey: "companyRelationship",
					},
				},
			},
			relationshipJoins: [
				{
					required: true,
					direction: "outgoing",
					relationshipSchemaSlug,
					key: "companyRelationship",
					kind: "latestRelationship",
					targetEntityId: input.entityId,
				},
			],
			fields: [
				{
					key: "companyId",
					expression: {
						type: "reference",
						reference: { type: "entity", slug: "company", path: ["id"] },
					},
				},
				{
					key: "companyName",
					expression: {
						type: "reference",
						reference: { type: "entity", slug: "company", path: ["name"] },
					},
				},
				{
					key: "companyImage",
					expression: {
						type: "reference",
						reference: { type: "entity", slug: "company", path: ["image"] },
					},
				},
				{
					key: "relationshipRoles",
					expression: {
						type: "reference",
						reference: {
							type: "relationship-join",
							path: ["properties", "roles"],
							joinKey: "companyRelationship",
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
							joinKey: "companyRelationship",
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
							joinKey: "companyRelationship",
						},
					},
				},
			],
		}),
		mapItem: (item, position) => readRelatedCompany(item, position),
	});

	return sortBy(companies, [
		(c) => (c.order ?? Number.POSITIVE_INFINITY),
		(c) => c.createdAt ?? "",
		(c) => c.position,
	]).map(({ id, image, name, role }) => ({
		id,
		image,
		name,
		role,
	}));
}
