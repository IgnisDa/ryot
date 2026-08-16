import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castBoolean,
	coalesce,
	column,
	conditional,
	count,
	defineRecipe,
	descending,
	eq,
	eventOrderDescending,
	first,
	inArray,
	isNotNull,
	isNull,
	IsoDateString,
	join,
	jsonPath,
	literal,
	neq,
	selectedField,
	selectedInclude,
	selectedOptionalRow,
	selectedRows,
	sum,
	table,
	type Recipe,
	type SelectedQuery,
	type SelectedRow,
	type SelectedSelection,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId, EntitySchemaSlug, EventId } from "@ryot-app/plugin-kit/schema";

import {
	entityId,
	entityIdentitySelection,
	entitySchema,
	entitySyncSelection,
	libraryLinkExists,
	propertyBoolean,
	propertyJson,
	propertyNumber,
	propertyText,
	type Table,
} from "./entity-selections";
import {
	MediaLifecycleStateSchema,
	mediaLifecycleExpressions,
	type Predicate,
	type ScalarExpression,
} from "./lifecycle-expressions";
import { MediaImageListSchema, MediaImageSchema } from "./media-image";
import { WatchProviderListSchema } from "./watch-provider";

export const libraryOwnership = (entity: Table) => {
	const library = table("entity", "ownershipLibrary");
	const relationship = table("relationship", "ownershipRelationship");
	return castBoolean(
		first(relationship, {
			select: jsonPath(column(relationship, "properties"), "owned"),
			joins: [
				join("inner", library, eq(column(relationship, "targetEntityId"), column(library, "id"))),
			],
			orderBy: [
				descending(column(relationship, "createdAt")),
				ascending(column(relationship, "id")),
			],
			where: and(
				entitySchema(library, "library"),
				eq(column(relationship, "sourceEntityId"), column(entity, "id")),
				eq(column(relationship, "relationshipSchemaSlug"), literal("in-library")),
			),
		}),
	);
};

export const collectionMembershipInclude = (collectionLimit: number) => {
	const entity = table("entity", "entity");
	const collection = table("entity", "memberCollection");
	const membership = table("relationship", "memberCollectionRelationship");

	return selectedInclude(collection, {
		limit: collectionLimit,
		orderBy: [ascending(column(collection, "name")), ascending(column(collection, "id"))],
		joins: [
			join("inner", membership, eq(column(membership, "targetEntityId"), column(collection, "id"))),
		],
		selection: {
			id: selectedField(column(collection, "id"), EntityId),
			name: selectedField(column(collection, "name"), Schema.String),
		},
		where: and(
			entitySchema(collection, "collection"),
			eq(column(membership, "sourceEntityId"), column(entity, "id")),
			eq(column(membership, "relationshipSchemaSlug"), literal("member-of")),
		),
	});
};

export const requestedSchemaQuery = (id: string) => {
	const requested = table("entity", "requested");
	return selectedOptionalRow(requested, {
		where: entityId(requested, id),
		orderBy: [ascending(column(requested, "id"))],
		selection: {
			schemaSlug: selectedField(column(requested, "entitySchemaSlug"), EntitySchemaSlug),
		},
	});
};

export const mediaSummarySelection = (entity: Table, provider: Table) => ({
	...entityIdentitySelection(entity),
	owned: selectedField(libraryOwnership(entity), Schema.NullOr(Schema.Boolean)),
	providerName: selectedField(column(provider, "name"), Schema.NullOr(Schema.String)),
	description: selectedField(propertyText(entity, "description"), Schema.NullOr(Schema.String)),
	publishDate: selectedField(propertyText(entity, "publishDate"), Schema.NullOr(Schema.String)),
	publishYear: selectedField(propertyNumber(entity, "publishYear"), Schema.NullOr(Schema.Number)),
	genres: selectedField(propertyJson(entity, "genres"), Schema.NullOr(Schema.Array(Schema.String))),
	images: selectedField(
		propertyJson(entity, "images"),
		Schema.NullOr(Schema.Array(MediaImageSchema)),
	),
	providerRating: selectedField(
		propertyNumber(entity, "providerRating"),
		Schema.NullOr(Schema.Number),
	),
	productionStatus: selectedField(
		propertyText(entity, "productionStatus"),
		Schema.NullOr(Schema.String),
	),
	isInLibrary: selectedField(
		libraryLinkExists(entity, "inLibraryLibrary", "in-library"),
		Schema.Boolean,
	),
	isMonitored: selectedField(
		libraryLinkExists(entity, "monitoringLibrary", "media-monitoring"),
		Schema.Boolean,
	),
});

