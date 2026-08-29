import { Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castBoolean,
	column,
	descending,
	eq,
	eventOrderDescending,
	first,
	inArray,
	IsoDateString,
	join,
	jsonPath,
	literal,
	selectedField,
	selectedInclude,
	selectedOptionalRow,
	selectedRows,
	table,
	type SelectedQuery,
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
	watchProviders: selectedField(propertyJson(entity, "watchProviders"), WatchProviderListSchema),
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

export const compareMediaActivityDescending = (
	left: { readonly id: string; readonly createdAt: string; readonly occurredAt: string },
	right: { readonly id: string; readonly createdAt: string; readonly occurredAt: string },
) =>
	right.occurredAt.localeCompare(left.occurredAt) ||
	right.createdAt.localeCompare(left.createdAt) ||
	right.id.localeCompare(left.id);
