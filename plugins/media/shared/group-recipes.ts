import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	coalesce,
	column,
	count,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	exists,
	first,
	join,
	literal,
	relationshipSchemaPredicate,
	reportingTimeZone,
	selectedField,
	selectedRows,
	selectedRowsSource,
	type SelectedSelection,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import {
	mediaLocalizedImageOfPurpose,
	preferredMediaImageExpression,
} from "./entity-presentations";
import {
	entityIdentitySelection,
	mediaLibrarySelection,
	propertyNumber,
	propertyText,
	type Table,
} from "./entity-selections";
import { type MediaImage, MediaImageAssetSchema, MediaImageSchema } from "./media-image";
import {
	mediaCompanyRecipe,
	mediaCreditQueries,
	mediaEntityHistoryRecipe,
	mediaEntitySummarySelection,
	mediaPeopleRecipe,
	mediaReviewActivityEventSelection,
	mediaReviewActivityRecipe,
	mediaSummaryQueries,
	mediaSummaryResult,
} from "./media-recipes";
import {
	creatorGroupTargetSlugs,
	mediaGroupMemberSlugs,
	type MediaGroupSlug,
} from "./media-schema-slugs";
import { mediaDetailLimits, mediaEntityParameters, mediaGroupParameters } from "./query-parameters";

type CreditGroupSlug = (typeof creatorGroupTargetSlugs)[number];

const isCreditGroup = (slug: MediaGroupSlug): slug is CreditGroupSlug =>
	creatorGroupTargetSlugs.some((candidate) => candidate === slug);

export const withMemberCoverFallback = <
	Row extends { readonly image: null | MediaImage; readonly memberImage: null | MediaImage },
>({
	image,
	memberImage,
	...row
}: Row) => ({ ...row, image: image ?? memberImage });

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
				eq(column(member, "entitySchemaSlug"), literal(memberSlug)),
				eq(column(member, "entitySchemaPluginId"), column(group, "entitySchemaPluginId")),
				eq(
					column(relationship, "relationshipSchemaPluginId"),
					column(group, "entitySchemaPluginId"),
				),
				eq(column(relationship, "sourceEntityId"), column(group, "id")),
				eq(column(relationship, "relationshipSchemaSlug"), literal(relationshipSlug)),
			),
		};
	};

	const groupCountSelection = (group: Table, alias: string) => {
		const all = membership(group, `${alias}All`);
		const completed = membership(group, `${alias}Completed`);
		const completion = table("event", `${alias}CompletionEvent`);
		return {
			memberCount: selectedField(count(all.member, all), Schema.Finite),
			parts: selectedField(propertyNumber(group, "parts"), Schema.NullOr(Schema.Finite)),
			completedMemberCount: selectedField(
				count(completed.member, {
					joins: completed.joins,
					where: and(
						completed.where,
						exists(completion, {
							where: and(
								eq(column(completion, "entityId"), column(completed.member, "id")),
								eq(
									column(completion, "eventSchemaPluginId"),
									column(group, "entitySchemaPluginId"),
								),
								eq(column(completion, "eventSchemaSlug"), literal("complete")),
							),
						}),
					),
				}),
				Schema.Finite,
			),
		};
	};

	const memberCover = (group: Table, alias: string) => {
		const cover = membership(group, alias);
		return first(cover.member, {
			...cover,
			select: mediaLocalizedImageOfPurpose(cover.member, "cover"),
			orderBy: [
				ascending(propertyNumber(cover.relationship, "order")),
				ascending(column(cover.member, "name")),
				ascending(column(cover.member, "id")),
			],
		});
	};
	const summaryRecipe = (structural: { readonly reference: PluginIdentityReference }) => {
		const input = {
			...mediaDetailLimits,
			timeZone: reportingTimeZone,
			reference: structural.reference,
			entityId: mediaEntityParameters.value("entityId"),
		};
		return defineRecipe({
			parameters: mediaEntityParameters.schema,
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
					...groupCountSelection(entity, `${config.alias}Summary`),
					memberImage: selectedField(
						memberCover(entity, `${config.alias}SummaryCover`),
						Schema.NullOr(MediaImageSchema),
					),
				}),
			}),
		});
	};
	/** Members of one group as a top-level row query, so the list pages by cursor. */
	const membersRecipe = (query: { readonly reference: PluginIdentityReference }) => {
		const inputParameters = mediaGroupParameters;
		const member = table("entity", `${config.alias}Member`);
		const relationship = table("relationship", `${config.alias}MemberRelationship`);
		return defineRecipe({
			parameters: inputParameters.schema,
			map: ({ members }) => Result.succeed(members),
			queries: {
				members: selectedRows(member, {
					limit: 100,
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
						entitySchemaPredicate(member, memberSlug, query.reference),
						eq(column(relationship, "sourceEntityId"), inputParameters.value("groupId")),
						relationshipSchemaPredicate(relationship, relationshipSlug, query.reference),
					),
					selection: {
						...config.member.presentationSelection(member, `${config.alias}Member`),
						...mediaLibrarySelection(member),
						position: selectedField(
							propertyNumber(relationship, "order"),
							Schema.NullOr(Schema.Finite),
						),
					},
				}),
			},
		});
	};
	const activityRecipe = mediaReviewActivityRecipe(config);
	const historyRecipe = mediaEntityHistoryRecipe({
		alias: config.alias,
		slugs: ["review", "add-to-media-library"],
		selection: mediaReviewActivityEventSelection,
	});

	const presentationEntity = table("entity", "entity");
	const presentationSource = selectedRowsSource(presentationEntity, {
		selection: {
			...entityIdentitySelection(presentationEntity),
			image: selectedField(
				coalesce(
					preferredMediaImageExpression(presentationEntity),
					memberCover(presentationEntity, `${config.alias}PresentationCover`),
				),
				Schema.NullOr(MediaImageAssetSchema),
			),
			...groupCountSelection(presentationEntity, `${config.alias}Presentation`),
		},
	});
	const overviewRecipe = (structural: { readonly reference: PluginIdentityReference }) => {
		const input = {
			...mediaDetailLimits,
			timeZone: reportingTimeZone,
			reference: structural.reference,
			entityId: mediaEntityParameters.value("entityId"),
		};
		return defineRecipe({
			parameters: mediaEntityParameters.schema,
			queries: mediaCreditQueries({ ...input, slug: config.slug, personFields: () => ({}) }),
		});
	};
	const peopleRecipe = mediaPeopleRecipe({ ...config, personFields: () => ({}) });
	const recipes = {
		peopleRecipe,
		summaryRecipe,
		membersRecipe,
		historyRecipe,
		activityRecipe,
		presentationSource,
		companiesRecipe: mediaCompanyRecipe(config),
	};

	type Credits = Slug extends CreditGroupSlug
		? { readonly overviewRecipe: typeof overviewRecipe }
		: { readonly overviewRecipe?: undefined };
	const creditEntries = isCreditGroup(config.slug) ? { overviewRecipe } : {};
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const credits = creditEntries as Credits;

	return { ...recipes, ...credits };
};