export type MediaSummarySelection = ReturnType<typeof mediaSummarySelection>;

export const mediaWatchProviderSelection = (entity: Table) => ({
	watchProviders: selectedField(propertyJson(entity, "watchProviders"), WatchProviderListSchema),
});

const nullableNumberField = (entity: Table, key: string) =>
	selectedField(propertyNumber(entity, key), Schema.NullOr(Schema.Number));

export const mediaNumberSelection =
	<const Keys extends readonly string[]>(...keys: Keys) =>
	(entity: Table) =>
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		Object.fromEntries(keys.map((key) => [key, nullableNumberField(entity, key)])) as {
			[Key in Keys[number]]: ReturnType<typeof nullableNumberField>;
		};

export const creditSelection = (credit: Table, relationship: Table) => ({
	id: selectedField(column(credit, "id"), EntityId),
	name: selectedField(column(credit, "name"), Schema.String),
	images: selectedField(propertyJson(credit, "images"), MediaImageListSchema),
	order: selectedField(propertyNumber(relationship, "order"), Schema.NullOr(Schema.Number)),
	roles: selectedField(
		propertyJson(relationship, "roles"),
		Schema.NullOr(Schema.Array(Schema.String)),
	),
	...entitySyncSelection(credit),
});

export const creditRows = (input: {
	readonly limit: number;
	readonly credit: Table;
	readonly entityId: string;
	readonly relationship: Table;
	readonly creditSchemaSlug: string;
	readonly relationshipSchemaSlug: string;
}) => ({
	limit: input.limit,
	orderBy: [
		ascending(propertyNumber(input.relationship, "order")),
		ascending(column(input.credit, "name")),
	],
	joins: [
		join(
			"inner",
			input.credit,
			eq(column(input.relationship, "sourceEntityId"), column(input.credit, "id")),
		),
	],
	where: and(
		entitySchema(input.credit, input.creditSchemaSlug),
		eq(column(input.relationship, "targetEntityId"), literal(input.entityId)),
		eq(column(input.relationship, "relationshipSchemaSlug"), literal(input.relationshipSchemaSlug)),
	),
});

export const mediaOverviewQueries = (input: {
	readonly slug: string;
	readonly entityId: string;
	readonly peopleLimit: number;
	readonly companyLimit: number;
	readonly recommendationLimit: number;
}) => {
	const person = table("entity", "person");
	const company = table("entity", "company");
	const suggested = table("entity", "suggested");
	const personRelationship = table("relationship", "personRelationship");
	const companyRelationship = table("relationship", "companyRelationship");
	const suggestionRelationship = table("relationship", "suggestionRelationship");
	return {
		companies: selectedRows(companyRelationship, {
			...creditRows({
				credit: company,
				entityId: input.entityId,
				limit: input.companyLimit,
				creditSchemaSlug: "company",
				relationship: companyRelationship,
				relationshipSchemaSlug: `company-to-${input.slug}`,
			}),
			selection: creditSelection(company, companyRelationship),
		}),
		people: selectedRows(personRelationship, {
			...creditRows({
				credit: person,
				entityId: input.entityId,
				limit: input.peopleLimit,
				creditSchemaSlug: "person",
				relationship: personRelationship,
				relationshipSchemaSlug: `person-to-${input.slug}`,
			}),
			selection: {
				...creditSelection(person, personRelationship),
				character: selectedField(
					propertyText(personRelationship, "character"),
					Schema.NullOr(Schema.String),
				),
			},
		}),
		recommendations: selectedRows(suggestionRelationship, {
			limit: input.recommendationLimit,
			orderBy: [ascending(column(suggested, "name"))],
			joins: [
				join(
					"inner",
					suggested,
					eq(column(suggestionRelationship, "targetEntityId"), column(suggested, "id")),
				),
			],
			where: and(
				entitySchema(suggested, input.slug),
				eq(column(suggestionRelationship, "sourceEntityId"), literal(input.entityId)),
				eq(column(suggestionRelationship, "relationshipSchemaSlug"), literal("media-suggestion")),
			),
			selection: {
				id: selectedField(column(suggested, "id"), EntityId),
				name: selectedField(column(suggested, "name"), Schema.String),
				images: selectedField(propertyJson(suggested, "images"), MediaImageListSchema),
				...entitySyncSelection(suggested),
			},
		}),
	};
};

