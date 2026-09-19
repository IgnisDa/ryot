import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castJson,
	column,
	count,
	defineRecipe,
	eq,
	exists,
	first,
	inArray,
	join,
	jsonPath,
	literal,
	selectedField,
	selectedRows,
	table,
	type SelectedSelection,
} from "@ryot-app/plugin-kit/ryotql";

import {
	entityIdentitySelection,
	entitySchema,
	propertyNumber,
	propertyText,
	type Table,
} from "./entity-selections";
import type { MediaImage } from "./media-image";
import { MediaImageListSchema } from "./media-image";
import {
	mediaCreditQueries,
	mediaEntitySummarySelection,
	mediaReviewActivityRecipe,
	mediaSummaryQueries,
	mediaSummaryResult,
} from "./media-recipes";
import {
	creatorGroupTargetSlugs,
	mediaGroupMemberSlugs,
	type MediaGroupSlug,
} from "./media-schema-slugs";

const MEDIA_GROUP_PRESENTATION_LIMIT = 100;

type CreditGroupSlug = (typeof creatorGroupTargetSlugs)[number];

const isCreditGroup = (slug: MediaGroupSlug): slug is CreditGroupSlug =>
	creatorGroupTargetSlugs.some((candidate) => candidate === slug);

/** Drops the member artwork, falling back to the first member's covers when the group has no images. */
export const withMemberCoverFallback = <
	Row extends {
		readonly images: readonly MediaImage[] | null;
		readonly memberImages: readonly MediaImage[] | null;
	},
>({
	memberImages,
	...row
}: Row) =>
	row.images === null || row.images.length === 0
		? { ...row, images: (memberImages ?? []).filter(({ purpose }) => purpose === "cover") }
		: row;

export const mediaGroupRecipes = <
	const Slug extends MediaGroupSlug,
	const MemberSelection extends SelectedSelection,
