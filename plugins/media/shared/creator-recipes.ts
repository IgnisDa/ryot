import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	count,
	defineRecipe,
	descending,
	eq,
	literal,
	join,
	selectedField,
	selectedInclude,
	selectedOptionalRow,
	table,
	type Recipe,
	type SelectedQuery,
	type SelectedRow,
	type SelectedSelection,
} from "@ryot-app/plugin-kit/ryotql";

import {
	entityId,
	entitySchema,
	propertyJson,
	propertyNumber,
	type Table,
} from "./entity-selections";
import {
	creditSelection,
	mediaCollectionEventsQuery,
	mediaEntityEventsQuery,
	mediaEntitySummarySelection,
	mediaReviewEventSelection,
	mediaSummaryQueries,
	mediaSummaryResult,
	mergeMediaActivityEvents,
} from "./media-recipes";
import {
	builtinMediaEntitySchemaSlugs,
	creatorGroupTargetSlugs,
	type MediaCreatorCreditSlug,
} from "./media-schema-slugs";

type MediaTargetSlug = (typeof builtinMediaEntitySchemaSlugs)[number];

type GroupTargetSlug = (typeof creatorGroupTargetSlugs)[number];

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
			entitySchema(credit, input.target),
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

export type MediaCreatorCredit = SelectedRow<ReturnType<typeof creditSelection>> & {
	readonly character?: string | null | undefined;
};

type SelectedQuerySuccess<Query> = Query extends SelectedQuery<infer Success> ? Success : never;

type MediaCreatorActivityCollectionRow = SelectedQuerySuccess<
	ReturnType<typeof mediaCollectionEventsQuery>
>["items"][number];

export type MediaCreatorActivityEvent = ReturnType<
	typeof mergeMediaActivityEvents<
		SelectedRow<ReturnType<typeof mediaReviewEventSelection>>,
		MediaCreatorActivityCollectionRow
	>
>[number];

export type MediaCreatorActivityResult = {
	readonly reviewCount: number;
	readonly truncated: boolean;
	readonly events: readonly MediaCreatorActivityEvent[];
};

export type MediaCreatorOverviewOf<Recipes extends { readonly overviewRecipe: unknown }> =
	Recipe.Success<Recipes["overviewRecipe"]>;

export const mediaCreatorRecipes = <
	const SummaryFields extends SelectedSelection,
	const CreditFields extends SelectedSelection = Record<never, never>,
>(config: {
	readonly slug: string;
	readonly alias: string;
	readonly summaryFields: (entity: Table) => SummaryFields;
	readonly creditFields?: (relationship: Table) => CreditFields;
}) => {
	const summaryRecipe = defineRecipe(
		(input: { readonly entityId: string; readonly collectionLimit: number }) => ({
			map: (result) => mediaSummaryResult(result),
			queries: mediaSummaryQueries({
				...input,
				slug: config.slug,
				selection: (entity, provider) => ({
					...mediaEntitySummarySelection(entity, provider),
					alternateNames: selectedField(
						propertyJson(entity, "alternateNames"),
						Schema.NullOr(Schema.Array(Schema.String)),
					),
					...config.summaryFields(entity),
				}),
			}),
		}),
	);

	const creditFields = (relationship: Table) =>
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		config.creditFields?.(relationship) ?? ({} as CreditFields);

	const overviewRecipe = defineRecipe(
		(input: { readonly entityId: string; readonly creditLimit: number }) => {
			const creator = table("entity", `${config.alias}CreditCreator`);
			const targets = [...builtinMediaEntitySchemaSlugs, ...creatorGroupTargetSlugs];
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion
			const include = Object.fromEntries(
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
							: mediaCreditInclude(credit, creditFields),
					] as const;
				}),
			) as {
				readonly [Target in MediaTargetSlug]: ReturnType<typeof mediaCreditInclude<CreditFields>>;
			} & { readonly [Target in GroupTargetSlug]: ReturnType<typeof groupCreditInclude> };
			const emptyPage = { items: [], pageInfo: { hasMore: false, limit: input.creditLimit } };
			return {
				queries: {
					credits: selectedOptionalRow(creator, {
						include,
						selection: {},
						orderBy: [ascending(column(creator, "id"))],
						where: and(entitySchema(creator, config.slug), entityId(creator, input.entityId)),
					}),
				},
				map: ({ credits }) =>
					Result.succeed(
						credits ??
							// oxlint-disable-next-line typescript/no-unsafe-type-assertion
							(Object.fromEntries(targets.map((target) => [target, emptyPage])) as NonNullable<
								typeof credits
							>),
					),
			};
		},
	);

	const activityRecipe = defineRecipe(
		(input: {
			readonly entityId: string;
			readonly eventLimit: number;
			readonly collectionEventLimit: number;
		}) => {
			const entity = table("entity", `${config.alias}ActivityEntity`);
			const review = table("event", `${config.alias}ReviewCountEvent`);
			return {
				map: ({ totals, events, collectionEvents }) =>
					Result.succeed({
						reviewCount: totals?.reviewCount ?? 0,
						truncated: events.pageInfo.hasMore || collectionEvents.pageInfo.hasMore,
						events: mergeMediaActivityEvents({
							parentEvents: events.items,
							collectionEvents: collectionEvents.items,
						}),
					}),
				queries: {
					collectionEvents: mediaCollectionEventsQuery({
						entityId: input.entityId,
						limit: input.collectionEventLimit,
					}),
					events: mediaEntityEventsQuery({
						slugs: ["review"],
						limit: input.eventLimit,
						entityId: input.entityId,
						alias: `${config.alias}Event`,
						selection: mediaReviewEventSelection,
					}),
					totals: selectedOptionalRow(entity, {
						orderBy: [ascending(column(entity, "id"))],
						where: and(entitySchema(entity, config.slug), entityId(entity, input.entityId)),
						selection: {
							reviewCount: selectedField(
								count(review, {
									where: and(
										eq(column(review, "entityId"), column(entity, "id")),
										eq(column(review, "eventSchemaSlug"), literal("review")),
									),
								}),
								Schema.Number,
							),
						},
					}),
				},
			};
		},
	);

	return { summaryRecipe, overviewRecipe, activityRecipe };
};