type SelectedQuerySuccess<Query> = Query extends SelectedQuery<infer Success> ? Success : never;

export type MediaOverviewRows = {
	readonly [Key in keyof ReturnType<typeof mediaOverviewQueries>]: SelectedQuerySuccess<
		ReturnType<typeof mediaOverviewQueries>[Key]
	>;
};

export const mediaGroupQuery = (input: {
	readonly limit: number;
	readonly entityId: string;
	readonly groupSlug: string;
	readonly memberSlug: string;
	readonly relationshipSlug: string;
	readonly aliases: { readonly group: string; readonly relationship: string };
}) => {
	const group = table("entity", input.aliases.group);
	const groupRelationship = table("relationship", input.aliases.relationship);
	const member = table("entity", "groupMember");
	const membership = table("relationship", "groupMembership");
	return selectedOptionalRow(group, {
		orderBy: [ascending(column(group, "id"))],
		joins: [
			join(
				"inner",
				groupRelationship,
				eq(column(groupRelationship, "sourceEntityId"), column(group, "id")),
			),
		],
		selection: {
			id: selectedField(column(group, "id"), EntityId),
			name: selectedField(column(group, "name"), Schema.String),
			...entitySyncSelection(group),
		},
		where: and(
			entitySchema(group, input.groupSlug),
			eq(column(groupRelationship, "targetEntityId"), literal(input.entityId)),
			eq(column(groupRelationship, "relationshipSchemaSlug"), literal(input.relationshipSlug)),
		),
		include: {
			members: selectedInclude(member, {
				limit: input.limit,
				joins: [
					join("inner", membership, eq(column(membership, "targetEntityId"), column(member, "id"))),
				],
				orderBy: [
					ascending(propertyNumber(membership, "order")),
					ascending(column(member, "name")),
					ascending(column(member, "id")),
				],
				selection: {
					id: selectedField(column(member, "id"), EntityId),
					name: selectedField(column(member, "name"), Schema.String),
					images: selectedField(propertyJson(member, "images"), MediaImageListSchema),
					...entitySyncSelection(member),
				},
				where: and(
					entitySchema(member, input.memberSlug),
					neq(column(member, "id"), literal(input.entityId)),
					eq(column(membership, "sourceEntityId"), column(group, "id")),
					eq(column(membership, "relationshipSchemaSlug"), literal(input.relationshipSlug)),
				),
			}),
		},
	});
};

export const mediaFlatPresentationSelection = <Duration extends SelectedSelection>(
	entity: Table,
	lifecycle: { readonly state: ScalarExpression; readonly progressPercent: ScalarExpression },
	duration: Duration,
) => ({
	...entityIdentitySelection(entity),
	state: selectedField(lifecycle.state, MediaLifecycleStateSchema),
	images: selectedField(propertyJson(entity, "images"), MediaImageListSchema),
	...duration,
	progressPercent: selectedField(lifecycle.progressPercent, Schema.NullOr(Schema.Number)),
	publishDate: selectedField(propertyText(entity, "publishDate"), Schema.NullOr(Schema.String)),
	publishYear: selectedField(propertyNumber(entity, "publishYear"), Schema.NullOr(Schema.Number)),
	productionStatus: selectedField(
		propertyText(entity, "productionStatus"),
		Schema.NullOr(Schema.String),
	),
});