>(config: {
	readonly slug: Slug;
	readonly alias: string;
	readonly member: {
		readonly presentationSelection: (entity: Table, alias: string) => MemberSelection;
	};
}) => {
	const memberSlug = mediaGroupMemberSlugs[config.slug];
	const relationshipSlug = `${config.slug}-to-${memberSlug}`;

	const membership = (group: Table, alias: string) => {
		const member = table("entity", `${alias}Member`);
		const relationship = table("relationship", `${alias}Relationship`);
		return {
			member,
			relationship,
			joins: [
				join(
					"inner",
					relationship,
					eq(column(relationship, "targetEntityId"), column(member, "id")),
				),
			],
			where: and(
				entitySchema(member, memberSlug),
				eq(column(relationship, "sourceEntityId"), column(group, "id")),
				eq(column(relationship, "relationshipSchemaSlug"), literal(relationshipSlug)),
			),
		};
	};

	const groupProgressSelection = (group: Table, alias: string) => {
		const all = membership(group, `${alias}All`);
		const completed = membership(group, `${alias}Completed`);
		const completion = table("event", `${alias}CompletionEvent`);
		const cover = membership(group, `${alias}Cover`);
		return {
			memberCount: selectedField(count(all.member, all), Schema.Number),
			parts: selectedField(propertyNumber(group, "parts"), Schema.NullOr(Schema.Number)),
			memberImages: selectedField(
				castJson(
					first(cover.member, {
						...cover,
						select: jsonPath(column(cover.member, "properties"), "images"),
						orderBy: [
							ascending(propertyNumber(cover.relationship, "order")),
							ascending(column(cover.member, "name")),
							ascending(column(cover.member, "id")),
						],
					}),
				),
				MediaImageListSchema,
			),
			completedMemberCount: selectedField(
				count(completed.member, {
					joins: completed.joins,
					where: and(
						completed.where,
						exists(completion, {
							where: and(
								eq(column(completion, "entityId"), column(completed.member, "id")),
								eq(column(completion, "eventSchemaSlug"), literal("complete")),
							),
						}),
					),
				}),
				Schema.Number,
			),
		};
	};

	const summaryRecipe = defineRecipe(
		(input: { readonly entityId: string; readonly collectionLimit: number }) => ({
			map: ({ summary, requested }) =>
				mediaSummaryResult({
					requested,
					summary: summary === undefined ? undefined : withMemberCoverFallback(summary),
				}),
			queries: mediaSummaryQueries({
				...input,
				slug: config.slug,
				include: () => ({}),
				selection: (entity, provider) => ({
					...mediaEntitySummarySelection(entity, provider),
					sourceUrl: selectedField(propertyText(entity, "sourceUrl"), Schema.NullOr(Schema.String)),
					...groupProgressSelection(entity, `${config.alias}Summary`),
				}),
			}),
		}),
	);

	/** Members of one group as a top-level row query, so the list pages by cursor. */
	const membersRecipe = defineRecipe(
		(query: {
			readonly limit: number;
			readonly groupId: string;
			readonly after?: string | undefined;
		}) => {
			const member = table("entity", `${config.alias}Member`);
			const relationship = table("relationship", `${config.alias}MemberRelationship`);
			return {
				map: ({ members }) => Result.succeed(members),
				queries: {
					members: selectedRows(member, {
						limit: query.limit,
						...(query.after === undefined ? {} : { after: query.after }),
						joins: [
							join(
								"inner",
								relationship,
								eq(column(relationship, "targetEntityId"), column(member, "id")),
							),
						],
						orderBy: [
							ascending(propertyNumber(relationship, "order")),
							ascending(column(member, "name")),
							ascending(column(member, "id")),
						],
						where: and(
							entitySchema(member, memberSlug),
							eq(column(relationship, "sourceEntityId"), literal(query.groupId)),
							eq(column(relationship, "relationshipSchemaSlug"), literal(relationshipSlug)),
						),
						selection: {
							...config.member.presentationSelection(member, `${config.alias}Member`),
							position: selectedField(
								propertyNumber(relationship, "order"),
								Schema.NullOr(Schema.Number),
							),
						},
					}),
				},
			};
		},
	);

	const activityRecipe = mediaReviewActivityRecipe(config);

	const presentationRecipe = defineRecipe((entityIds: readonly string[]) => {
		const entity = table("entity", `${config.alias}PresentationEntity`);
		return {
			map: ({ rows }) => Result.succeed(rows.items.map(withMemberCoverFallback)),
			queries: {
				rows: selectedRows(entity, {
					limit: MEDIA_GROUP_PRESENTATION_LIMIT,
					orderBy: [ascending(column(entity, "id"))],
					where: and(
						entitySchema(entity, config.slug),
						inArray(
							column(entity, "id"),
							entityIds.map((requestedId) => literal(requestedId)),
						),
					),
					selection: {
						...entityIdentitySelection(entity),
						images: selectedField(
							castJson(jsonPath(column(entity, "properties"), "images")),
							MediaImageListSchema,
						),
						...groupProgressSelection(entity, `${config.alias}Presentation`),
					},
				}),
			},
		};
	});

	const overviewRecipe = defineRecipe(
		(input: {
			readonly entityId: string;
			readonly peopleLimit: number;
			readonly companyLimit: number;
		}) => ({
			queries: mediaCreditQueries({
				...input,
				slug: config.slug,
				personFields: (): Record<never, never> => ({}),
			}),
		}),
	);

	const recipes = { summaryRecipe, membersRecipe, activityRecipe, presentationRecipe };

	type Credits = Slug extends CreditGroupSlug
		? { readonly overviewRecipe: typeof overviewRecipe }
		: Record<never, never>;
	const creditEntries = isCreditGroup(config.slug) ? { overviewRecipe } : {};
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const credits = creditEntries as Credits;

	return { ...recipes, ...credits };
};
