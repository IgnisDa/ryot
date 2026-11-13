import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castBoolean,
	castText,
	column,
	conditional,
	contains,
	count,
	defineRecipe,
	descending,
	entitySchemaPredicate,
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
	or,
	type Recipe,
	relationshipSchemaPredicate,
	reportingTimeZone,
	schemaOwnerPredicate,
	selectedField,
	selectedInclude,
	type SelectedIncludes,
	type SelectedIncludeValue,
	selectedOptionalRow,
	type SelectedQuery,
	type SelectedRow,
	selectedRows,
	type SelectedRowsSource,
	selectedRowsSource,
	type SelectedSelection,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import {
	EntityId,
	EntitySchemaSlug,
	EventId,
	type PluginIdentityReference,
} from "@ryot-app/plugin-kit/schema";

import { ConsumedOnSelection } from "./consumed-on";
import { MediaPosition } from "./consumption";
import type { ConsumptionMeasureUnit } from "./consumption-allocation";
import { mediaConsumptionTotalsSelection } from "./consumption-recipes";
import { mediaPresentationImageSelection } from "./entity-presentations";
import {
	entityId,
	entityIdentitySelection,
	entitySyncSelection,
	libraryLinkExists,
	mediaLibrarySelection,
	propertyBoolean,
	propertyJson,
	propertyNumber,
	propertyText,
	type Table,
} from "./entity-selections";
import { historyCategory, mediaEventHistoryRecipe } from "./history-recipes";
import {
	mediaLifecycleExpressions,
	MediaLifecycleStateSchema,
	type ScalarExpression,
} from "./lifecycle-expressions";
import { MediaImageListSchema, MediaImageSchema } from "./media-image";
import { isPositional } from "./media-schema-slugs";
import { mediaDetailLimits, mediaEntityParameters } from "./query-parameters";
import { WatchProviderListSchema } from "./watch-provider";

const libraryOwnershipProperty = (entity: Table, key: "owned" | "ownedOn") => {
	const mediaLibrary = table("entity", `${key}MediaLibrary`);
	const relationship = table("relationship", `${key}Relationship`);
	return first(relationship, {
		select: jsonPath(column(relationship, "properties"), key),
		orderBy: [descending(column(relationship, "createdAt")), ascending(column(relationship, "id"))],
		joins: [
			join(
				"inner",
				mediaLibrary,
				eq(column(relationship, "targetEntityId"), column(mediaLibrary, "id")),
			),
		],
		where: and(
			eq(column(mediaLibrary, "entitySchemaSlug"), literal("media-library")),
			eq(column(mediaLibrary, "entitySchemaPluginId"), column(entity, "entitySchemaPluginId")),
			eq(
				column(relationship, "relationshipSchemaPluginId"),
				column(entity, "entitySchemaPluginId"),
			),
			eq(column(relationship, "sourceEntityId"), column(entity, "id")),
			eq(column(relationship, "relationshipSchemaSlug"), literal("in-media-library")),
		),
	});
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
			entitySchemaPredicate(collection, "collection", { kind: "kernel" }),
			eq(column(membership, "sourceEntityId"), column(entity, "id")),
			relationshipSchemaPredicate(membership, "member-of", { kind: "kernel" }),
		),
	});
};

export const mediaGenresInclude = (
	entity: Table,
	slug: string,
	reference: PluginIdentityReference,
) => {
	const genre = table("entity", "genre");
	const relationship = table("relationship", "genreRelationship");

	return selectedInclude(genre, {
		limit: 100,
		orderBy: [ascending(column(genre, "name")), ascending(column(genre, "id"))],
		joins: [
			join("inner", relationship, eq(column(relationship, "targetEntityId"), column(genre, "id"))),
		],
		selection: {
			id: selectedField(column(genre, "id"), EntityId),
			name: selectedField(column(genre, "name"), Schema.String),
		},
		where: and(
			entitySchemaPredicate(genre, "genre", reference),
			eq(column(relationship, "sourceEntityId"), column(entity, "id")),
			relationshipSchemaPredicate(relationship, `${slug}-to-genre`, reference),
		),
	});
};

export type MediaGenresList = SelectedIncludeValue<ReturnType<typeof mediaGenresInclude>>;
export const requestedSchemaQuery = (id: ScalarExpression) => {
	const requested = table("entity", "requested");
	return selectedOptionalRow(requested, {
		where: entityId(requested, id),
		orderBy: [ascending(column(requested, "id"))],
		selection: {
			schemaSlug: selectedField(column(requested, "entitySchemaSlug"), EntitySchemaSlug),
		},
	});
};