export type MediaFlatMeasure = (event: Table) => {
	readonly amount: ScalarExpression;
	readonly isUnknown: Predicate;
};

export const mediaTimeSpentMeasure =
	(fallback?: (entity: Table) => ScalarExpression) => (event: Table, entity: Table) => {
		const timeSpent = propertyNumber(event, "timeSpent");
		if (fallback === undefined) {
			return { amount: timeSpent, isUnknown: isNull(timeSpent) };
		}
		const amount = fallback(entity);
		return {
			amount: coalesce(timeSpent, amount),
			isUnknown: and(isNull(timeSpent), isNull(amount)),
		};
	};

export const mediaEntityCountMeasure = (property: string) => (_event: Table, entity: Table) => ({
	amount: propertyNumber(entity, property),
	isUnknown: isNull(propertyNumber(entity, property)),
});

export const mediaFlatConsumptionTotals = (input: {
	readonly entity: Table;
	readonly measure: MediaFlatMeasure;
}) => {
	const { entity, measure } = input;
	const completion = table("event", "mediaCompletionEvent");
	const amount = table("event", "mediaAmountEvent");
	const unknown = table("event", "mediaUnknownAmountEvent");
	const isCompletionOf = (event: Table) =>
		and(
			eq(column(event, "entityId"), column(entity, "id")),
			eq(column(event, "eventSchemaSlug"), literal("complete")),
		);
	return {
		completionCount: selectedField(
			count(completion, { where: isCompletionOf(completion) }),
			Schema.Number,
		),
		unknownAmountCount: selectedField(
			count(unknown, { where: and(isCompletionOf(unknown), measure(unknown).isUnknown) }),
			Schema.Number,
		),
		consumedAmount: selectedField(
			sum(
				amount,
				// Referencing the event row keeps the aggregate inside the subquery when a measure reads only the entity.
				conditional(isNotNull(column(amount, "id")), measure(amount).amount, literal(null)),
				{ where: isCompletionOf(amount) },
			),
			Schema.NullOr(Schema.Number),
		),
	};
};

export const mediaActivityParentSlugs = [
	"backlog",
	"on_hold",
	"dropped",
	"complete",
	"review",
] as const;

export const mediaActivityCollectionSlugs = [
	"add-entity-to-collection",
	"remove-entity-from-collection",
] as const;

export const eventSchemaIsOneOf = (event: Table, slugs: readonly string[]) =>
	inArray(
		column(event, "eventSchemaSlug"),
		slugs.map((slug) => literal(slug)),
	);

export const mediaActivityEventSelection = (event: Table) => ({
	id: selectedField(column(event, "id"), EventId),
	createdAt: selectedField(column(event, "createdAt"), IsoDateString),
	occurredAt: selectedField(column(event, "occurredAt"), IsoDateString),
	text: selectedField(propertyText(event, "text"), Schema.NullOr(Schema.String)),
	rating: selectedField(propertyNumber(event, "rating"), Schema.NullOr(Schema.Number)),
	timeSpent: selectedField(propertyNumber(event, "timeSpent"), Schema.NullOr(Schema.Number)),
	consumedOn: selectedField(propertyText(event, "consumedOn"), Schema.NullOr(Schema.String)),
	isSpoiler: selectedField(propertyBoolean(event, "isSpoiler"), Schema.NullOr(Schema.Boolean)),
});

