import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	descending,
	entitySchemaPredicate,
	eq,
	join,
	literal,
	parameters,
	type Recipe,
	reportingTimeZone,
	selectedField,
	selectedInclude,
	selectedOptionalRow,
	type SelectedRow,
	selectedRows,
	type SelectedSelection,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { entityId, propertyJson, propertyNumber, type Table } from "./entity-selections";
import {
	type creditCharacterSelection,
	creditSelection,
	mediaEntityHistoryRecipe,
	mediaEntitySummarySelection,
	mediaReviewActivityEventSelection,
	mediaReviewActivityRecipe,
	mediaSummaryQueries,
	mediaSummaryResult,
	relatedRows,
} from "./media-recipes";
import {
	builtinMediaEntitySchemaSlugs,
	creatorGroupTargetSlugs,
	type MediaCreatorCreditSlug,
} from "./media-schema-slugs";
import { mediaDetailLimits, mediaEntityParameters } from "./query-parameters";

type GroupTargetSlug = (typeof creatorGroupTargetSlugs)[number];

type MediaTargetSlug = (typeof builtinMediaEntitySchemaSlugs)[number];

type CreditIncludeInput = {
	readonly slug: string;
	readonly index: number;
	readonly alias: string;
	readonly limit: number;
	readonly creator: Table;
	readonly target: MediaCreatorCreditSlug;
};

/** Credits of one target, correlated to the creator row as the relationship source. */
const creditInclude = <const Selection extends SelectedSelection>(
	input: CreditIncludeInput,
	orderBy: (credit: Table) => Parameters<typeof selectedInclude>[1]["orderBy"],
	selection: (credit: Table, relationship: Table) => Selection,
) => {
	const credit = table("entity", `${input.alias}Credit${input.index}`);
	const relationship = table("relationship", `${input.alias}CreditRelationship${input.index}`);
	return selectedInclude(credit, {
		limit: input.limit,
		orderBy: orderBy(credit),
		selection: selection(credit, relationship),
		joins: [
			join("inner", relationship, eq(column(relationship, "targetEntityId"), column(credit, "id"))),
		],
		where: and(
			eq(column(credit, "entitySchemaSlug"), literal(input.target)),
			eq(column(credit, "entitySchemaPluginId"), column(input.creator, "entitySchemaPluginId")),
			eq(
				column(relationship, "relationshipSchemaPluginId"),
				column(input.creator, "entitySchemaPluginId"),
			),
			eq(column(relationship, "sourceEntityId"), column(input.creator, "id")),
			eq(
				column(relationship, "relationshipSchemaSlug"),
				literal(`${input.slug}-to-${input.target}`),
			),
		),
	});
};

const mediaCreditInclude = <const CreditFields extends SelectedSelection>(
	input: CreditIncludeInput,
	creditFields: (relationship: Table) => CreditFields,
) =>
	creditInclude(
		input,
		(credit) => [
			descending(propertyNumber(credit, "publishYear")),
			ascending(column(credit, "name")),
			ascending(column(credit, "id")),
		],
		(credit, relationship) => ({
			...creditSelection(credit, relationship),
			...creditFields(relationship),
		}),
	);

const groupCreditInclude = (input: CreditIncludeInput) =>
	creditInclude(
		input,
		(credit) => [ascending(column(credit, "name")), ascending(column(credit, "id"))],
		creditSelection,
	);

const isGroupTarget = (target: MediaCreatorCreditSlug): target is GroupTargetSlug =>
	creatorGroupTargetSlugs.some((slug) => slug === target);

export type MediaCreatorOverviewOf<Recipes extends { readonly overviewRecipe: unknown }> =
	Recipes["overviewRecipe"] extends (...args: never[]) => infer RecipeValue
		? Recipe.Success<RecipeValue>
		: never;
export type MediaCreatorCredit = SelectedRow<ReturnType<typeof creditSelection>> & {
	readonly [Key in keyof SelectedRow<ReturnType<typeof creditCharacterSelection>>]?:
		undefined | SelectedRow<ReturnType<typeof creditCharacterSelection>>[Key];
};
export const creatorCreditParameters = parameters({
	fields: {
		...mediaEntityParameters.schema.fields,
		target: {
			type: "enum",
			label: "Credit type",
			validation: { required: true },
			description: "Kind of credited title or group",
			choices: {
				kind: "static",
				values: [...builtinMediaEntitySchemaSlugs, ...creatorGroupTargetSlugs].map((value) => ({
					value,
					label: value,
				})),
			},
		},
	},
});
export const mediaCreatorRecipes = <
	const SummaryFields extends SelectedSelection,
	const CreditFields extends SelectedSelection,