export const mediaEntitySummarySelection = (entity: Table, provider: Table) => ({
	providerCheckedAt: selectedField(
		column(entity, "providerCheckedAt"),
		Schema.NullOr(Schema.String),
	),
	...entityIdentitySelection(entity),
	providerName: selectedField(column(provider, "name"), Schema.NullOr(Schema.String)),
	description: selectedField(propertyText(entity, "description"), Schema.NullOr(Schema.String)),
	images: selectedField(
		propertyJson(entity, "images"),
		Schema.NullOr(Schema.Array(MediaImageSchema)),
	),
	isMonitored: selectedField(
		libraryLinkExists(entity, "monitoringMediaLibrary", "media-monitoring"),
		Schema.Boolean,
	),
	...mediaLibrarySelection(entity),
	isCustom: selectedField(
		conditional(
			and(isNotNull(column(entity, "userId")), isNull(column(entity, "providerId"))),
			literal(true),
			literal(false),
		),
		Schema.Boolean,
	),
});

export type MediaEntitySummarySelection = ReturnType<typeof mediaEntitySummarySelection>;

export const mediaSummarySelection = (entity: Table, provider: Table) => ({
	...mediaEntitySummarySelection(entity, provider),
	publishDate: selectedField(propertyText(entity, "publishDate"), Schema.NullOr(Schema.String)),
	publishYear: selectedField(propertyNumber(entity, "publishYear"), Schema.NullOr(Schema.Finite)),
	providerRating: selectedField(
		propertyNumber(entity, "providerRating"),
		Schema.NullOr(Schema.Finite),
	),
	productionStatus: selectedField(
		propertyText(entity, "productionStatus"),
		Schema.NullOr(Schema.String),
	),
	owned: selectedField(
		castBoolean(libraryOwnershipProperty(entity, "owned")),
		Schema.NullOr(Schema.Boolean),
	),
	ownedOn: selectedField(
		castText(libraryOwnershipProperty(entity, "ownedOn")),
		Schema.NullOr(Schema.String),
	),
});

export type MediaSummarySelection = ReturnType<typeof mediaSummarySelection>;

/** The summary row of one entity of `slug`, with its provider and collections, and the requested entity's schema. */
export const mediaSummaryQueries = <
	const Selection extends SelectedSelection,
	const Includes extends SelectedIncludes,
>(input: {
	readonly slug: string;
	readonly collectionLimit: number;
	readonly entityId: ScalarExpression;
	readonly reference: PluginIdentityReference;
	/** Includes a schema adds beside the shared collection membership. */
	readonly include: (entity: Table) => Includes;
	readonly selection: (entity: Table, provider: Table) => Selection;
}) => {
	const entity = table("entity", "entity");
	const provider = table("sandboxProvider", "provider");
	return {
		requested: requestedSchemaQuery(input.entityId),
		summary: selectedOptionalRow(entity, {
			orderBy: [ascending(column(entity, "id"))],
			selection: input.selection(entity, provider),
			joins: [join("left", provider, eq(column(entity, "providerId"), column(provider, "id")))],
			include: {
				collections: collectionMembershipInclude(input.collectionLimit),
				...input.include(entity),
			},
			where: and(
				entitySchemaPredicate(entity, input.slug, input.reference),
				entityId(entity, input.entityId),
			),
		}),
	};
};

export const mediaSummaryResult = <Summary>(result: {
	readonly summary: Summary | undefined;
	readonly requested: undefined | { readonly schemaSlug: EntitySchemaSlug };
}) =>
	Result.succeed({
		summary: result.summary ?? null,
		entitySchemaSlug: result.requested?.schemaSlug ?? null,
	});

export const mediaWatchProviderSelection = (entity: Table) => ({
	watchProviders: selectedField(propertyJson(entity, "watchProviders"), WatchProviderListSchema),
});

export const mediaNumberField = (entity: Table, key: string) =>
	selectedField(propertyNumber(entity, key), Schema.NullOr(Schema.Finite));

export const mediaTextField = (entity: Table, key: string) =>
	selectedField(propertyText(entity, key), Schema.NullOr(Schema.String));

export const creditSelection = (credit: Table, relationship: Table) => ({
	id: selectedField(column(credit, "id"), EntityId),
	name: selectedField(column(credit, "name"), Schema.String),
	images: selectedField(propertyJson(credit, "images"), MediaImageListSchema),
	order: selectedField(propertyNumber(relationship, "order"), Schema.NullOr(Schema.Finite)),
	roles: selectedField(
		propertyJson(relationship, "roles"),
		Schema.NullOr(Schema.Array(Schema.String)),
	),
	...entitySyncSelection(credit),
	...mediaLibrarySelection(credit),
});