export const mediaCollectionEventsQuery = (input: {
	readonly limit: number;
	readonly entityId: string;
}) => {
	const collectionEvent = table("event", "collectionEvent");
	const eventCollection = table("entity", "eventCollection");
	return selectedRows(collectionEvent, {
		limit: input.limit,
		orderBy: eventOrderDescending(collectionEvent),
		joins: [
			join(
				"inner",
				eventCollection,
				eq(column(collectionEvent, "entityId"), column(eventCollection, "id")),
			),
		],
		where: and(
			entitySchema(eventCollection, "collection"),
			eventSchemaIsOneOf(collectionEvent, mediaActivityCollectionSlugs),
			eq(propertyText(collectionEvent, "entityId"), literal(input.entityId)),
		),
		selection: {
			id: selectedField(column(collectionEvent, "id"), EventId),
			collectionId: selectedField(column(eventCollection, "id"), EntityId),
			collectionName: selectedField(column(eventCollection, "name"), Schema.String),
			createdAt: selectedField(column(collectionEvent, "createdAt"), IsoDateString),
			occurredAt: selectedField(column(collectionEvent, "occurredAt"), IsoDateString),
			eventSchemaSlug: selectedField(
				column(collectionEvent, "eventSchemaSlug"),
				Schema.Literals(mediaActivityCollectionSlugs),
			),
		},
	});
};

export const mediaFlatActivityParentSlugs = [...mediaActivityParentSlugs, "progress"] as const;

const mediaFlatActivityEventSelection = (event: Table) => ({
	...mediaActivityEventSelection(event),
	startedOn: selectedField(propertyText(event, "startedOn"), Schema.NullOr(IsoDateString)),
	completedOn: selectedField(propertyText(event, "completedOn"), Schema.NullOr(IsoDateString)),
	progressPercent: selectedField(
		propertyNumber(event, "progressPercent"),
		Schema.NullOr(Schema.Number),
	),
	eventSchemaSlug: selectedField(
		column(event, "eventSchemaSlug"),
		Schema.Literals(mediaFlatActivityParentSlugs),
	),
});

export const mediaFlatActivityEventsQuery = <
	const Extra extends SelectedSelection = Record<never, never>,
>(input: {
	readonly limit: number;
	readonly alias: string;
	readonly entityId: string;
	readonly eventFields?: ((event: Table) => Extra) | undefined;
}) => {
	const event = table("event", input.alias);
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const extra: Extra = input.eventFields === undefined ? ({} as Extra) : input.eventFields(event);
	return selectedRows(event, {
		limit: input.limit,
		orderBy: eventOrderDescending(event),
		selection: { ...mediaFlatActivityEventSelection(event), ...extra },
		where: and(
			eq(column(event, "entityId"), literal(input.entityId)),
			eventSchemaIsOneOf(event, mediaFlatActivityParentSlugs),
		),
	});
};

export const compareMediaActivityDescending = (
	left: { readonly id: string; readonly createdAt: string; readonly occurredAt: string },
	right: { readonly id: string; readonly createdAt: string; readonly occurredAt: string },
) =>
	right.occurredAt.localeCompare(left.occurredAt) ||
	right.createdAt.localeCompare(left.createdAt) ||
	right.id.localeCompare(left.id);

type MediaActivityOrdered = {
	readonly id: string;
	readonly createdAt: string;
	readonly occurredAt: string;
};

export const mergeMediaActivityEvents = <
	Parent extends MediaActivityOrdered,
	Collection extends MediaActivityOrdered & {
		readonly collectionId: string;
		readonly collectionName: string;
	},
>(input: {
	readonly parentEvents: readonly Parent[];
	readonly collectionEvents: readonly Collection[];
}) =>
	[
		...input.parentEvents.map((row) => ({ ...row, kind: "media" as const })),
		...input.collectionEvents.map(({ collectionId, collectionName, ...row }) => ({
			...row,
			text: null,
			rating: null,
			timeSpent: null,
			isSpoiler: null,
			consumedOn: null,
			progressPercent: null,
			kind: "collection" as const,
			collection: { id: collectionId, name: collectionName },
		})),
	].sort(compareMediaActivityDescending);

type MediaFlatActivityParentRow = SelectedRow<ReturnType<typeof mediaFlatActivityEventSelection>>;

type MediaActivityCollectionRow = SelectedQuerySuccess<
	ReturnType<typeof mediaCollectionEventsQuery>