>(config: {
	readonly slug: string;
	readonly alias: string;
	readonly summaryFields: (entity: Table) => SummaryFields;
	readonly creditFields: (relationship: Table) => CreditFields;
}) => {
	const summaryRecipe = (structural: { readonly reference: PluginIdentityReference }) => {
		const input = {
			...mediaDetailLimits,
			timeZone: reportingTimeZone,
			reference: structural.reference,
			entityId: mediaEntityParameters.value("entityId"),
		};
		return defineRecipe({
			parameters: mediaEntityParameters.schema,
			map: (result) => mediaSummaryResult(result),
			queries: mediaSummaryQueries({
				...input,
				slug: config.slug,
				include: () => ({}),
				selection: (entity, provider) => ({
					...mediaEntitySummarySelection(entity, provider),
					alternateNames: selectedField(
						propertyJson(entity, "alternateNames"),
						Schema.NullOr(Schema.Array(Schema.String)),
					),
					...config.summaryFields(entity),
				}),
			}),
		});
	};
	type CreditIncludes = {
		readonly [Target in GroupTargetSlug]: ReturnType<typeof groupCreditInclude>;
	} & { readonly [Target in MediaTargetSlug]: ReturnType<typeof mediaCreditInclude<CreditFields>> };
	const overviewRecipe = (structural: { readonly reference: PluginIdentityReference }) => {
		const input = {
			...mediaDetailLimits,
			timeZone: reportingTimeZone,
			reference: structural.reference,
			entityId: mediaEntityParameters.value("entityId"),
		};
		const creator = table("entity", `${config.alias}CreditCreator`);
		const targets = [...builtinMediaEntitySchemaSlugs, ...creatorGroupTargetSlugs];
		const includeEntries = Object.fromEntries(
			targets.map((target, index) => {
				const credit = {
					index,
					target,
					creator,
					slug: config.slug,
					alias: config.alias,
					limit: input.creditLimit,
				};
				return [
					target,
					isGroupTarget(target)
						? groupCreditInclude(credit)
						: mediaCreditInclude(credit, config.creditFields),
				] as const;
			}),
		);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		const include = includeEntries as CreditIncludes;
		const emptyPage = { items: [], pageInfo: { hasMore: false, limit: input.creditLimit } };
		return defineRecipe({
			parameters: mediaEntityParameters.schema,
			map: ({ credits }) =>
				Result.succeed(
					credits ??
						// oxlint-disable-next-line typescript/no-unsafe-type-assertion
						(Object.fromEntries(targets.map((target) => [target, emptyPage])) as NonNullable<
							typeof credits
						>),
				),
			queries: {
				credits: selectedOptionalRow(creator, {
					include,
					selection: {},
					orderBy: [ascending(column(creator, "id"))],
					where: and(
						entitySchemaPredicate(creator, config.slug, input.reference),
						entityId(creator, input.entityId),
					),
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
	const creditsRecipe = (input: { readonly reference: PluginIdentityReference }) => {
		const credit = table("entity", "credit");
		const relationship = table("relationship", "creditRelationship");
		const targetRows = (target: MediaCreatorCreditSlug) =>
			relatedRows({
				limit: 100,
				relationship,
				related: credit,
				relatedSchemaSlug: target,
				reference: input.reference,
				relatedSide: "targetEntityId",
				entityId: creatorCreditParameters.value("entityId"),
				relationshipSchemaSlug: `${config.slug}-to-${target}`,
				orderBy: [
					...(isGroupTarget(target) ? [] : [descending(propertyNumber(credit, "publishYear"))]),
					ascending(column(credit, "name")),
					ascending(column(credit, "id")),
				],
			});
		const choices = {
			book: targetRows("book"),
			show: targetRows("show"),
			anime: targetRows("anime"),
			movie: targetRows("movie"),
			manga: targetRows("manga"),
			music: targetRows("music"),
			podcast: targetRows("podcast"),
			audiobook: targetRows("audiobook"),
			"comic-book": targetRows("comic-book"),
			"video-game": targetRows("video-game"),
			"music-group": targetRows("music-group"),
			"visual-novel": targetRows("visual-novel"),
			"video-game-group": targetRows("video-game-group"),
		};
		return defineRecipe({
			parameters: creatorCreditParameters.schema,
			map: ({ credits }) => Result.succeed(credits),
			queries: {
				credits: selectedRows(relationship, {
					limit: 30,
					maxLimit: 100,
					joins: targetRows("movie").joins,
					where: creatorCreditParameters.choice("target", {
						book: choices["book"].where,
						show: choices["show"].where,
						anime: choices["anime"].where,
						movie: choices["movie"].where,
						manga: choices["manga"].where,
						music: choices["music"].where,
						podcast: choices["podcast"].where,
						audiobook: choices["audiobook"].where,
						"comic-book": choices["comic-book"].where,
						"video-game": choices["video-game"].where,
						"music-group": choices["music-group"].where,
						"visual-novel": choices["visual-novel"].where,
						"video-game-group": choices["video-game-group"].where,
					}),
					orderBy: creatorCreditParameters.choice("target", {
						book: choices["book"].orderBy,
						show: choices["show"].orderBy,
						anime: choices["anime"].orderBy,
						movie: choices["movie"].orderBy,
						manga: choices["manga"].orderBy,
						music: choices["music"].orderBy,
						podcast: choices["podcast"].orderBy,
						audiobook: choices["audiobook"].orderBy,
						"comic-book": choices["comic-book"].orderBy,
						"video-game": choices["video-game"].orderBy,
						"music-group": choices["music-group"].orderBy,
						"visual-novel": choices["visual-novel"].orderBy,
						"video-game-group": choices["video-game-group"].orderBy,
					}),
					selection: {
						...creditSelection(credit, relationship),
						...Object.fromEntries(
							Object.entries(config.creditFields(relationship)).map(([key, field]) => [
								key,
								selectedField(
									creatorCreditParameters.choice("target", {
										book: field.expr,
										show: field.expr,
										anime: field.expr,
										movie: field.expr,
										manga: field.expr,
										music: field.expr,
										podcast: field.expr,
										audiobook: field.expr,
										"comic-book": field.expr,
										"video-game": field.expr,
										"visual-novel": field.expr,
										"music-group": literal(null),
										"video-game-group": literal(null),
									}),
									field.codec,
								),
							]),
						),
					},
				}),
			},
		});
	};
	return { summaryRecipe, creditsRecipe, historyRecipe, overviewRecipe, activityRecipe };
};