export const creditCharacterSelection = (relationship: Table) => ({
	character: selectedField(propertyText(relationship, "character"), Schema.NullOr(Schema.String)),
	isGuest: selectedField(propertyBoolean(relationship, "isGuest"), Schema.NullOr(Schema.Boolean)),
	isUncredited: selectedField(
		propertyBoolean(relationship, "isUncredited"),
		Schema.NullOr(Schema.Boolean),
	),
	creditKinds: selectedField(
		propertyJson(relationship, "creditKinds"),
		Schema.NullOr(Schema.Array(Schema.String)),
	),
	departments: selectedField(
		propertyJson(relationship, "departments"),
		Schema.NullOr(Schema.Array(Schema.String)),
	),
});

/** Rows of `relationship` joining `related` on `relatedSide`, anchored to the entity on the other side. */
export const relatedRows = (input: {
	readonly limit: number;
	readonly related: Table;
	readonly relationship: Table;
	readonly relatedSchemaSlug: string;
	readonly entityId: ScalarExpression;
	readonly reference: PluginIdentityReference;
	readonly relatedSide: "sourceEntityId" | "targetEntityId";
	readonly orderBy: readonly ReturnType<typeof ascending>[];
	readonly relationshipSchemaSlug: string | readonly string[];
}) => ({
	limit: input.limit,
	orderBy: input.orderBy,
	joins: [
		join(
			"inner",
			input.related,
			eq(column(input.relationship, input.relatedSide), column(input.related, "id")),
		),
	],
	where: and(
		entitySchemaPredicate(input.related, input.relatedSchemaSlug, input.reference),
		eq(
			column(
				input.relationship,
				input.relatedSide === "sourceEntityId" ? "targetEntityId" : "sourceEntityId",
			),
			input.entityId,
		),
		typeof input.relationshipSchemaSlug === "string"
			? relationshipSchemaPredicate(
					input.relationship,
					input.relationshipSchemaSlug,
					input.reference,
				)
			: or(
					...input.relationshipSchemaSlug.map((slug) =>
						relationshipSchemaPredicate(input.relationship, slug, input.reference),
					),
				),
	),
});

const creditOrder = (credit: Table, relationship: Table) => [
	ascending(propertyNumber(relationship, "order")),
	ascending(column(credit, "name")),
];

type SelectedQuerySuccess<Query> = Query extends SelectedQuery<infer Success> ? Success : never;

type SelectedQueryRows<Queries> = {
	readonly [Key in keyof Queries]: SelectedQuerySuccess<Queries[Key]>;
};

/** People and company credits of one entity of `slug`, with the schema's own person credit fields. */
export const mediaCreditQueries = <const PersonFields extends SelectedSelection>(input: {
	readonly slug: string;
	readonly peopleLimit: number;
	readonly companyLimit: number;
	readonly entityId: ScalarExpression;
	readonly reference: PluginIdentityReference;
	readonly personFields: (relationship: Table) => PersonFields;
}) => {
	const person = table("entity", "person");
	const company = table("entity", "company");
	const personRelationship = table("relationship", "personRelationship");
	const companyRelationship = table("relationship", "companyRelationship");
	return {
		companies: selectedRows(companyRelationship, {
			...incomingCreditRows({
				slug: input.slug,
				related: company,
				creator: "company",
				entityId: input.entityId,
				limit: input.companyLimit,
				reference: input.reference,
				relationship: companyRelationship,
			}),
			selection: creditSelection(company, companyRelationship),
		}),
		people: selectedRows(personRelationship, {
			...incomingCreditRows({
				related: person,
				slug: input.slug,
				creator: "person",
				entityId: input.entityId,
				limit: input.peopleLimit,
				reference: input.reference,
				relationship: personRelationship,
			}),
			selection: {
				...creditSelection(person, personRelationship),
				...input.personFields(personRelationship),
			},
		}),
	};
};

export type MediaCreditRows<PersonFields extends SelectedSelection> = SelectedQueryRows<
	ReturnType<typeof mediaCreditQueries<PersonFields>>