>["items"][number];

type MergedFlatActivityEvent = ReturnType<
	typeof mergeMediaActivityEvents<MediaFlatActivityParentRow, MediaActivityCollectionRow>
>[number];

export type MediaFlatActivityMediaEvent<Extra = unknown> = Extract<
	MergedFlatActivityEvent,
	{ readonly kind: "media" }
> &
	Extra;

export type MediaFlatActivityCollectionEvent = Extract<
	MergedFlatActivityEvent,
	{ readonly kind: "collection" }
>;

export type MediaFlatActivityEvent<Extra = unknown> =
	| MediaFlatActivityMediaEvent<Extra>
	| MediaFlatActivityCollectionEvent;

export const mediaUnlinkedCreatorsQuery = (id: string) => {
	const entity = table("entity", "creatorsEntity");
	return selectedOptionalRow(entity, {
		where: entityId(entity, id),
		orderBy: [ascending(column(entity, "id"))],
		selection: {
			unlinkedCreators: selectedField(
				propertyJson(entity, "unlinkedCreators"),
				Schema.NullOr(Schema.Array(Schema.Struct({ name: Schema.String, role: Schema.String }))),
			),
		},
	});
};

export const mediaUnlinkedCreatorsOverviewQueries = (input: { readonly entityId: string }) => ({
	creators: mediaUnlinkedCreatorsQuery(input.entityId),
});

export type MediaUnlinkedCreatorsOverview = {
	readonly creators?:
		| SelectedQuerySuccess<ReturnType<typeof mediaUnlinkedCreatorsQuery>>
		| undefined;
};

const MEDIA_FLAT_PRESENTATION_LIMIT = 100;

export type MediaExtraQueries = Readonly<Record<string, SelectedQuery<unknown>>>;

/** A recipe factory's own overview queries, absent when it declares none. */
export const extraOverviewQueries = <const Extra extends MediaExtraQueries, Input>(
	build: ((input: Input) => Extra) | undefined,
	input: Input,
): Extra =>
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	build === undefined ? ({} as Extra) : build(input);

export type MediaSummaryOf<Recipes extends { readonly summaryRecipe: unknown }> =
	Recipe.Success<Recipes["summaryRecipe"]> extends { readonly summary: infer Summary }
		? NonNullable<Summary>
		: never;

export type MediaActivityOf<Recipes extends { readonly activityRecipe: unknown }> = Recipe.Success<
	Recipes["activityRecipe"]
>;

export type MediaActivityEventOf<Recipes extends { readonly activityRecipe: unknown }> =
	MediaActivityOf<Recipes> extends { readonly events: readonly (infer Event)[] } ? Event : never;

export type MediaPresentationDataOf<Recipes extends { readonly presentationRecipe: unknown }> =
	Recipe.Success<Recipes["presentationRecipe"]> extends readonly (infer Data)[] ? Data : never;

export type MediaFlatOverviewInput = {
	readonly entityId: string;
	readonly groupLimit: number;
	readonly peopleLimit: number;
	readonly companyLimit: number;
	readonly recommendationLimit: number;
};

export const mediaFlatRecipes = <
	const SummaryFields extends SelectedSelection,
	const PresentationFields extends SelectedSelection,
	const ActivityEventFields extends SelectedSelection = Record<never, never>,
	const ExtraOverviewQueries extends MediaExtraQueries = Record<never, never>,
>(config: {
	readonly slug: string;
	readonly alias: string;
	readonly groupSlug?: string;
	readonly measure: (event: Table, entity: Table) => ReturnType<MediaFlatMeasure>;
	readonly summaryFields: (entity: Table) => SummaryFields;
	readonly presentationFields: (entity: Table) => PresentationFields;
	readonly activityEventFields?: (event: Table) => ActivityEventFields;
	readonly extraOverviewQueries?: (input: MediaFlatOverviewInput) => ExtraOverviewQueries;
}) => {
	const summaryRecipe = defineRecipe(
		(input: { readonly entityId: string; readonly collectionLimit: number }) => {
			const entity = table("entity", "entity");
			const provider = table("sandboxProvider", "provider");
			const lifecycle = mediaLifecycleExpressions(entity, `${config.alias}SummaryLifecycle`);
			return {
				map: ({ summary, requested }) =>
					Result.succeed({
						summary: summary ?? null,
						entitySchemaSlug: requested?.schemaSlug ?? null,
					}),
				queries: {
					requested: requestedSchemaQuery(input.entityId),
					summary: selectedOptionalRow(entity, {
						orderBy: [ascending(column(entity, "id"))],
						include: { collections: collectionMembershipInclude(input.collectionLimit) },
						where: and(entitySchema(entity, config.slug), entityId(entity, input.entityId)),
						joins: [
							join("left", provider, eq(column(entity, "providerId"), column(provider, "id"))),
						],
						selection: {
							...mediaSummarySelection(entity, provider),
							state: selectedField(lifecycle.state, MediaLifecycleStateSchema),
							progressPercent: selectedField(
								lifecycle.progressPercent,
								Schema.NullOr(Schema.Number),
							),
							...config.summaryFields(entity),
						},
					}),
				},
			};
		},
	);

	const overviewQueries = (input: MediaFlatOverviewInput) => {
		const { groupSlug } = config;
		const credits = {
			...mediaOverviewQueries({ ...input, slug: config.slug }),
			...extraOverviewQueries(config.extraOverviewQueries, input),
		};
		return groupSlug === undefined
			? credits
			: {
					...credits,
					group: mediaGroupQuery({
						groupSlug,
						memberSlug: config.slug,
						limit: input.groupLimit,
						entityId: input.entityId,
						relationshipSlug: `${groupSlug}-to-${config.slug}`,
						aliases: {
							group: `${config.alias}Group`,
							relationship: `${config.alias}GroupRelationship`,
						},
					}),
				};
	};

	const overviewRecipe = defineRecipe((input: MediaFlatOverviewInput) => ({
		queries: overviewQueries(input),
	}));

	const activityRecipe = defineRecipe(
		(input: {
			readonly entityId: string;
			readonly eventLimit: number;
			readonly collectionEventLimit: number;
		}) => {
			const entity = table("entity", `${config.alias}ActivityEntity`);
			return {
				map: ({ totals, events, collectionEvents }) =>
					Result.succeed({
						completionCount: totals?.completionCount ?? 0,
						consumedAmount: totals?.consumedAmount ?? null,
						unknownAmountCount: totals?.unknownAmountCount ?? 0,
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
					events: mediaFlatActivityEventsQuery({
						limit: input.eventLimit,
						entityId: input.entityId,
						alias: `${config.alias}Event`,
						eventFields: config.activityEventFields,
					}),
					totals: selectedOptionalRow(entity, {
						orderBy: [ascending(column(entity, "id"))],
						where: and(entitySchema(entity, config.slug), entityId(entity, input.entityId)),
						selection: mediaFlatConsumptionTotals({
							entity,
							measure: (event) => config.measure(event, entity),
						}),
					}),
				},
			};
		},
	);

	const presentationRecipe = defineRecipe((entityIds: readonly string[]) => {
		const entity = table("entity", `${config.alias}PresentationEntity`);
		const lifecycle = mediaLifecycleExpressions(entity, `${config.alias}PresentationLifecycle`);
		return {
			map: ({ rows }) => Result.succeed(rows.items),
			queries: {
				rows: selectedRows(entity, {
					limit: MEDIA_FLAT_PRESENTATION_LIMIT,
					orderBy: [ascending(column(entity, "id"))],
					selection: mediaFlatPresentationSelection(
						entity,
						lifecycle,
						config.presentationFields(entity),
					),
					where: and(
						entitySchema(entity, config.slug),
						inArray(
							column(entity, "id"),
							entityIds.map((requestedId) => literal(requestedId)),
						),
					),
				}),
			},
		};
	});

	return { summaryRecipe, overviewRecipe, activityRecipe, presentationRecipe };
};