>;
export const mediaPeopleRecipe =
	<const Fields extends SelectedSelection>(config: {
		readonly slug: string | readonly string[];
		readonly personFields: (relationship: Table) => Fields;
	}) =>
	(structural: { readonly reference: PluginIdentityReference }) => {
		const input = {
			limit: 100,
			timeZone: reportingTimeZone,
			reference: structural.reference,
			entityId: mediaEntityParameters.value("entityId"),
		};
		const person = table("entity", "person");
		const relationship = table("relationship", "personRelationship");
		return defineRecipe({
			parameters: mediaEntityParameters.schema,
			map: ({ people }) => Result.succeed(people),
			queries: {
				people: selectedRows(relationship, {
					...incomingCreditRows({
						...input,
						relationship,
						related: person,
						creator: "person",
						slug: config.slug,
					}),
					selection: {
						...creditSelection(person, relationship),
						...config.personFields(relationship),
					},
				}),
			},
		});
	};
const incomingCreditRows = (input: {
	readonly limit: number;
	readonly related: Table;
	readonly relationship: Table;
	readonly entityId: ScalarExpression;
	readonly creator: "person" | "company";
	readonly slug: string | readonly string[];
	readonly reference: PluginIdentityReference;
}) =>
	relatedRows({
		...input,
		relatedSide: "sourceEntityId",
		relatedSchemaSlug: input.creator,
		orderBy: [
			...creditOrder(input.related, input.relationship),
			ascending(column(input.related, "id")),
		],
		relationshipSchemaSlug:
			typeof input.slug === "string"
				? `${input.creator}-to-${input.slug}`
				: input.slug.map((slug) => `${input.creator}-to-${slug}`),
	});
export const mediaEpisodeCreditsRecipe =
	(config: { readonly slug: string }) =>
	(structural: { readonly reference: PluginIdentityReference }) => {
		const section = (alias: string, credit: Parameters<typeof literal>[0]) => {
			const person = table("entity", `${alias}Person`);
			const relationship = table("relationship", `${alias}Relationship`);
			const rows = incomingCreditRows({
				relationship,
				related: person,
				creator: "person",
				slug: config.slug,
				reference: structural.reference,
				limit: mediaDetailLimits.peopleLimit,
				entityId: mediaEntityParameters.value("entityId"),
			});
			return selectedRows(relationship, {
				...rows,
				where: and(rows.where, contains(column(relationship, "properties"), literal(credit))),
				selection: {
					...creditSelection(person, relationship),
					...creditCharacterSelection(relationship),
				},
			});
		};
		return defineRecipe({
			map: (rows) => Result.succeed(rows),
			parameters: mediaEntityParameters.schema,
			queries: {
				crew: section("crew", { creditKinds: ["crew"] }),
				guestStars: section("guestStar", { isGuest: true }),
			},
		});
	};
export const mediaCompanyRecipe =
	(config: { readonly slug: string }) =>
	(structural: { readonly reference: PluginIdentityReference }) => {
		const input = {
			limit: 100,
			timeZone: reportingTimeZone,
			reference: structural.reference,
			entityId: mediaEntityParameters.value("entityId"),
		};
		const company = table("entity", "company");
		const relationship = table("relationship", "companyRelationship");
		return defineRecipe({
			parameters: mediaEntityParameters.schema,
			map: ({ companies }) => Result.succeed(companies),
			queries: {
				companies: selectedRows(relationship, {
					...incomingCreditRows({
						...input,
						relationship,
						related: company,
						slug: config.slug,
						creator: "company",
					}),
					selection: creditSelection(company, relationship),
				}),
			},
		});
	};
export const mediaOverviewQueries = (input: {
	readonly slug: string;
	readonly peopleLimit: number;
	readonly companyLimit: number;
	readonly entityId: ScalarExpression;
	readonly recommendationLimit: number;
	readonly reference: PluginIdentityReference;
}) => {
	const suggested = table("entity", "suggested");
	const suggestionRelationship = table("relationship", "suggestionRelationship");
	return {
		...mediaCreditQueries({ ...input, personFields: creditCharacterSelection }),
		recommendations: selectedRows(suggestionRelationship, {
			...relatedRows({
				related: suggested,
				entityId: input.entityId,
				reference: input.reference,
				relatedSide: "targetEntityId",
				relatedSchemaSlug: input.slug,
				limit: input.recommendationLimit,
				relationship: suggestionRelationship,
				relationshipSchemaSlug: "media-suggestion",
				orderBy: [ascending(column(suggested, "name"))],
			}),
			selection: {
				id: selectedField(column(suggested, "id"), EntityId),
				name: selectedField(column(suggested, "name"), Schema.String),
				images: selectedField(propertyJson(suggested, "images"), MediaImageListSchema),
				...entitySyncSelection(suggested),
				...mediaLibrarySelection(suggested),
			},
		}),
	};
};

export type MediaOverviewRows = SelectedQueryRows<ReturnType<typeof mediaOverviewQueries>>;

export const mediaGroupQuery = (input: {
	readonly limit: number;
	readonly groupSlug: string;
	readonly memberSlug: string;
	readonly relationshipSlug: string;
	readonly entityId: ScalarExpression;
	readonly reference: PluginIdentityReference;
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
			entitySchemaPredicate(group, input.groupSlug, input.reference),
			eq(column(groupRelationship, "targetEntityId"), input.entityId),
			relationshipSchemaPredicate(groupRelationship, input.relationshipSlug, input.reference),
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
				where: and(
					entitySchemaPredicate(member, input.memberSlug, input.reference),
					neq(column(member, "id"), input.entityId),
					eq(column(membership, "sourceEntityId"), column(group, "id")),
					relationshipSchemaPredicate(membership, input.relationshipSlug, input.reference),
				),
				selection: {
					id: selectedField(column(member, "id"), EntityId),
					name: selectedField(column(member, "name"), Schema.String),
					images: selectedField(propertyJson(member, "images"), MediaImageListSchema),
					...entitySyncSelection(member),
					...mediaLibrarySelection(member),
				},
			}),
		},
	});
};

const mediaFlatPresentationSelection = <Duration extends SelectedSelection>(
	entity: Table,
	lifecycle: { readonly state: ScalarExpression; readonly progressPercent: ScalarExpression },
	duration: Duration,
) => ({
	...entityIdentitySelection(entity),
	state: selectedField(lifecycle.state, MediaLifecycleStateSchema),
	...mediaPresentationImageSelection(entity),
	...duration,
	progressPercent: selectedField(lifecycle.progressPercent, Schema.NullOr(Schema.Finite)),
	publishDate: selectedField(propertyText(entity, "publishDate"), Schema.NullOr(Schema.String)),
	publishYear: selectedField(propertyNumber(entity, "publishYear"), Schema.NullOr(Schema.Finite)),
	productionStatus: selectedField(
		propertyText(entity, "productionStatus"),
		Schema.NullOr(Schema.String),
	),
});

export const mediaActivityParentSlugs = [
	"add-to-media-library",
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

export const mediaEventSnapshotSelection = (event: Table) => ({
	id: selectedField(column(event, "id"), EventId),
	entityId: selectedField(column(event, "entityId"), EntityId),
	occurredAt: selectedField(column(event, "occurredAt"), IsoDateString),
	sessionEntityId: selectedField(column(event, "sessionEntityId"), Schema.NullOr(EntityId)),
	properties: selectedField(column(event, "properties"), Schema.Record(Schema.String, Schema.Json)),
});

export const mediaReviewEventSelection = (event: Table) => ({
	...mediaEventSnapshotSelection(event),
	createdAt: selectedField(column(event, "createdAt"), IsoDateString),
	text: selectedField(propertyText(event, "text"), Schema.NullOr(Schema.String)),
	rating: selectedField(propertyNumber(event, "rating"), Schema.NullOr(Schema.Finite)),
	isSpoiler: selectedField(propertyBoolean(event, "isSpoiler"), Schema.NullOr(Schema.Boolean)),
});

export const mediaReviewActivityEventSelection = (event: Table) => ({
	...mediaReviewEventSelection(event),
	eventSchemaSlug: selectedField(column(event, "eventSchemaSlug"), Schema.String),
});

export const mediaActivityEventSelection = (event: Table) => ({
	...mediaReviewEventSelection(event),
	consumedOn: selectedField(propertyJson(event, "consumedOn"), ConsumedOnSelection),
	timeSpent: selectedField(propertyNumber(event, "timeSpent"), Schema.NullOr(Schema.Finite)),
});

export const mediaCollectionEventsQuery = (input: {
	readonly limit: number;
	readonly entityId: ScalarExpression;
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
			entitySchemaPredicate(eventCollection, "collection", { kind: "kernel" }),
			schemaOwnerPredicate(collectionEvent, "eventSchemaPluginId", { kind: "kernel" }),
			eventSchemaIsOneOf(collectionEvent, mediaActivityCollectionSlugs),
			eq(propertyText(collectionEvent, "entityId"), input.entityId),
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

export const mediaFlatActivityParentSlugs = [
	...mediaActivityParentSlugs,
	"item-complete",
	"progress",
	"list-state",
] as const;

const mediaFlatActivityEventSelection = (event: Table, positional: boolean) => ({
	...mediaActivityEventSelection(event),
	startedOn: selectedField(propertyText(event, "startedOn"), Schema.NullOr(IsoDateString)),
	dateUnknown: selectedField(propertyBoolean(event, "dateUnknown"), Schema.NullOr(Schema.Boolean)),
	progressPercent: selectedField(
		propertyNumber(event, "progressPercent"),
		Schema.NullOr(Schema.Finite),
	),
	eventSchemaSlug: selectedField(
		column(event, "eventSchemaSlug"),
		Schema.Literals(mediaFlatActivityParentSlugs),
	),
	position: selectedField(
		positional ? propertyJson(event, "position") : literal(null),
		Schema.NullOr(MediaPosition),
	),
});

/** The entity's own events of `slugs`, newest first. */
export const mediaEntityEventsQuery = <const Selection extends SelectedSelection>(input: {
	readonly limit: number;
	readonly alias: string;
	readonly slugs: readonly string[];
	readonly entityId: ScalarExpression;
	readonly reference: PluginIdentityReference;
	readonly selection: (event: Table) => Selection;
}) => {
	const event = table("event", input.alias);
	return selectedRows(event, {
		limit: input.limit,
		selection: input.selection(event),
		orderBy: eventOrderDescending(event),
		where: and(
			schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
			eq(column(event, "entityId"), input.entityId),
			eventSchemaIsOneOf(event, input.slugs),
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
export type MediaHistoryInput = {
	readonly entityId: ScalarExpression;
	readonly reference: PluginIdentityReference;
};
type MediaActivityOrdered = {
	readonly id: string;
	readonly createdAt: string;
	readonly occurredAt: string;
};
export const mediaEntityHistoryRecipe =
	<const Selection extends SelectedSelection>(config: {
		readonly alias: string;
		readonly slugs: readonly string[];
		readonly selection: (event: Table) => Selection;
	}) =>
	(input: { readonly reference: PluginIdentityReference }) => {
		const eventQuery = mediaEntityEventsQuery({
			limit: 100,
			slugs: config.slugs,
			reference: input.reference,
			alias: `${config.alias}HistoryEvent`,
			entityId: mediaEntityParameters.value("entityId"),
			selection: (event) => ({
				...mediaReviewActivityEventSelection(event),
				...config.selection(event),
			}),
		});
		const collectionQuery = mediaCollectionEventsQuery({
			limit: 100,
			entityId: mediaEntityParameters.value("entityId"),
		});
		type MediaRow = { readonly kind: "media" } & SelectedQuerySuccess<
			typeof eventQuery
		>["items"][number];
		type CollectionRow = ReturnType<
			typeof mediaCollectionActivityEvents<
				SelectedQuerySuccess<typeof collectionQuery>["items"][number]
			>
		>[number];
		return mediaEventHistoryRecipe<MediaRow | CollectionRow>([
			historyCategory(eventQuery, (row) => ({ ...row, kind: "media" as const })),
			historyCategory(collectionQuery, ({ collectionId, collectionName, ...row }) => ({
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
		]);
	};
type MediaCollectionActivityRow = MediaActivityOrdered & {
	readonly collectionId: string;
	readonly collectionName: string;
};

/** Collection membership events as activity rows carrying none of the media event fields. */
export const mediaCollectionActivityEvents = <Collection extends MediaCollectionActivityRow>(
	rows: readonly Collection[],
) =>
	rows.map(({ collectionId, collectionName, ...row }) => ({
		...row,
		text: null,
		rating: null,
		timeSpent: null,
		isSpoiler: null,
		consumedOn: null,
		progressPercent: null,
		kind: "collection" as const,
		collection: { id: collectionId, name: collectionName },
	}));

export const mergeMediaActivityEvents = <
	Parent extends MediaActivityOrdered,
	Collection extends MediaCollectionActivityRow,
>(input: {
	readonly parentEvents: readonly Parent[];
	readonly collectionEvents: readonly Collection[];
}) =>
	[
		...input.parentEvents.map((row) => ({ ...row, kind: "media" as const })),
		...mediaCollectionActivityEvents(input.collectionEvents),
	].sort(compareMediaActivityDescending);

export type MediaFlatActivityCollectionEvent = Extract<
	MergedFlatActivityEvent,
	{ readonly kind: "collection" }
>;

export type MediaFlatActivityEvent<Extra = unknown> =
	MediaFlatActivityCollectionEvent | MediaFlatActivityMediaEvent<Extra>;

export type MediaFlatActivityMediaEvent<Extra = unknown> = Extra &
	Extract<MergedFlatActivityEvent, { readonly kind: "media" }>;

export type MediaReviewActivityEvent = ReturnType<
	typeof mergeMediaActivityEvents<MediaReviewActivityParentRow, MediaActivityCollectionRow>
>[number];

export type MediaReviewActivityResult = {
	readonly truncated: boolean;
	readonly reviewCount: number;
	readonly events: readonly MediaReviewActivityEvent[];
};

type MediaFlatActivityParentRow = SelectedRow<ReturnType<typeof mediaFlatActivityEventSelection>>;

type MediaReviewActivityParentRow = SelectedRow<
	ReturnType<typeof mediaReviewActivityEventSelection>
>;

type MediaActivityCollectionRow = SelectedQuerySuccess<
	ReturnType<typeof mediaCollectionEventsQuery>
>["items"][number];

type MergedFlatActivityEvent = ReturnType<
	typeof mergeMediaActivityEvents<MediaFlatActivityParentRow, MediaActivityCollectionRow>
>[number];

/** Reviews, media library changes, and collection changes of an entity without media lifecycle events. */
export const mediaReviewActivityRecipe =
	(config: { readonly slug: string; readonly alias: string }) =>
	(structural: { readonly reference: PluginIdentityReference }) => {
		const input = {
			...mediaDetailLimits,
			timeZone: reportingTimeZone,
			reference: structural.reference,
			entityId: mediaEntityParameters.value("entityId"),
		};
		const entity = table("entity", `${config.alias}ActivityEntity`);
		const review = table("event", `${config.alias}ReviewCountEvent`);
		return defineRecipe({
			parameters: mediaEntityParameters.schema,
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
					limit: input.eventLimit,
					entityId: input.entityId,
					reference: input.reference,
					alias: `${config.alias}Event`,
					slugs: ["review", "add-to-media-library"],
					selection: mediaReviewActivityEventSelection,
				}),
				totals: selectedOptionalRow(entity, {
					orderBy: [ascending(column(entity, "id"))],
					where: and(
						entitySchemaPredicate(entity, config.slug, input.reference),
						entityId(entity, input.entityId),
					),
					selection: {
						reviewCount: selectedField(
							count(review, {
								where: and(
									eq(column(review, "entityId"), column(entity, "id")),
									eq(column(review, "eventSchemaPluginId"), column(entity, "entitySchemaPluginId")),
									eq(column(review, "eventSchemaSlug"), literal("review")),
								),
							}),
							Schema.Finite,
						),
					},
				}),
			},
		});
	};
export const mediaUnlinkedCreatorsQuery = (
	reference: PluginIdentityReference,
	id: ScalarExpression,
) => {
	const entity = table("entity", "creatorsEntity");
	return selectedOptionalRow(entity, {
		orderBy: [ascending(column(entity, "id"))],
		where: and(
			entityId(entity, id),
			schemaOwnerPredicate(entity, "entitySchemaPluginId", reference),
		),
		selection: {
			unlinkedCreators: selectedField(
				propertyJson(entity, "unlinkedCreators"),
				Schema.NullOr(Schema.Array(Schema.Struct({ name: Schema.String, role: Schema.String }))),
			),
		},
	});
};

export const mediaUnlinkedCreatorsOverviewQueries = (input: {
	readonly entityId: ScalarExpression;
	readonly reference: PluginIdentityReference;
}) => ({ creators: mediaUnlinkedCreatorsQuery(input.reference, input.entityId) });

export type MediaExtraQueries = Readonly<Record<string, SelectedQuery<unknown>>>;
export type MediaUnlinkedCreatorsOverview = {
	readonly creators?:
		undefined | SelectedQuerySuccess<ReturnType<typeof mediaUnlinkedCreatorsQuery>>;
};

export type MediaPresentationDataOf<Recipes extends { readonly presentationSource: unknown }> =
	Recipes["presentationSource"] extends SelectedRowsSource<infer Data> ? Data : never;

export type MediaActivityEventOf<Recipes extends { readonly activityRecipe: unknown }> =
	MediaActivityOf<Recipes> extends { readonly events: readonly (infer Event)[] } ? Event : never;
export type MediaActivityOf<Recipes extends { readonly activityRecipe: unknown }> =
	Recipes["activityRecipe"] extends (...args: never[]) => infer RecipeValue
		? Recipe.Success<RecipeValue>
		: never;

export type MediaFlatOverviewInput = {
	readonly groupLimit: number;
	readonly peopleLimit: number;
	readonly companyLimit: number;
	readonly entityId: ScalarExpression;
	readonly recommendationLimit: number;
	readonly reference: PluginIdentityReference;
};
export type MediaSummaryOf<Recipes extends { readonly summaryRecipe: unknown }> = (
	Recipes["summaryRecipe"] extends (...args: never[]) => infer RecipeValue
		? Recipe.Success<RecipeValue>
		: never
) extends { readonly summary: infer Summary }
	? NonNullable<Summary>
	: never;
export const mediaFlatRecipes = <
	const SummaryFields extends SelectedSelection,
	const PresentationFields extends SelectedSelection,
	const ActivityEventFields extends SelectedSelection,
	const ExtraOverviewQueries extends MediaExtraQueries,
>(config: {
	readonly slug: string;
	readonly alias: string;
	readonly groupSlug?: string;
	readonly consumptionUnit: ConsumptionMeasureUnit;
	readonly summaryFields: (entity: Table) => SummaryFields;
	readonly presentationFields: (entity: Table) => PresentationFields;
	readonly activityEventFields: (event: Table) => ActivityEventFields;
	readonly extraOverviewQueries: (input: MediaFlatOverviewInput) => ExtraOverviewQueries;
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
				include: (entity) => ({ genres: mediaGenresInclude(entity, config.slug, input.reference) }),
				selection: (entity, provider) => {
					const lifecycle = mediaLifecycleExpressions(entity, `${config.alias}SummaryLifecycle`);
					return {
						...mediaSummarySelection(entity, provider),
						state: selectedField(lifecycle.state, MediaLifecycleStateSchema),
						progressPercent: selectedField(lifecycle.progressPercent, Schema.NullOr(Schema.Finite)),
						...config.summaryFields(entity),
					};
				},
			}),
		});
	};
	const overviewQueries = (input: MediaFlatOverviewInput) => {
		const { groupSlug } = config;
		const credits = {
			...mediaOverviewQueries({ ...input, slug: config.slug }),
			...config.extraOverviewQueries(input),
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
						reference: input.reference,
						relationshipSlug: `${groupSlug}-to-${config.slug}`,
						aliases: {
							group: `${config.alias}Group`,
							relationship: `${config.alias}GroupRelationship`,
						},
					}),
				};
	};
	const overviewRecipe = (structural: { readonly reference: PluginIdentityReference }) => {
		const input = {
			...mediaDetailLimits,
			timeZone: reportingTimeZone,
			reference: structural.reference,
			entityId: mediaEntityParameters.value("entityId"),
		};
		return defineRecipe({
			queries: overviewQueries(input),
			parameters: mediaEntityParameters.schema,
		});
	};
	const peopleRecipe = mediaPeopleRecipe({ ...config, personFields: creditCharacterSelection });
	const activitySelection = (event: Table) => ({
		...mediaFlatActivityEventSelection(event, isPositional(config.slug)),
		...config.activityEventFields(event),
	});
	const historyRecipe = mediaEntityHistoryRecipe({
		alias: config.alias,
		selection: activitySelection,
		slugs: mediaFlatActivityParentSlugs,
	});
	const activityRecipe = (structural: { readonly reference: PluginIdentityReference }) => {
		const input = {
			...mediaDetailLimits,
			timeZone: reportingTimeZone,
			reference: structural.reference,
			entityId: mediaEntityParameters.value("entityId"),
		};
		const entity = table("entity", `${config.alias}ActivityEntity`);
		return defineRecipe({
			parameters: mediaEntityParameters.schema,
			map: ({ totals, events, collectionEvents }) =>
				Result.succeed({
					completionCount: totals?.completionCount ?? 0,
					consumedAmount: totals?.consumedAmount ?? null,
					unknownAmountCount: totals?.unknownAmountCount ?? 0,
					consumptionProcessing: totals?.consumptionProcessing ?? "ready",
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
					limit: input.eventLimit,
					entityId: input.entityId,
					reference: input.reference,
					selection: activitySelection,
					alias: `${config.alias}Event`,
					slugs: mediaFlatActivityParentSlugs,
				}),
				totals: selectedOptionalRow(entity, {
					orderBy: [ascending(column(entity, "id"))],
					selection: mediaConsumptionTotalsSelection(entity, config.consumptionUnit),
					where: and(
						entitySchemaPredicate(entity, config.slug, input.reference),
						entityId(entity, input.entityId),
					),
				}),
			},
		});
	};
	const presentationSelection = (entity: Table, alias: string) =>
		mediaFlatPresentationSelection(
			entity,
			mediaLifecycleExpressions(entity, `${alias}Lifecycle`),
			config.presentationFields(entity),
		);

	const presentationEntity = table("entity", "entity");
	const presentationSource = selectedRowsSource(presentationEntity, {
		selection: presentationSelection(presentationEntity, `${config.alias}Presentation`),
	});

	return {
		peopleRecipe,
		summaryRecipe,
		historyRecipe,
		overviewRecipe,
		activityRecipe,
		presentationSource,
		presentationSelection,
		companiesRecipe: mediaCompanyRecipe(config),
	};
};
