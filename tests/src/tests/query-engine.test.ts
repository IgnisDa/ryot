import { describe, expect, it } from "bun:test";

import type { paths } from "@ryot/generated/openapi/app-backend";
import { dayjs } from "@ryot/ts-utils/dayjs";
import {
	createComputedFieldExpression,
	createEntityColumnExpression,
	createEntityPropertyExpression,
	createEntitySchemaExpression,
	createEventAggregateExpression,
} from "@ryot/ts-utils/view-language";

import {
	buildComputedField,
	buildGridDisplayConfiguration,
	buildGridRequest,
	buildInLibraryRelationshipJoin,
	buildLatestRelationshipJoin,
	buildQueryEngineField,
	buildRequiredLatestRelationshipJoin,
	buildTableDisplayConfiguration,
	buildTableRequest,
	createAuthenticatedClient,
	createCollection,
	createCrossSchemaQueryEngineFixture,
	createEntitySchema,
	createEventSchema,
	createQueryEngineEntity,
	createQueryEngineEvent,
	createRelationshipSchema,
	createSingleSchemaQueryEngineFixture,
	createTracker,
	entityField,
	executeQueryEngine,
	findBuiltinSchemaBySlug,
	findBuiltinSchemaWithProviders,
	getQueryEngineFieldOrThrow,
	insertLibraryMembership,
	insertRelationshipRow,
	listEventSchemas,
	literalExpression,
	relationshipJoinField,
	toQueryEngineItem,
	seedMediaEntity,
	waitForEventCount,
} from "../fixtures";
import { assertPresent } from "../test-support/assertions";
import { registerQueryEnginePresentationAndErrorTests } from "../test-support/query-engine-suite";

type QueryEngineItems = Extract<
	paths["/query-engine/execute"]["post"]["responses"][200]["content"]["application/json"],
	{ mode: "entities" }
>["data"]["items"];

const getItemFieldValue = (item: Parameters<typeof getQueryEngineFieldOrThrow>[0], key: string) =>
	getQueryEngineFieldOrThrow(item, key).value;

const getItemTitles = (items: QueryEngineItems | undefined) =>
	items?.map((item) => getItemFieldValue(item, "title"));

const getAggregateValue = <T extends { key: string; value?: unknown }>(
	values: readonly T[] | undefined,
	key: string,
) => values?.find((value) => value.key === key);

describe("Query engine E2E", () => {
	it("includes a global media entity when the user has it in their library", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const provider = schema.providers[0];
		assertPresent(provider, "No provider found");

		const entity = await seedMediaEntity({
			image: null,
			userId: null,
			properties: {},
			entitySchemaId: schema.id,
			sandboxScriptId: provider.scriptId,
			name: `Library Query Entity ${crypto.randomUUID()}`,
			externalId: `library-query-entity-${crypto.randomUUID()}`,
		});
		await insertLibraryMembership({ mediaEntityId: entity.id, userId });

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				relationshipJoins: [buildInLibraryRelationshipJoin()],
				displayConfiguration: buildGridDisplayConfiguration(
					{
						calloutProperty: null,
						primarySubtitleProperty: null,
						secondarySubtitleProperty: null,
					},
					[schema.slug],
				),
				filter: {
					operator: "eq",
					type: "comparison",
					right: literalExpression(entity.name),
					left: createEntityColumnExpression(schema.slug, "name"),
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(getItemTitles(data.data.items)).toEqual([entity.name]);
	});

	it("computes entity averageRating from the current user's review events only", async () => {
		const userA = await createAuthenticatedClient();
		const userB = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(userA.client, userA.cookies, "show");
		const provider = schema.providers[0];
		assertPresent(provider, "No provider found");

		const entity = await seedMediaEntity({
			image: null,
			userId: null,
			entitySchemaId: schema.id,
			sandboxScriptId: provider.scriptId,
			name: `Average Rating Show ${crypto.randomUUID()}`,
			externalId: `average-rating-show-${crypto.randomUUID()}`,
			properties: {
				genres: [],
				images: [],
				isNsfw: null,
				sourceUrl: null,
				showSeasons: [],
				description: null,
				publishYear: 2016,
				providerRating: 88.8,
				unlinkedCreators: [],
				productionStatus: "Ended",
			},
		});
		await insertLibraryMembership({
			userId: userA.userId,
			mediaEntityId: entity.id,
		});
		await insertLibraryMembership({
			userId: userB.userId,
			mediaEntityId: entity.id,
		});

		const eventSchemas = await listEventSchemas(userA.client, userA.cookies, schema.id);
		const reviewEventSchemaId = eventSchemas.find((item) => item.slug === "review")?.id;
		assertPresent(reviewEventSchemaId, "Missing review event schema");

		const createUserAReviews = await userA.client.POST("/events", {
			headers: { Cookie: userA.cookies },
			body: [
				{
					entityId: entity.id,
					eventSchemaId: reviewEventSchemaId,
					properties: { rating: 2, review: "Fine" },
				},
				{
					entityId: entity.id,
					eventSchemaId: reviewEventSchemaId,
					properties: { rating: 4, review: "Better" },
				},
			],
		});
		const createUserBReview = await userB.client.POST("/events", {
			headers: { Cookie: userB.cookies },
			body: [
				{
					entityId: entity.id,
					eventSchemaId: reviewEventSchemaId,
					properties: { rating: 5, review: "Excellent" },
				},
			],
		});
		expect(createUserAReviews.response.status).toBe(200);
		expect(createUserBReview.response.status).toBe(200);
		await waitForEventCount(userA.client, userA.cookies, entity.id, 2);
		await waitForEventCount(userB.client, userB.cookies, entity.id, 1);

		const request = buildGridRequest({
			scope: [schema.slug],
			relationshipJoins: [buildInLibraryRelationshipJoin()],
			displayConfiguration: buildGridDisplayConfiguration(
				{
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
					calloutProperty: createEventAggregateExpression(
						"review",
						["properties", "rating"],
						"avg",
					),
				},
				[schema.slug],
			),
			filter: {
				operator: "eq",
				type: "comparison",
				right: literalExpression(entity.name),
				left: createEntityColumnExpression(schema.slug, "name"),
			},
		});

		const userAResult = await executeQueryEngine(userA.client, userA.cookies, request);
		const userBResult = await executeQueryEngine(userB.client, userB.cookies, request);

		expect(userAResult.response.status).toBe(200);
		expect(userBResult.response.status).toBe(200);
		expect(getQueryEngineFieldOrThrow(userAResult.data.data.items[0], "callout")).toEqual({
			value: 3,
			key: "callout",
			kind: "number",
		});
		expect(getQueryEngineFieldOrThrow(userBResult.data.data.items[0], "callout")).toEqual({
			value: 5,
			key: "callout",
			kind: "number",
		});
	});

	it("isolates global media entities by library membership per user", async () => {
		const userA = await createAuthenticatedClient();
		const userB = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(userA.client, userA.cookies);
		const provider = schema.providers[0];
		assertPresent(provider, "No provider found");

		const entity = await seedMediaEntity({
			image: null,
			userId: null,
			properties: {},
			entitySchemaId: schema.id,
			sandboxScriptId: provider.scriptId,
			name: `Isolated Library Entity ${crypto.randomUUID()}`,
			externalId: `isolated-library-entity-${crypto.randomUUID()}`,
		});
		await insertLibraryMembership({
			userId: userA.userId,
			mediaEntityId: entity.id,
		});

		const request = buildGridRequest({
			scope: [schema.slug],
			relationshipJoins: [buildInLibraryRelationshipJoin()],
			displayConfiguration: buildGridDisplayConfiguration(
				{
					calloutProperty: null,
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
				},
				[schema.slug],
			),
			filter: {
				operator: "eq",
				type: "comparison",
				right: literalExpression(entity.name),
				left: createEntityColumnExpression(schema.slug, "name"),
			},
		});

		const userAResult = await executeQueryEngine(userA.client, userA.cookies, request);
		const userBResult = await executeQueryEngine(userB.client, userB.cookies, request);

		expect(userAResult.response.status).toBe(200);
		expect(getItemTitles(userAResult.data.data.items)).toEqual([entity.name]);
		expect(userBResult.response.status).toBe(200);
		expect(userBResult.data.data.items).toEqual([]);
	});

	it("deduplicates global entities that match multiple relationship filters", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const provider = schema.providers[0];
		assertPresent(provider, "No provider found");

		const entity = await seedMediaEntity({
			image: null,
			userId: null,
			properties: {},
			entitySchemaId: schema.id,
			sandboxScriptId: provider.scriptId,
			name: `Multi Relationship Entity ${crypto.randomUUID()}`,
			externalId: `multi-relationship-entity-${crypto.randomUUID()}`,
		});
		await insertLibraryMembership({ mediaEntityId: entity.id, userId });

		const collection = await createCollection(client, cookies, {
			name: `Query Engine Multi Match ${crypto.randomUUID()}`,
		});
		const addToCollection = await client.POST("/collections/memberships", {
			headers: { Cookie: cookies },
			body: { entityId: entity.id, collectionId: collection.id },
		});
		expect(addToCollection.response.status).toBe(200);

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				relationshipJoins: [
					buildInLibraryRelationshipJoin(),
					buildRequiredLatestRelationshipJoin({
						key: "memberOf",
						direction: "outgoing",
						relationshipSchemaSlug: "member-of",
					}),
				],
				displayConfiguration: buildGridDisplayConfiguration(
					{
						calloutProperty: null,
						primarySubtitleProperty: null,
						secondarySubtitleProperty: null,
					},
					[schema.slug],
				),
				filter: {
					operator: "eq",
					type: "comparison",
					right: literalExpression(entity.name),
					left: createEntityColumnExpression(schema.slug, "name"),
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(getItemTitles(data.data.items)).toEqual([entity.name]);
		expect(data.data.meta.pagination.total).toBe(1);

		const aggregateResult = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				eventJoins: [],
				mode: "aggregate",
				computedFields: [],
				scope: [schema.slug],
				aggregations: [{ key: "total", aggregation: { type: "count" } }],
				filter: {
					operator: "eq",
					type: "comparison",
					right: literalExpression(entity.name),
					left: createEntityColumnExpression(schema.slug, "name"),
				},
				relationshipJoins: [
					buildInLibraryRelationshipJoin(),
					buildRequiredLatestRelationshipJoin({
						key: "memberOf",
						direction: "outgoing",
						relationshipSchemaSlug: "member-of",
					}),
				],
			},
		});

		expect(aggregateResult.response.status).toBe(200);
		const aggregateValues =
			aggregateResult.data?.mode === "aggregate" ? aggregateResult.data.data.values : [];
		expect(getAggregateValue(aggregateValues, "total")).toEqual({
			value: 1,
			key: "total",
			kind: "number",
		});
	});

	it("optional join produces null values without excluding the entity", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, { name: "Optional Join Tracker" });
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Optional Join Entity",
			propertiesSchema: {
				fields: { title: { type: "string", label: "Title", description: "Title" } },
			},
		});
		await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			entitySchemaId: schema.schemaId,
			name: `Optional Join Entity ${crypto.randomUUID()}`,
		});
		const relSchema = await createRelationshipSchema({
			userId,
			name: "Optional Rel",
			propertiesSchema: { fields: {} },
			slug: `optional-rel-${crypto.randomUUID()}`,
		});

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			mode: "entities",
			computedFields: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 10 },
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression(schema.slug, "name"),
			},
			relationshipJoins: [
				buildLatestRelationshipJoin({
					key: "optRel",
					required: false,
					direction: "outgoing",
					relationshipSchemaSlug: relSchema.slug,
				}),
			],
			fields: [
				buildQueryEngineField("title", [entityField(schema.slug, "name")]),
				buildQueryEngineField("relCreatedAt", [relationshipJoinField("optRel", "createdAt")]),
			],
		});

		expect(response.status).toBe(200);
		expect(data.data.items.length).toBeGreaterThan(0);
		const relCreatedAtField = getQueryEngineFieldOrThrow(data.data.items[0], "relCreatedAt");
		expect(relCreatedAtField).toEqual({ key: "relCreatedAt", kind: "null", value: null });
	});

	it("required join excludes entities with no matching relationship row", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Required Join Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Required Join Entity",
			propertiesSchema: {
				fields: { title: { type: "string", label: "Title", description: "Title" } },
			},
		});
		const relSchema = await createRelationshipSchema({
			userId,
			name: "Required Rel",
			propertiesSchema: { fields: {} },
			slug: `required-rel-${crypto.randomUUID()}`,
		});
		const nameA = `With Rel ${crypto.randomUUID()}`;
		const nameB = `No Rel ${crypto.randomUUID()}`;
		const entityAId = await createQueryEngineEntity({
			client,
			cookies,
			name: nameA,
			image: null,
			properties: {},
			entitySchemaId: schema.schemaId,
		});
		await createQueryEngineEntity({
			client,
			cookies,
			name: nameB,
			image: null,
			properties: {},
			entitySchemaId: schema.schemaId,
		});

		const targetId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			entitySchemaId: schema.schemaId,
			name: `Target ${crypto.randomUUID()}`,
		});
		await insertRelationshipRow({
			userId,
			targetEntityId: targetId,
			sourceEntityId: entityAId,
			relationshipSchemaId: relSchema.id,
		});

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			mode: "entities",
			computedFields: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 50 },
			sort: { direction: "asc", expression: createEntityColumnExpression(schema.slug, "name") },
			relationshipJoins: [
				buildLatestRelationshipJoin({
					required: true,
					key: "requiredRel",
					direction: "outgoing",
					relationshipSchemaSlug: relSchema.slug,
				}),
			],
			fields: [buildQueryEngineField("title", [entityField(schema.slug, "name")])],
			filter: {
				type: "or",
				predicates: [
					{
						operator: "eq",
						type: "comparison",
						right: literalExpression(nameA),
						left: createEntityColumnExpression(schema.slug, "name"),
					},
					{
						operator: "eq",
						type: "comparison",
						right: literalExpression(nameB),
						left: createEntityColumnExpression(schema.slug, "name"),
					},
				],
			},
		});

		expect(response.status).toBe(200);
		const titles = data.data.items.map((i) => getQueryEngineFieldOrThrow(i, "title").value);
		expect(titles).toContain(nameA);
		expect(titles).not.toContain(nameB);
	});

	it("returns a relationship built-in createdAt as a display field", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const provider = schema.providers[0];
		assertPresent(provider, "No provider found");

		const entity = await seedMediaEntity({
			image: null,
			userId: null,
			properties: {},
			entitySchemaId: schema.id,
			sandboxScriptId: provider.scriptId,
			externalId: `rel-createdat-${crypto.randomUUID()}`,
			name: `Rel CreatedAt Entity ${crypto.randomUUID()}`,
		});
		await insertLibraryMembership({ userId, mediaEntityId: entity.id });

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			mode: "entities",
			computedFields: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 10 },
			relationshipJoins: [buildInLibraryRelationshipJoin(true)],
			sort: { direction: "asc", expression: createEntityColumnExpression(schema.slug, "name") },
			fields: [
				buildQueryEngineField("title", [entityField(schema.slug, "name")]),
				buildQueryEngineField("libCreatedAt", [relationshipJoinField("inLibrary", "createdAt")]),
			],
			filter: {
				operator: "eq",
				type: "comparison",
				right: literalExpression(entity.name),
				left: createEntityColumnExpression(schema.slug, "name"),
			},
		});

		expect(response.status).toBe(200);
		expect(data.data.items).toHaveLength(1);
		const createdAtField = getQueryEngineFieldOrThrow(data.data.items[0], "libCreatedAt");
		expect(createdAtField.kind).toBe("date");
		expect(typeof createdAtField.value).toBe("string");
	});

	it("returns a relationship property as a display field", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Rel Property Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Rel Property Entity",
			propertiesSchema: {
				fields: { title: { type: "string", label: "Title", description: "Title" } },
			},
		});
		const relSchema = await createRelationshipSchema({
			userId,
			name: "Rating Rel",
			slug: `rating-rel-${crypto.randomUUID()}`,
			propertiesSchema: {
				fields: { rating: { type: "integer", label: "Rating", description: "Rating" } },
			},
		});
		const entityName = `Rated Entity ${crypto.randomUUID()}`;
		const entityId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			name: entityName,
			entitySchemaId: schema.schemaId,
		});
		const targetId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			entitySchemaId: schema.schemaId,
			name: `Rating Target ${crypto.randomUUID()}`,
		});
		await insertRelationshipRow({
			userId,
			sourceEntityId: entityId,
			targetEntityId: targetId,
			properties: { rating: 8 },
			relationshipSchemaId: relSchema.id,
		});

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			mode: "entities",
			computedFields: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 10 },
			sort: { direction: "asc", expression: createEntityColumnExpression(schema.slug, "name") },
			relationshipJoins: [
				buildLatestRelationshipJoin({
					required: true,
					key: "ratingRel",
					direction: "outgoing",
					relationshipSchemaSlug: relSchema.slug,
				}),
			],
			fields: [
				buildQueryEngineField("title", [entityField(schema.slug, "name")]),
				buildQueryEngineField("rating", [
					relationshipJoinField("ratingRel", "properties", "rating"),
				]),
			],
			filter: {
				operator: "eq",
				type: "comparison",
				right: literalExpression(entityName),
				left: createEntityColumnExpression(schema.slug, "name"),
			},
		});

		expect(response.status).toBe(200);
		expect(data.data.items).toHaveLength(1);
		expect(getQueryEngineFieldOrThrow(data.data.items[0], "rating")).toEqual({
			value: 8,
			key: "rating",
			kind: "number",
		});
	});

	it("sorts by a relationship-derived scalar", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Rel Sort Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Rel Sort Entity",
			propertiesSchema: {
				fields: { title: { type: "string", label: "Title", description: "Title" } },
			},
		});
		const relSchema = await createRelationshipSchema({
			userId,
			name: "Sort Rating Rel",
			slug: `sort-rating-rel-${crypto.randomUUID()}`,
			propertiesSchema: {
				fields: { rating: { type: "integer", label: "Rating", description: "Rating" } },
			},
		});
		const nameLow = `Sort Low ${crypto.randomUUID()}`;
		const nameHigh = `Sort High ${crypto.randomUUID()}`;
		const lowId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			name: nameLow,
			properties: {},
			entitySchemaId: schema.schemaId,
		});
		const highId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			name: nameHigh,
			properties: {},
			entitySchemaId: schema.schemaId,
		});
		const targetId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			entitySchemaId: schema.schemaId,
			name: `Sort Target ${crypto.randomUUID()}`,
		});
		await insertRelationshipRow({
			userId,
			sourceEntityId: lowId,
			targetEntityId: targetId,
			properties: { rating: 2 },
			relationshipSchemaId: relSchema.id,
		});
		await insertRelationshipRow({
			userId,
			sourceEntityId: highId,
			targetEntityId: targetId,
			properties: { rating: 9 },
			relationshipSchemaId: relSchema.id,
		});

		const ratingRef = {
			type: "reference" as const,
			reference: {
				joinKey: "sortRatingRel",
				path: ["properties", "rating"],
				type: "relationship-join" as const,
			},
		};

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			mode: "entities",
			computedFields: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 50 },
			sort: { direction: "asc", expression: ratingRef },
			relationshipJoins: [
				buildLatestRelationshipJoin({
					required: true,
					key: "sortRatingRel",
					direction: "outgoing",
					relationshipSchemaSlug: relSchema.slug,
				}),
			],
			fields: [
				buildQueryEngineField("title", [entityField(schema.slug, "name")]),
				buildQueryEngineField("rating", [
					relationshipJoinField("sortRatingRel", "properties", "rating"),
				]),
			],
			filter: {
				type: "or",
				predicates: [
					{
						operator: "eq",
						type: "comparison",
						right: literalExpression(nameLow),
						left: createEntityColumnExpression(schema.slug, "name"),
					},
					{
						operator: "eq",
						type: "comparison",
						right: literalExpression(nameHigh),
						left: createEntityColumnExpression(schema.slug, "name"),
					},
				],
			},
		});

		expect(response.status).toBe(200);
		expect(data.data.items).toHaveLength(2);
		expect(getQueryEngineFieldOrThrow(data.data.items[0], "rating").value).toBe(2);
		expect(getQueryEngineFieldOrThrow(data.data.items[1], "rating").value).toBe(9);
	});

	it("filters by a relationship property using a comparison operator", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Rel Filter Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Rel Filter Entity",
			propertiesSchema: {
				fields: { title: { type: "string", label: "Title", description: "Title" } },
			},
		});
		const relSchema = await createRelationshipSchema({
			userId,
			name: "Filter Rating Rel",
			slug: `filter-rating-rel-${crypto.randomUUID()}`,
			propertiesSchema: {
				fields: { rating: { type: "integer", label: "Rating", description: "Rating" } },
			},
		});
		const nameA = `Filter A ${crypto.randomUUID()}`;
		const nameB = `Filter B ${crypto.randomUUID()}`;
		const nameC = `Filter C ${crypto.randomUUID()}`;
		const targetId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			entitySchemaId: schema.schemaId,
			name: `Filter Target ${crypto.randomUUID()}`,
		});
		const idA = await createQueryEngineEntity({
			client,
			cookies,
			name: nameA,
			image: null,
			properties: {},
			entitySchemaId: schema.schemaId,
		});
		const idB = await createQueryEngineEntity({
			client,
			cookies,
			name: nameB,
			image: null,
			properties: {},
			entitySchemaId: schema.schemaId,
		});
		const idC = await createQueryEngineEntity({
			client,
			cookies,
			name: nameC,
			image: null,
			properties: {},
			entitySchemaId: schema.schemaId,
		});
		await insertRelationshipRow({
			userId,
			sourceEntityId: idA,
			targetEntityId: targetId,
			properties: { rating: 3 },
			relationshipSchemaId: relSchema.id,
		});
		await insertRelationshipRow({
			userId,
			sourceEntityId: idB,
			targetEntityId: targetId,
			properties: { rating: 7 },
			relationshipSchemaId: relSchema.id,
		});
		await insertRelationshipRow({
			userId,
			sourceEntityId: idC,
			targetEntityId: targetId,
			properties: { rating: 10 },
			relationshipSchemaId: relSchema.id,
		});

		const ratingRef = {
			type: "reference" as const,
			reference: {
				joinKey: "filterRatingRel",
				path: ["properties", "rating"],
				type: "relationship-join" as const,
			},
		};

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			mode: "entities",
			computedFields: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 50 },
			sort: { direction: "asc", expression: createEntityColumnExpression(schema.slug, "name") },
			relationshipJoins: [
				buildLatestRelationshipJoin({
					required: true,
					direction: "outgoing",
					key: "filterRatingRel",
					relationshipSchemaSlug: relSchema.slug,
				}),
			],
			fields: [
				buildQueryEngineField("title", [entityField(schema.slug, "name")]),
				buildQueryEngineField("rating", [
					relationshipJoinField("filterRatingRel", "properties", "rating"),
				]),
			],
			filter: {
				type: "and",
				predicates: [
					{
						operator: "gte",
						left: ratingRef,
						type: "comparison",
						right: literalExpression(7),
					},
					{
						type: "or",
						predicates: [
							{
								operator: "eq",
								type: "comparison",
								right: literalExpression(nameA),
								left: createEntityColumnExpression(schema.slug, "name"),
							},
							{
								operator: "eq",
								type: "comparison",
								right: literalExpression(nameB),
								left: createEntityColumnExpression(schema.slug, "name"),
							},
							{
								operator: "eq",
								type: "comparison",
								right: literalExpression(nameC),
								left: createEntityColumnExpression(schema.slug, "name"),
							},
						],
					},
				],
			},
		});

		expect(response.status).toBe(200);
		const ratings = data.data.items.map((i) => getQueryEngineFieldOrThrow(i, "rating").value);
		expect(ratings).toContain(7);
		expect(ratings).toContain(10);
		expect(ratings).not.toContain(3);
	});

	it("filters by a relationship array property using contains", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Rel Array Filter Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Rel Array Filter Entity",
			propertiesSchema: {
				fields: { title: { type: "string", label: "Title", description: "Title" } },
			},
		});
		const relSchema = await createRelationshipSchema({
			userId,
			name: "Roles Rel",
			slug: `roles-rel-${crypto.randomUUID()}`,
			propertiesSchema: {
				fields: {
					roles: {
						type: "array",
						label: "Roles",
						description: "Roles",
						items: { type: "string", label: "Role", description: "Role" },
					},
				},
			},
		});
		const directorName = `Director Entity ${crypto.randomUUID()}`;
		const actorName = `Actor Entity ${crypto.randomUUID()}`;
		const targetId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			entitySchemaId: schema.schemaId,
			name: `Roles Target ${crypto.randomUUID()}`,
		});
		const directorId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			name: directorName,
			entitySchemaId: schema.schemaId,
		});
		const actorId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			name: actorName,
			entitySchemaId: schema.schemaId,
		});
		await insertRelationshipRow({
			userId,
			targetEntityId: targetId,
			sourceEntityId: directorId,
			relationshipSchemaId: relSchema.id,
			properties: { roles: ["director"] },
		});
		await insertRelationshipRow({
			userId,
			sourceEntityId: actorId,
			targetEntityId: targetId,
			properties: { roles: ["actor"] },
			relationshipSchemaId: relSchema.id,
		});

		const rolesRef = {
			type: "reference" as const,
			reference: {
				joinKey: "rolesRel",
				path: ["properties", "roles"],
				type: "relationship-join" as const,
			},
		};

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			mode: "entities",
			computedFields: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 50 },
			sort: { direction: "asc", expression: createEntityColumnExpression(schema.slug, "name") },
			relationshipJoins: [
				buildLatestRelationshipJoin({
					required: true,
					key: "rolesRel",
					direction: "outgoing",
					relationshipSchemaSlug: relSchema.slug,
				}),
			],
			fields: [buildQueryEngineField("title", [entityField(schema.slug, "name")])],
			filter: {
				type: "and",
				predicates: [
					{
						type: "contains",
						expression: rolesRef,
						value: literalExpression("director"),
					},
					{
						type: "or",
						predicates: [
							{
								operator: "eq",
								type: "comparison",
								right: literalExpression(directorName),
								left: createEntityColumnExpression(schema.slug, "name"),
							},
							{
								operator: "eq",
								type: "comparison",
								right: literalExpression(actorName),
								left: createEntityColumnExpression(schema.slug, "name"),
							},
						],
					},
				],
			},
		});

		expect(response.status).toBe(200);
		const titles = data.data.items.map((i) => getQueryEngineFieldOrThrow(i, "title").value);
		expect(titles).toContain(directorName);
		expect(titles).not.toContain(actorName);
	});

	it("join-local filter selects from pre-filtered rows, not latest overall", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Join Local Filter Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Join Local Filter Entity",
			propertiesSchema: {
				fields: { title: { type: "string", label: "Title", description: "Title" } },
			},
		});
		const relSchema = await createRelationshipSchema({
			userId,
			name: "Local Filter Rel",
			slug: `local-filter-rel-${crypto.randomUUID()}`,
			propertiesSchema: {
				fields: { rating: { type: "integer", label: "Rating", description: "Rating" } },
			},
		});
		const entityName = `Local Filter Entity ${crypto.randomUUID()}`;
		const entityId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			name: entityName,
			entitySchemaId: schema.schemaId,
		});
		const target1Id = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			entitySchemaId: schema.schemaId,
			name: `Local Filter Target 1 ${crypto.randomUUID()}`,
		});
		const target2Id = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			entitySchemaId: schema.schemaId,
			name: `Local Filter Target 2 ${crypto.randomUUID()}`,
		});
		await insertRelationshipRow({
			userId,
			sourceEntityId: entityId,
			targetEntityId: target1Id,
			properties: { rating: 1 },
			relationshipSchemaId: relSchema.id,
			createdAt: new Date(Date.now() - 10000),
		});
		await insertRelationshipRow({
			userId,
			sourceEntityId: entityId,
			targetEntityId: target2Id,
			properties: { rating: 5 },
			relationshipSchemaId: relSchema.id,
		});

		const localFilterRef = {
			type: "reference" as const,
			reference: {
				joinKey: "localFilterRel",
				path: ["properties", "rating"],
				type: "relationship-join" as const,
			},
		};

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			mode: "entities",
			computedFields: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 10 },
			sort: { direction: "asc", expression: createEntityColumnExpression(schema.slug, "name") },
			relationshipJoins: [
				buildLatestRelationshipJoin({
					required: true,
					key: "localFilterRel",
					direction: "outgoing",
					relationshipSchemaSlug: relSchema.slug,
					filter: {
						operator: "eq",
						type: "comparison",
						left: localFilterRef,
						right: literalExpression(1),
					},
				}),
			],
			fields: [
				buildQueryEngineField("title", [entityField(schema.slug, "name")]),
				buildQueryEngineField("rating", [
					relationshipJoinField("localFilterRel", "properties", "rating"),
				]),
			],
			filter: {
				operator: "eq",
				type: "comparison",
				right: literalExpression(entityName),
				left: createEntityColumnExpression(schema.slug, "name"),
			},
		});

		expect(response.status).toBe(200);
		expect(data.data.items).toHaveLength(1);
		expect(getQueryEngineFieldOrThrow(data.data.items[0], "rating")).toEqual({
			value: 1,
			key: "rating",
			kind: "number",
		});
	});

	it("sourceEntityId constraint filters relationship rows to a specific source", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Source Entity Id Tracker",
		});
		const entitySchema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Source Entity Id Entity",
			propertiesSchema: {
				fields: { title: { type: "string", label: "Title", description: "Title" } },
			},
		});
		const relSchema = await createRelationshipSchema({
			userId,
			name: "Source Id Rel",
			propertiesSchema: { fields: {} },
			slug: `source-id-rel-${crypto.randomUUID()}`,
		});
		const memberName = `Source Member ${crypto.randomUUID()}`;
		const memberId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			name: memberName,
			entitySchemaId: entitySchema.schemaId,
		});
		const collBName = `Source Coll B ${crypto.randomUUID()}`;
		const collBId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			name: collBName,
			entitySchemaId: entitySchema.schemaId,
		});
		const collCId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			entitySchemaId: entitySchema.schemaId,
			name: `Source Coll C ${crypto.randomUUID()}`,
		});
		await insertRelationshipRow({
			userId,
			targetEntityId: collBId,
			sourceEntityId: memberId,
			relationshipSchemaId: relSchema.id,
		});
		await insertRelationshipRow({
			userId,
			targetEntityId: collCId,
			sourceEntityId: memberId,
			relationshipSchemaId: relSchema.id,
		});

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			mode: "entities",
			computedFields: [],
			scope: [entitySchema.slug],
			pagination: { page: 1, limit: 50 },
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression(entitySchema.slug, "name"),
			},
			relationshipJoins: [
				buildLatestRelationshipJoin({
					required: true,
					key: "sourceIdRel",
					direction: "outgoing",
					targetEntityId: collBId,
					relationshipSchemaSlug: relSchema.slug,
				}),
			],
			fields: [
				buildQueryEngineField("title", [entityField(entitySchema.slug, "name")]),
				buildQueryEngineField("targetId", [relationshipJoinField("sourceIdRel", "targetEntityId")]),
			],
			filter: {
				operator: "eq",
				type: "comparison",
				left: createEntityColumnExpression(entitySchema.slug, "name"),
				right: literalExpression(memberName),
			},
		});

		expect(response.status).toBe(200);
		expect(data.data.items).toHaveLength(1);
		expect(getQueryEngineFieldOrThrow(data.data.items[0], "targetId")).toEqual({
			kind: "text",
			value: collBId,
			key: "targetId",
		});
	});

	it("targetEntityId constraint returns entity with the correct relationship target", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Target Entity Id Tracker",
		});
		const entitySchema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Target Entity Id Entity",
			propertiesSchema: {
				fields: { title: { type: "string", label: "Title", description: "Title" } },
			},
		});
		const relSchema = await createRelationshipSchema({
			userId,
			name: "Target Id Rel",
			propertiesSchema: { fields: {} },
			slug: `target-id-rel-${crypto.randomUUID()}`,
		});
		const memberName = `Target Member ${crypto.randomUUID()}`;
		const memberId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			name: memberName,
			entitySchemaId: entitySchema.schemaId,
		});
		const collBId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			entitySchemaId: entitySchema.schemaId,
			name: `Target Coll B ${crypto.randomUUID()}`,
		});
		const collCId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			entitySchemaId: entitySchema.schemaId,
			name: `Target Coll C ${crypto.randomUUID()}`,
		});
		await insertRelationshipRow({
			userId,
			targetEntityId: collBId,
			sourceEntityId: memberId,
			relationshipSchemaId: relSchema.id,
		});
		await insertRelationshipRow({
			userId,
			targetEntityId: collCId,
			sourceEntityId: memberId,
			relationshipSchemaId: relSchema.id,
		});

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			mode: "entities",
			computedFields: [],
			scope: [entitySchema.slug],
			pagination: { page: 1, limit: 50 },
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression(entitySchema.slug, "name"),
			},
			relationshipJoins: [
				buildLatestRelationshipJoin({
					required: true,
					key: "targetIdRel",
					direction: "outgoing",
					targetEntityId: collCId,
					relationshipSchemaSlug: relSchema.slug,
				}),
			],
			fields: [
				buildQueryEngineField("title", [entityField(entitySchema.slug, "name")]),
				buildQueryEngineField("targetId", [relationshipJoinField("targetIdRel", "targetEntityId")]),
			],
			filter: {
				operator: "eq",
				type: "comparison",
				right: literalExpression(memberName),
				left: createEntityColumnExpression(entitySchema.slug, "name"),
			},
		});

		expect(response.status).toBe(200);
		expect(data.data.items).toHaveLength(1);
		expect(getQueryEngineFieldOrThrow(data.data.items[0], "targetId")).toEqual({
			kind: "text",
			value: collCId,
			key: "targetId",
		});
	});

	it("incoming direction returns the collection entity when a member entity is added", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const collection = await createCollection(client, cookies, {
			name: `Incoming Dir Collection ${crypto.randomUUID()}`,
		});

		const { schema: collectionEntitySchema } = await findBuiltinSchemaBySlug(
			client,
			cookies,
			"collection",
		);

		const { trackerId } = await createTracker(client, cookies, {
			name: "Incoming Dir Tracker",
		});
		const memberSchema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Incoming Dir Member",
			propertiesSchema: {
				fields: { title: { type: "string", label: "Title", description: "Title" } },
			},
		});
		const memberName = `Incoming Member ${crypto.randomUUID()}`;
		const memberId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			name: memberName,
			entitySchemaId: memberSchema.schemaId,
		});

		const addResult = await client.POST("/collections/memberships", {
			headers: { Cookie: cookies },
			body: { entityId: memberId, collectionId: collection.id },
		});
		expect(addResult.response.status).toBe(200);

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			mode: "entities",
			computedFields: [],
			pagination: { page: 1, limit: 50 },
			scope: [collectionEntitySchema.slug],
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression(collectionEntitySchema.slug, "name"),
			},
			relationshipJoins: [
				buildLatestRelationshipJoin({
					required: true,
					direction: "incoming",
					key: "memberOfIncoming",
					relationshipSchemaSlug: "member-of",
				}),
			],
			fields: [buildQueryEngineField("title", [entityField(collectionEntitySchema.slug, "name")])],
			filter: {
				operator: "eq",
				type: "comparison",
				right: literalExpression(collection.name),
				left: createEntityColumnExpression(collectionEntitySchema.slug, "name"),
			},
		});

		expect(response.status).toBe(200);
		const titles = data.data.items.map((i) => getQueryEngineFieldOrThrow(i, "title").value);
		expect(titles).toContain(collection.name);
	});

	it("returns related entity built-in targetEntity.name as a display field", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const collectionName = `Target Name Collection ${crypto.randomUUID()}`;
		const collection = await createCollection(client, cookies, { name: collectionName });

		const { trackerId } = await createTracker(client, cookies, {
			name: "Target Name Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Target Name Entity",
			propertiesSchema: {
				fields: { title: { type: "string", label: "Title", description: "Title" } },
			},
		});
		const entityName = `Target Name Member ${crypto.randomUUID()}`;
		const entityId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			name: entityName,
			entitySchemaId: schema.schemaId,
		});

		const addResult = await client.POST("/collections/memberships", {
			headers: { Cookie: cookies },
			body: { entityId, collectionId: collection.id },
		});
		expect(addResult.response.status).toBe(200);

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			mode: "entities",
			computedFields: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 10 },
			sort: { direction: "asc", expression: createEntityColumnExpression(schema.slug, "name") },
			relationshipJoins: [
				buildRequiredLatestRelationshipJoin({
					key: "memberOfRel",
					direction: "outgoing",
					relationshipSchemaSlug: "member-of",
				}),
			],
			fields: [
				buildQueryEngineField("title", [entityField(schema.slug, "name")]),
				buildQueryEngineField("collectionName", [
					relationshipJoinField("memberOfRel", "targetEntity", "name"),
				]),
			],
			filter: {
				operator: "eq",
				type: "comparison",
				right: literalExpression(entityName),
				left: createEntityColumnExpression(schema.slug, "name"),
			},
		});

		expect(response.status).toBe(200);
		expect(data.data.items).toHaveLength(1);
		expect(getQueryEngineFieldOrThrow(data.data.items[0], "collectionName")).toEqual({
			kind: "text",
			key: "collectionName",
			value: collectionName,
		});
	});

	it("sorts by related entity built-in targetEntity.name", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const zCollection = await createCollection(client, cookies, {
			name: `Zulu Sort Collection ${crypto.randomUUID()}`,
		});
		const aCollection = await createCollection(client, cookies, {
			name: `Alpha Sort Collection ${crypto.randomUUID()}`,
		});

		const { trackerId } = await createTracker(client, cookies, {
			name: "Target Name Sort Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Target Name Sort Entity",
			propertiesSchema: {
				fields: { title: { type: "string", label: "Title", description: "Title" } },
			},
		});
		const zEntityName = `Target Name Z Member ${crypto.randomUUID()}`;
		const aEntityName = `Target Name A Member ${crypto.randomUUID()}`;
		const zEntityId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			name: zEntityName,
			entitySchemaId: schema.schemaId,
		});
		const aEntityId = await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			name: aEntityName,
			entitySchemaId: schema.schemaId,
		});

		const membershipPairs = [
			[zEntityId, zCollection.id],
			[aEntityId, aCollection.id],
		] as const;
		const addResults = await Promise.all(
			membershipPairs.map(([entityId, collectionId]) =>
				client.POST("/collections/memberships", {
					headers: { Cookie: cookies },
					body: { entityId, collectionId },
				}),
			),
		);
		for (const addResult of addResults) {
			expect(addResult.response.status).toBe(200);
		}

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			mode: "entities",
			computedFields: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 10 },
			sort: {
				direction: "asc",
				expression: {
					type: "reference",
					reference: {
						joinKey: "memberOfRel",
						type: "relationship-join",
						path: ["targetEntity", "name"],
					},
				},
			},
			relationshipJoins: [
				buildRequiredLatestRelationshipJoin({
					key: "memberOfRel",
					direction: "outgoing",
					relationshipSchemaSlug: "member-of",
				}),
			],
			fields: [
				buildQueryEngineField("title", [entityField(schema.slug, "name")]),
				buildQueryEngineField("collectionName", [
					relationshipJoinField("memberOfRel", "targetEntity", "name"),
				]),
			],
			filter: null,
		});

		expect(response.status).toBe(200);
		expect(data.data.items.map((item) => getItemFieldValue(item, "title"))).toEqual([
			aEntityName,
			zEntityName,
		]);
		expect(data.data.items.map((item) => getItemFieldValue(item, "collectionName"))).toEqual([
			aCollection.name,
			zCollection.name,
		]);
	});

	it("rejects a relationship-join reference in events mode", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Events Mode Rel Join Rejection Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Events Mode Rel Join Entity",
			propertiesSchema: {
				fields: { title: { type: "string", label: "Title", description: "Title" } },
			},
		});
		const eventSchema = await createEventSchema(client, cookies, {
			name: "Test Event",
			slug: "test-event",
			entitySchemaId: schema.schemaId,
			propertiesSchema: {
				fields: { note: { type: "string", label: "Note", description: "Note" } },
			},
		});

		const { response } = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				mode: "events",
				scope: [schema.slug],
				eventSchemas: [eventSchema.slug],
				pagination: { page: 1, limit: 10 },
				sort: {
					direction: "asc",
					expression: createEntityColumnExpression(schema.slug, "name"),
				},
				fields: [
					{
						key: "relField",
						expression: {
							type: "reference",
							reference: {
								joinKey: "someRel",
								path: ["createdAt"],
								type: "relationship-join",
							},
						},
					},
				],
			},
		});

		expect(response.status).toBe(400);
	});

	it("rejects join-local filter referencing a computed field", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Local Filter Computed Rejection Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Local Filter Computed Entity",
			propertiesSchema: {
				fields: { title: { type: "string", label: "Title", description: "Title" } },
			},
		});
		const relSchema = await createRelationshipSchema({
			userId,
			name: "Computed Filter Rel",
			propertiesSchema: { fields: {} },
			slug: `computed-filter-rel-${crypto.randomUUID()}`,
		});

		const { response } = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				eventJoins: [],
				mode: "entities",
				scope: [schema.slug],
				pagination: { page: 1, limit: 10 },
				sort: { direction: "asc", expression: createEntityColumnExpression(schema.slug, "name") },
				computedFields: [
					{ key: "computedTitle", expression: createEntityColumnExpression(schema.slug, "name") },
				],
				relationshipJoins: [
					{
						required: false,
						direction: "outgoing",
						key: "computedFilterRel",
						kind: "latestRelationship",
						relationshipSchemaSlug: relSchema.slug,
						filter: {
							operator: "eq",
							type: "comparison",
							right: literalExpression("test"),
							left: {
								type: "reference",
								reference: { key: "computedTitle", type: "computed-field" },
							},
						},
					},
				],
				fields: [buildQueryEngineField("title", [entityField(schema.slug, "name")])],
			},
		});

		expect(response.status).toBe(400);
	});

	it("executes a simple single-schema query with the full response shape", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({ scope: [schema.slug] }),
		);
		const result = data.data;
		const firstItem = result.items[0];

		expect(response.status).toBe(200);
		expect(result.items).toHaveLength(5);
		expect(getItemFieldValue(firstItem, "title")).toBe("Alpha Phone");
		expect(getItemFieldValue(firstItem, "image")).toEqual({
			type: "remote",
			url: "https://example.com/alpha-phone.png",
		});
		expect(getQueryEngineFieldOrThrow(firstItem, "callout")).toEqual({
			kind: "text",
			value: "phone",
			key: "callout",
		});
		expect(getQueryEngineFieldOrThrow(firstItem, "primarySubtitle")).toEqual({
			value: 2018,
			kind: "number",
			key: "primarySubtitle",
		});
		expect(getQueryEngineFieldOrThrow(firstItem, "secondarySubtitle")).toEqual({
			value: null,
			kind: "null",
			key: "secondarySubtitle",
		});
		expect(getQueryEngineFieldOrThrow(firstItem, "title")).toEqual({
			key: "title",
			kind: "text",
			value: "Alpha Phone",
		});
		expect(getQueryEngineFieldOrThrow(firstItem, "image")).toEqual({
			key: "image",
			kind: "image",
			value: { type: "remote", url: "https://example.com/alpha-phone.png" },
		});
		expect(result.meta.pagination).toEqual({
			page: 1,
			total: 5,
			limit: 10,
			totalPages: 1,
			hasNextPage: false,
			hasPreviousPage: false,
		});
	});

	it("executes aggregate mode counts and numeric aggregations inside the filtered set", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();

		const { data, response } = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				eventJoins: [],
				mode: "aggregate",
				computedFields: [],
				scope: [schema.slug],
				relationshipJoins: [],
				filter: {
					type: "in",
					expression: createEntityPropertyExpression(schema.slug, "category"),
					values: [literalExpression("phone"), literalExpression("wearable")],
				},
				aggregations: [
					{ key: "total", aggregation: { type: "count" } },
					{
						key: "recent",
						aggregation: {
							type: "countWhere",
							predicate: {
								operator: "gte",
								type: "comparison",
								right: literalExpression(2020),
								left: createEntityPropertyExpression(schema.slug, "year"),
							},
						},
					},
					{
						key: "sumYear",
						aggregation: {
							type: "sum",
							expression: createEntityPropertyExpression(schema.slug, "year"),
						},
					},
					{
						key: "avgYear",
						aggregation: {
							type: "avg",
							expression: createEntityPropertyExpression(schema.slug, "year"),
						},
					},
					{
						key: "minYear",
						aggregation: {
							type: "min",
							expression: createEntityPropertyExpression(schema.slug, "year"),
						},
					},
					{
						key: "maxYear",
						aggregation: {
							type: "max",
							expression: createEntityPropertyExpression(schema.slug, "year"),
						},
					},
				],
			},
		});

		expect(response.status).toBe(200);
		expect(data?.mode).toBe("aggregate");
		const values = data?.mode === "aggregate" ? data.data.values : [];
		expect(getAggregateValue(values, "total")).toEqual({
			value: 3,
			key: "total",
			kind: "number",
		});
		expect(getAggregateValue(values, "recent")).toEqual({
			value: 2,
			key: "recent",
			kind: "number",
		});
		expect(getAggregateValue(values, "sumYear")).toEqual({
			value: 6059,
			key: "sumYear",
			kind: "number",
		});
		expect(getAggregateValue(values, "minYear")).toEqual({
			value: 2018,
			key: "minYear",
			kind: "number",
		});
		expect(getAggregateValue(values, "maxYear")).toEqual({
			value: 2021,
			key: "maxYear",
			kind: "number",
		});
		expect(Number(getAggregateValue(values, "avgYear")?.value)).toBeCloseTo(2019.6666666667, 6);
	});

	it("returns countBy maps and SQL empty-set defaults in aggregate mode", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();

		const aggregateResult = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				filter: null,
				eventJoins: [],
				mode: "aggregate",
				computedFields: [],
				scope: [schema.slug],
				relationshipJoins: [],
				aggregations: [
					{
						key: "byCategory",
						aggregation: {
							type: "countBy",
							groupBy: createEntityPropertyExpression(schema.slug, "category"),
						},
					},
				],
			},
		});

		expect(aggregateResult.response.status).toBe(200);
		const aggregateValues =
			aggregateResult.data?.mode === "aggregate" ? aggregateResult.data.data.values : [];
		expect(getAggregateValue(aggregateValues, "byCategory")).toEqual({
			key: "byCategory",
			kind: "json",
			value: { phone: 2, tablet: 1, wearable: 1 },
		});

		const emptyResult = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				eventJoins: [],
				mode: "aggregate",
				computedFields: [],
				scope: [schema.slug],
				relationshipJoins: [],
				filter: {
					operator: "eq",
					type: "comparison",
					right: literalExpression("Missing Device"),
					left: createEntityColumnExpression(schema.slug, "name"),
				},
				aggregations: [
					{ key: "total", aggregation: { type: "count" } },
					{
						key: "avgYear",
						aggregation: {
							type: "avg",
							expression: createEntityPropertyExpression(schema.slug, "year"),
						},
					},
					{
						key: "byCategory",
						aggregation: {
							type: "countBy",
							groupBy: createEntityPropertyExpression(schema.slug, "category"),
						},
					},
				],
			},
		});

		expect(emptyResult.response.status).toBe(200);
		const emptyValues = emptyResult.data?.mode === "aggregate" ? emptyResult.data.data.values : [];
		expect(getAggregateValue(emptyValues, "total")).toEqual({
			value: 0,
			key: "total",
			kind: "number",
		});
		expect(getAggregateValue(emptyValues, "avgYear")).toEqual({
			value: null,
			kind: "null",
			key: "avgYear",
		});
		expect(getAggregateValue(emptyValues, "byCategory")).toEqual({
			value: {},
			kind: "json",
			key: "byCategory",
		});
	});

	it("rejects non-numeric aggregate expressions at request time", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();

		const { error, response } = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				filter: null,
				eventJoins: [],
				mode: "aggregate",
				computedFields: [],
				scope: [schema.slug],
				relationshipJoins: [],
				aggregations: [
					{
						key: "sumName",
						aggregation: {
							type: "sum",
							expression: createEntityColumnExpression(schema.slug, "name"),
						},
					},
				],
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error.message).toContain("sum aggregation requires a numeric expression");
	});

	it("rejects non-numeric event-aggregate expressions at request time", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		await createEventSchema(client, cookies, {
			name: "Review",
			slug: "review",
			entitySchemaId: schema.schemaId,
			propertiesSchema: {
				fields: { label: { type: "string", label: "Label", description: "Label" } },
			},
		});

		const { error, response } = await executeQueryEngine(client, cookies, {
			filter: null,
			eventJoins: [],
			computedFields: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 5 },
			sort: { direction: "asc", expression: createEntityColumnExpression(schema.slug, "name") },
			fields: [
				buildQueryEngineField(
					"avgReviewLabel",
					createEventAggregateExpression("review", ["properties", "label"], "avg"),
				),
			],
		});

		expect(response.status).toBe(400);
		expect(error?.error.message).toBe(
			"avg event aggregate requires a numeric property, received 'string'",
		);
	});

	it("rejects primary event references in aggregate mode", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();

		const { error, response } = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				filter: null,
				eventJoins: [],
				mode: "aggregate",
				computedFields: [],
				scope: [schema.slug],
				relationshipJoins: [],
				aggregations: [
					{
						key: "byEvent",
						aggregation: {
							type: "countBy",
							groupBy: { type: "reference", reference: { type: "event", path: ["createdAt"] } },
						},
					},
				],
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error.message).toBe(
			"Primary event references are not supported in this query mode",
		);
	});

	it("accepts literal and coalesce expressions in raw runtime fields", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 1 },
			sort: { direction: "asc", expression: createEntityColumnExpression(schema.slug, "name") },
			fields: [
				buildQueryEngineField("label", { type: "literal", value: "Pinned" }),
				buildQueryEngineField("yearOrFallback", {
					type: "coalesce",
					values: [
						{ type: "literal", value: null },
						{
							type: "reference",
							reference: { type: "entity", slug: schema.slug, path: ["properties", "year"] },
						},
						{ type: "literal", value: 0 },
					],
				}),
			],
		});

		expect(response.status).toBe(200);
		expect(data.data.items[0]).toEqual(
			toQueryEngineItem([
				{ key: "label", kind: "text", value: "Pinned" },
				{ key: "yearOrFallback", kind: "number", value: 2018 },
			]),
		);
	});

	it("reuses computed fields in raw output and preserves null latest-event values", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		await createEventSchema(client, cookies, {
			name: "Review",
			slug: "review",
			entitySchemaId: schema.schemaId,
			propertiesSchema: {
				fields: {
					label: { type: "string", label: "Label", description: "Label" },
					rating: { type: "number", label: "Rating", description: "Rating" },
				},
			},
		});

		const { data, response } = await executeQueryEngine(client, cookies, {
			scope: [schema.slug],
			pagination: { page: 1, limit: 5 },
			eventJoins: [{ key: "review", kind: "latestEvent", eventSchemaSlug: "review" }],
			sort: { direction: "asc", expression: createEntityColumnExpression(schema.slug, "name") },
			fields: [
				buildQueryEngineField("title", ["computed.entityLabel"]),
				buildQueryEngineField("badge", ["computed.reviewOrLabel"]),
				buildQueryEngineField("rawReview", ["computed.reviewLabel"]),
			],
			computedFields: [
				buildComputedField("entityLabel", [entityField(schema.slug, "name")]),
				buildComputedField("reviewLabel", ["event.review.properties.label"]),
				buildComputedField("reviewOrLabel", {
					type: "coalesce",
					values: [
						{ type: "reference", reference: { key: "reviewLabel", type: "computed-field" } },
						{ type: "reference", reference: { key: "entityLabel", type: "computed-field" } },
					],
				}),
			],
		});

		expect(response.status).toBe(200);
		expect(data.data.items[0]).toEqual(
			toQueryEngineItem([
				{ key: "title", kind: "text", value: "Alpha Phone" },
				{ key: "badge", kind: "text", value: "Alpha Phone" },
				{ key: "rawReview", kind: "null", value: null },
			]),
		);
	});

	it("sorts and filters by computed fields in raw runtime requests", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const yearExpression = createEntityPropertyExpression(schema.slug, "year");
		const nextYearReference = createComputedFieldExpression("nextYear");
		const labelReference = createComputedFieldExpression("label");

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 5 },
			sort: { direction: "desc", expression: nextYearReference },
			filter: {
				operator: "gte",
				type: "comparison",
				left: nextYearReference,
				right: { type: "literal", value: 2021 },
			},
			computedFields: [
				{
					key: "nextYear",
					expression: {
						operator: "add",
						type: "arithmetic",
						left: yearExpression,
						right: { type: "literal", value: 1 },
					},
				},
				{
					key: "label",
					expression: {
						type: "concat",
						values: [{ type: "literal", value: "Release " }, nextYearReference],
					},
				},
			],
			fields: [
				buildQueryEngineField("label", labelReference),
				buildQueryEngineField("nextYear", nextYearReference),
			],
		});

		expect(response.status).toBe(200);
		expect(data.data.items.map((item) => getItemFieldValue(item, "label"))).toEqual([
			"Release 2022",
			"Release 2021",
		]);
		expect(data.data.items[0]).toEqual(
			toQueryEngineItem([
				{ key: "label", kind: "text", value: "Release 2022" },
				{ key: "nextYear", kind: "number", value: 2022 },
			]),
		);
		expect(data.data.items[1]).toEqual(
			toQueryEngineItem([
				{ key: "label", kind: "text", value: "Release 2021" },
				{ key: "nextYear", kind: "number", value: 2021 },
			]),
		);
	});

	it("rejects invalid computed field references and cycles in raw runtime requests", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const missingComputedFieldResult = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			computedFields: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 5 },
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression(schema.slug, "name"),
			},
			filter: null,
			fields: [buildQueryEngineField("title", ["computed.missingLabel"])],
		});
		const cycleResult = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 5 },
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression(schema.slug, "name"),
			},
			filter: null,
			computedFields: [
				buildComputedField("first", ["computed.second"]),
				buildComputedField("second", ["computed.first"]),
			],
			fields: [buildQueryEngineField("title", ["computed.first"])],
		});

		expect(missingComputedFieldResult.response.status).toBe(400);
		expect(missingComputedFieldResult.error?.error.message).toBe(
			"Computed field 'missingLabel' is not part of this runtime request",
		);
		expect(cycleResult.response.status).toBe(400);
		expect(cycleResult.error?.error.message).toBe(
			"Computed field dependency cycle detected: first -> second -> first",
		);
	});

	it("rejects invalid computed field types and non-display image usage in raw runtime requests", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const imageSortResult = await executeQueryEngine(client, cookies, {
			filter: null,
			eventJoins: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 5 },
			sort: {
				direction: "asc",
				expression: createComputedFieldExpression("cover"),
			},
			computedFields: [
				{
					key: "cover",
					expression: createEntityColumnExpression(schema.slug, "image"),
				},
			],
			fields: [buildQueryEngineField("image", [entityField(schema.slug, "image")])],
		});
		const mismatchedFilterResult = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 5 },
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression(schema.slug, "name"),
			},
			filter: {
				operator: "eq",
				type: "comparison",
				right: { type: "literal", value: "2021" },
				left: createComputedFieldExpression("nextYear"),
			},
			computedFields: [
				{
					key: "nextYear",
					expression: {
						operator: "add",
						type: "arithmetic",
						right: { type: "literal", value: 1 },
						left: {
							type: "reference",
							reference: {
								type: "entity",
								slug: schema.slug,
								path: ["properties", "year"],
							},
						},
					},
				},
			],
			fields: [buildQueryEngineField("title", [entityField(schema.slug, "name")])],
		});

		expect(imageSortResult.response.status).toBe(400);
		expect(imageSortResult.error?.error.message).toBe(
			"Image expressions are display-only and cannot be used in sorting",
		);
		expect(mismatchedFilterResult.response.status).toBe(400);
		expect(mismatchedFilterResult.error?.error.message).toBe(
			"Filter operator 'eq' requires compatible expression types, received 'integer' and 'string'",
		);
	});

	it("returns 404 when the runtime request references a schema slug that is not visible", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const result = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({ scope: ["does-not-exist"] }),
		);

		expect(result.response.status).toBe(404);
		expect(result.error?.error.message).toContain("Schema 'does-not-exist' not found");
	});

	it("supports arithmetic, normalization, concat, and conditionals in runtime expressions", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const categoryExpression = createEntityPropertyExpression(schema.slug, "category");
		const nameExpression = createEntityColumnExpression(schema.slug, "name");
		const yearExpression = createEntityPropertyExpression(schema.slug, "year");

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 1 },
			sort: { direction: "asc", expression: nameExpression },
			filter: {
				operator: "eq",
				type: "comparison",
				left: nameExpression,
				right: { type: "literal", value: "Gamma Phone" },
			},
			computedFields: [
				{
					key: "nextYear",
					expression: {
						operator: "add",
						type: "arithmetic",
						left: yearExpression,
						right: { type: "literal", value: 1 },
					},
				},
			],
			fields: [
				buildQueryEngineField("nextYear", ["computed.nextYear"]),
				buildQueryEngineField("rounded", {
					type: "round",
					expression: {
						type: "arithmetic",
						operator: "divide",
						left: yearExpression,
						right: { type: "literal", value: 3 },
					},
				}),
				buildQueryEngineField("floored", {
					type: "floor",
					expression: {
						type: "arithmetic",
						operator: "divide",
						left: yearExpression,
						right: { type: "literal", value: 3 },
					},
				}),
				buildQueryEngineField("wholeYear", {
					type: "integer",
					expression: yearExpression,
				}),
				buildQueryEngineField("label", {
					type: "concat",
					values: [
						{ type: "literal", value: "Gamma / " },
						categoryExpression,
						{ type: "literal", value: " / " },
						yearExpression,
					],
				}),
				buildQueryEngineField("badge", {
					type: "conditional",
					whenTrue: { type: "literal", value: "modern" },
					whenFalse: { type: "literal", value: "classic" },
					condition: {
						operator: "gte",
						type: "comparison",
						left: yearExpression,
						right: { type: "literal", value: 2020 },
					},
				}),
			],
		});

		expect(response.status).toBe(200);
		expect(data.data.items[0]).toEqual(
			toQueryEngineItem([
				{ key: "nextYear", kind: "number", value: 2021 },
				{ key: "rounded", kind: "number", value: 673 },
				{ key: "floored", kind: "number", value: 673 },
				{ key: "wholeYear", kind: "number", value: 2020 },
				{ key: "label", kind: "text", value: "Gamma / phone / 2020" },
				{ key: "badge", kind: "text", value: "modern" },
			]),
		);
	});

	it("supports titleCase and kebabCase transforms in runtime expressions", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			computedFields: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 1 },
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression(schema.slug, "name"),
			},
			filter: {
				operator: "eq",
				type: "comparison",
				right: literalExpression("Gamma Phone"),
				left: createEntityColumnExpression(schema.slug, "name"),
			},
			fields: [
				buildQueryEngineField("titleCased", {
					type: "transform",
					name: "titleCase",
					expression: createEntityPropertyExpression(schema.slug, "category"),
				}),
				buildQueryEngineField("kebabCased", {
					type: "transform",
					name: "kebabCase",
					expression: createEntityPropertyExpression(schema.slug, "category"),
				}),
			],
		});

		expect(response.status).toBe(200);
		expect(data.data.items[0]).toEqual(
			toQueryEngineItem([
				{ key: "titleCased", kind: "text", value: "Phone" },
				{ key: "kebabCased", kind: "text", value: "phone" },
			]),
		);
	});

	it("truncates integer normalization toward zero for fractional values", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const yearExpression = createEntityPropertyExpression(schema.slug, "year");

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			computedFields: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 1 },
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression(schema.slug, "name"),
			},
			filter: {
				operator: "eq",
				type: "comparison",
				right: { type: "literal", value: "Alpha Phone" },
				left: createEntityColumnExpression(schema.slug, "name"),
			},
			fields: [
				buildQueryEngineField("integerNormalized", {
					type: "integer",
					expression: {
						type: "arithmetic",
						operator: "divide",
						left: yearExpression,
						right: { type: "literal", value: 365 },
					},
				}),
			],
		});

		expect(response.status).toBe(200);
		expect(data.data.items[0]).toEqual(
			toQueryEngineItem([{ key: "integerNormalized", kind: "number", value: 5 }]),
		);
	});

	it("supports eq, neq, gt, gte, lt, lte, in, isNull, and isNotNull filters", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const scenarios = [
			{
				expected: ["Alpha Phone", "Gamma Phone"],
				filter: {
					type: "comparison" as const,
					operator: "eq" as const,
					left: createEntityPropertyExpression(schema.slug, "category"),
					right: literalExpression("phone"),
				},
			},
			{
				expected: ["Beta Tablet", "Delta Watch"],
				filter: {
					type: "comparison" as const,
					operator: "neq" as const,
					left: createEntityPropertyExpression(schema.slug, "category"),
					right: literalExpression("phone"),
				},
			},
			{
				expected: ["Delta Watch", "Gamma Phone"],
				filter: {
					type: "comparison" as const,
					operator: "gt" as const,
					left: createEntityPropertyExpression(schema.slug, "year"),
					right: literalExpression(2019),
				},
			},
			{
				expected: ["Delta Watch", "Gamma Phone"],
				filter: {
					type: "comparison" as const,
					operator: "gte" as const,
					left: createEntityPropertyExpression(schema.slug, "year"),
					right: literalExpression(2020),
				},
			},
			{
				expected: ["Alpha Phone", "Beta Tablet"],
				filter: {
					type: "comparison" as const,
					operator: "lt" as const,
					left: createEntityPropertyExpression(schema.slug, "year"),
					right: literalExpression(2020),
				},
			},
			{
				expected: ["Alpha Phone", "Beta Tablet"],
				filter: {
					type: "comparison" as const,
					operator: "lte" as const,
					left: createEntityPropertyExpression(schema.slug, "year"),
					right: literalExpression(2019),
				},
			},
			{
				expected: ["Beta Tablet", "Delta Watch"],
				filter: {
					type: "in" as const,
					expression: createEntityPropertyExpression(schema.slug, "category"),
					values: [literalExpression("tablet"), literalExpression("wearable")],
				},
			},
			{
				expected: ["Omega Prototype"],
				filter: {
					type: "isNull" as const,
					expression: createEntityPropertyExpression(schema.slug, "category"),
				},
			},
			{
				expected: ["Alpha Phone", "Beta Tablet", "Delta Watch", "Gamma Phone"],
				filter: {
					type: "isNotNull" as const,
					expression: createEntityPropertyExpression(schema.slug, "category"),
				},
			},
		];

		for (const scenario of scenarios) {
			// oxlint-disable-next-line no-await-in-loop
			const { data, response } = await executeQueryEngine(
				client,
				cookies,
				buildGridRequest({
					filter: scenario.filter,
					scope: [schema.slug],
				}),
			);

			expect(response.status).toBe(200);
			expect(getItemTitles(data.data.items)).toEqual(scenario.expected);
		}
	});

	it("supports not predicate to negate filters", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				filter: {
					type: "not",
					predicate: {
						operator: "eq",
						type: "comparison",
						right: literalExpression("phone"),
						left: createEntityPropertyExpression(schema.slug, "category"),
					},
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(getItemTitles(data.data.items)).toEqual(["Beta Tablet", "Delta Watch"]);
	});

	it("ands multiple filters within a single schema", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				filter: {
					type: "and",
					predicates: [
						{
							operator: "gte",
							type: "comparison",
							right: literalExpression(2020),
							left: createEntityPropertyExpression(schema.slug, "year"),
						},
						{
							operator: "eq",
							type: "comparison",
							right: literalExpression("phone"),
							left: createEntityPropertyExpression(schema.slug, "category"),
						},
					],
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(getItemTitles(data.data.items)).toEqual(["Gamma Phone"]);
	});

	it("applies explicit entity name filters across every schema", async () => {
		const { client, cookies, smartphoneSlug, tabletSlug } =
			await createCrossSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [smartphoneSlug, tabletSlug],
				displayConfiguration: buildGridDisplayConfiguration(
					{
						calloutProperty: null,
						primarySubtitleProperty: null,
						secondarySubtitleProperty: null,
					},
					[smartphoneSlug, tabletSlug],
				),
				filter: {
					type: "or",
					predicates: [
						{
							type: "in",
							expression: createEntityColumnExpression(smartphoneSlug, "name"),
							values: [literalExpression("Alpha Phone"), literalExpression("Delta Tablet")],
						},
						{
							type: "in",
							expression: createEntityColumnExpression(tabletSlug, "name"),
							values: [literalExpression("Alpha Phone"), literalExpression("Delta Tablet")],
						},
					],
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(getItemTitles(data.data.items)).toEqual(["Alpha Phone", "Delta Tablet"]);
	});

	it("ors schema-qualified filters across different schemas", async () => {
		const { client, cookies, smartphoneSlug, tabletSlug } =
			await createCrossSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [smartphoneSlug, tabletSlug],
				displayConfiguration: buildGridDisplayConfiguration(
					{
						calloutProperty: null,
						primarySubtitleProperty: null,
						secondarySubtitleProperty: null,
					},
					[smartphoneSlug, tabletSlug],
				),
				filter: {
					type: "or",
					predicates: [
						{
							type: "comparison",
							operator: "gte",
							left: createEntityPropertyExpression(smartphoneSlug, "year"),
							right: literalExpression(2020),
						},
						{
							type: "comparison",
							operator: "gte",
							left: createEntityPropertyExpression(tabletSlug, "releaseYear"),
							right: literalExpression(2021),
						},
					],
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(getItemTitles(data.data.items)).toEqual(["Delta Tablet", "Gamma Phone", "Omega Phone"]);
	});

	it("sorts by name in both directions and by schema properties", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const ascResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({ scope: [schema.slug] }),
		);
		const descResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				sort: {
					expression: createEntityColumnExpression(schema.slug, "name"),
					direction: "desc",
				},
			}),
		);
		const yearResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				sort: {
					expression: createEntityPropertyExpression(schema.slug, "year"),
					direction: "asc",
				},
			}),
		);

		expect(getItemTitles(ascResult.data.data.items)).toEqual([
			"Alpha Phone",
			"Beta Tablet",
			"Delta Watch",
			"Gamma Phone",
			"Omega Prototype",
		]);
		expect(getItemTitles(descResult.data.data.items)).toEqual([
			"Omega Prototype",
			"Gamma Phone",
			"Delta Watch",
			"Beta Tablet",
			"Alpha Phone",
		]);
		expect(getItemTitles(yearResult.data.data.items)).toEqual([
			"Alpha Phone",
			"Beta Tablet",
			"Gamma Phone",
			"Delta Watch",
			"Omega Prototype",
		]);
	});

	it("filters, sorts, and displays entity @id", async () => {
		const { client, cookies, entityIdsByName, schema } =
			await createSingleSchemaQueryEngineFixture();
		const targetId = entityIdsByName["Gamma Phone"];
		assertPresent(targetId, "Missing runtime entity fixture id for @id test");

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildTableRequest({
				scope: [schema.slug],
				sort: {
					expression: createEntityColumnExpression(schema.slug, "id"),
					direction: "asc",
				},
				displayConfiguration: buildTableDisplayConfiguration([
					{ label: "Id", property: [entityField(schema.slug, "id")] },
					{ label: "Name", property: [entityField(schema.slug, "name")] },
				]),
				filter: {
					type: "comparison",
					operator: "eq",
					left: createEntityColumnExpression(schema.slug, "id"),
					right: literalExpression(targetId),
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(data.data.items).toHaveLength(1);
		expect(data.data.meta.fieldOrder).toEqual(["column_0", "column_1"]);
		expect(data.data.items[0]).toEqual(
			toQueryEngineItem([
				{ key: "column_0", kind: "text", value: targetId },
				{ key: "column_1", kind: "text", value: "Gamma Phone" },
			]),
		);
	});

	it("filters entity @id with contains", async () => {
		const { client, cookies, entityIdsByName, schema } =
			await createSingleSchemaQueryEngineFixture();
		const targetId = entityIdsByName["Beta Tablet"];
		assertPresent(targetId, "Missing runtime entity fixture id for @id contains test");
		const suffix = targetId.slice(-8);

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				displayConfiguration: buildGridDisplayConfiguration(
					{
						calloutProperty: [entityField(schema.slug, "id")],
						primarySubtitleProperty: null,
						secondarySubtitleProperty: null,
					},
					[schema.slug],
				),
				filter: {
					type: "contains",
					expression: createEntityColumnExpression(schema.slug, "id"),
					value: literalExpression(suffix),
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(getItemTitles(data.data.items)).toEqual(["Beta Tablet"]);
		expect(getQueryEngineFieldOrThrow(data.data.items[0], "callout")).toEqual({
			key: "callout",
			kind: "text",
			value: targetId,
		});
	});

	it("sorts across schemas with COALESCE and keeps null values last", async () => {
		const { client, cookies, smartphoneSlug, tabletSchema, tabletSlug } =
			await createCrossSchemaQueryEngineFixture();
		const neutralDisplay = buildGridDisplayConfiguration(
			{
				calloutProperty: null,
				primarySubtitleProperty: null,
				secondarySubtitleProperty: null,
			},
			[smartphoneSlug, tabletSlug],
		);
		const coalesceSort = {
			direction: "asc" as const,
			expression: {
				type: "coalesce" as const,
				values: [
					createEntityPropertyExpression(smartphoneSlug, "year"),
					createEntityPropertyExpression(tabletSlug, "releaseYear"),
				],
			},
		};
		const coalesceResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				displayConfiguration: neutralDisplay,
				scope: [smartphoneSlug, tabletSlug],
				sort: coalesceSort,
			}),
		);

		await createQueryEngineEntity({
			client,
			cookies,
			name: "Null Tablet",
			entitySchemaId: tabletSchema.schemaId,
			properties: { maker: "Ghost" },
		});

		const nullsLastResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				displayConfiguration: neutralDisplay,
				scope: [smartphoneSlug, tabletSlug],
				sort: coalesceSort,
			}),
		);

		expect(coalesceResult.response.status).toBe(200);
		expect(getItemTitles(coalesceResult.data.data.items)).toEqual([
			"Alpha Phone",
			"Beta Tablet",
			"Gamma Phone",
			"Delta Tablet",
			"Omega Phone",
		]);
		expect(nullsLastResult.response.status).toBe(200);
		expect(getItemFieldValue(nullsLastResult.data.data.items.at(-1), "title")).toBe("Null Tablet");
	});

	it("returns correct pagination metadata for first, middle, and last pages", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const scenarios = [
			{
				pagination: { page: 1, limit: 2 },
				expectedNames: ["Alpha Phone", "Beta Tablet"],
				expectedMeta: {
					page: 1,
					total: 5,
					limit: 2,
					totalPages: 3,
					hasNextPage: true,
					hasPreviousPage: false,
				},
			},
			{
				pagination: { page: 2, limit: 2 },
				expectedNames: ["Delta Watch", "Gamma Phone"],
				expectedMeta: {
					page: 2,
					total: 5,
					limit: 2,
					totalPages: 3,
					hasNextPage: true,
					hasPreviousPage: true,
				},
			},
			{
				pagination: { page: 5, limit: 1 },
				expectedNames: ["Omega Prototype"],
				expectedMeta: {
					page: 5,
					total: 5,
					limit: 1,
					totalPages: 5,
					hasNextPage: false,
					hasPreviousPage: true,
				},
			},
		];

		for (const scenario of scenarios) {
			// oxlint-disable-next-line no-await-in-loop
			const { data, response } = await executeQueryEngine(
				client,
				cookies,
				buildGridRequest({
					pagination: scenario.pagination,
					scope: [schema.slug],
				}),
			);

			expect(response.status).toBe(200);
			expect(getItemTitles(data.data.items)).toEqual(scenario.expectedNames);
			expect(data.data.meta.pagination).toEqual(scenario.expectedMeta);
		}
	});

	it("returns empty out-of-range pages and zero-result pagination metadata", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const emptyPageResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				pagination: { page: 100, limit: 2 },
			}),
		);
		const emptyResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				filter: {
					type: "comparison",
					operator: "eq",
					left: createEntityPropertyExpression(schema.slug, "category"),
					right: literalExpression("console"),
				},
			}),
		);

		expect(emptyPageResult.response.status).toBe(200);
		expect(emptyPageResult.data.data.items).toEqual([]);
		expect(emptyPageResult.data.data.meta.pagination).toEqual({
			total: 5,
			limit: 2,
			page: 100,
			totalPages: 3,
			hasNextPage: false,
			hasPreviousPage: true,
		});

		expect(emptyResult.response.status).toBe(200);
		expect(emptyResult.data.data.items).toHaveLength(0);
		expect(emptyResult.data.data.meta.pagination).toEqual({
			page: 1,
			total: 0,
			limit: 10,
			totalPages: 0,
			hasNextPage: false,
			hasPreviousPage: false,
		});
	});

	it("keeps empty pages aligned with filtered totals in the single-query path", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const outOfRangeFilteredResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				pagination: { page: 2, limit: 5 },
				filter: {
					type: "comparison",
					operator: "eq",
					left: createEntityPropertyExpression(schema.slug, "category"),
					right: literalExpression("phone"),
				},
			}),
		);
		const zeroResultsLaterPage = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				pagination: { page: 3, limit: 2 },
				filter: {
					type: "comparison",
					operator: "eq",
					left: createEntityPropertyExpression(schema.slug, "category"),
					right: literalExpression("console"),
				},
			}),
		);

		expect(outOfRangeFilteredResult.response.status).toBe(200);
		expect(outOfRangeFilteredResult.data.data.items).toEqual([]);
		expect(outOfRangeFilteredResult.data.data.meta.pagination).toEqual({
			page: 2,
			total: 2,
			limit: 5,
			totalPages: 1,
			hasNextPage: false,
			hasPreviousPage: true,
		});

		expect(zeroResultsLaterPage.response.status).toBe(200);
		expect(zeroResultsLaterPage.data.data.items).toEqual([]);
		expect(zeroResultsLaterPage.data.data.meta.pagination).toEqual({
			page: 3,
			total: 0,
			limit: 2,
			totalPages: 0,
			hasNextPage: false,
			hasPreviousPage: false,
		});
	});

	it("rejects empty runtime sort fields at payload validation time", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const result = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				sort: { expression: literalExpression(null), direction: "asc" },
			}),
		);

		expect(result.response.status).toBe(400);
		expect(result.error?.error.message).toContain(
			"Sort expressions must resolve to a sortable scalar value",
		);
	});

	it("filters with contains using ilike on string properties and entity @name", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();

		const nameResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				filter: {
					type: "contains",
					expression: createEntityColumnExpression(schema.slug, "name"),
					value: literalExpression("Phone"),
				},
			}),
		);
		const categoryResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				filter: {
					type: "contains",
					expression: createEntityPropertyExpression(schema.slug, "category"),
					value: literalExpression("phone"),
				},
			}),
		);

		expect(nameResult.response.status).toBe(200);
		expect(getItemTitles(nameResult.data.data.items)).toEqual(["Alpha Phone", "Gamma Phone"]);

		expect(categoryResult.response.status).toBe(200);
		expect(getItemTitles(categoryResult.data.data.items)).toEqual(["Alpha Phone", "Gamma Phone"]);
	});

	it("filters with contains using jsonb containment for array properties", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Tag Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Tagged Movie",
			propertiesSchema: {
				fields: {
					tags: {
						type: "array",
						label: "Tags",
						description: "Tags",
						items: { type: "string", label: "Tag", description: "Tag" },
					},
				},
			},
		});

		await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			name: "Sci-Fi Movie",
			entitySchemaId: schema.schemaId,
			properties: { tags: ["sci-fi", "action"] },
		});
		await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			name: "Drama Movie",
			properties: { tags: ["drama"] },
			entitySchemaId: schema.schemaId,
		});
		await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			name: "Action Movie",
			entitySchemaId: schema.schemaId,
			properties: { tags: ["action"] },
		});

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				displayConfiguration: buildGridDisplayConfiguration(
					{
						calloutProperty: null,
						primarySubtitleProperty: null,
						secondarySubtitleProperty: null,
					},
					[schema.slug],
				),
				filter: {
					type: "contains",
					expression: createEntityPropertyExpression(schema.slug, "tags"),
					value: literalExpression("action"),
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(getItemTitles(data.data.items)).toEqual(["Action Movie", "Sci-Fi Movie"]);
	});

	it("treats % and _ as literals in contains filters, not as ilike wildcards", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Metachar Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Product",
			propertiesSchema: {
				fields: { sku: { type: "string", label: "SKU", description: "SKU" } },
			},
		});

		await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			name: "Percent Item",
			properties: { sku: "A%B" },
			entitySchemaId: schema.schemaId,
		});
		await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			name: "Underscore Item",
			properties: { sku: "A_B" },
			entitySchemaId: schema.schemaId,
		});
		await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			name: "Middle Item",
			properties: { sku: "AXB" },
			entitySchemaId: schema.schemaId,
		});

		const neutralDisplay = buildGridDisplayConfiguration(
			{
				calloutProperty: null,
				primarySubtitleProperty: null,
				secondarySubtitleProperty: null,
			},
			[schema.slug],
		);

		const percentResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				displayConfiguration: neutralDisplay,
				filter: {
					type: "contains",
					expression: createEntityPropertyExpression(schema.slug, "sku"),
					value: literalExpression("A%B"),
				},
			}),
		);
		const underscoreResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				displayConfiguration: neutralDisplay,
				filter: {
					type: "contains",
					expression: createEntityPropertyExpression(schema.slug, "sku"),
					value: literalExpression("A_B"),
				},
			}),
		);

		expect(percentResult.response.status).toBe(200);
		expect(getItemTitles(percentResult.data.data.items)).toEqual(["Percent Item"]);

		expect(underscoreResult.response.status).toBe(200);
		expect(getItemTitles(underscoreResult.data.data.items)).toEqual(["Underscore Item"]);
	});

	it("rejects contains filter on array property when the value is itself an array", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Array Guard Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Tagged Item",
			propertiesSchema: {
				fields: {
					tags: {
						type: "array",
						label: "Tags",
						description: "Tags",
						items: { type: "string", label: "Tag", description: "Tag" },
					},
				},
			},
		});

		const result = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				displayConfiguration: buildGridDisplayConfiguration({
					calloutProperty: null,
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
				}),
				filter: {
					type: "contains",
					expression: createEntityPropertyExpression(schema.slug, "tags"),
					value: literalExpression(["sci-fi", "action"]),
				},
			}),
		);

		expect(result.response.status).toBe(400);
		expect(result.error?.error.message).toContain("requires a scalar or object item expression");
	});

	it("displays and filters by externalId and sandboxScriptId on global entities", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const provider = schema.providers[0];
		assertPresent(provider, "No provider found");

		const externalId = `ext-id-test-${crypto.randomUUID()}`;
		const entity = await seedMediaEntity({
			externalId,
			image: null,
			userId: null,
			properties: {},
			entitySchemaId: schema.id,
			sandboxScriptId: provider.scriptId,
			name: `External ID Entity ${crypto.randomUUID()}`,
		});
		await insertLibraryMembership({ mediaEntityId: entity.id, userId });

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildTableRequest({
				scope: [schema.slug],
				displayConfiguration: buildTableDisplayConfiguration([
					{
						label: "ExternalId",
						property: [entityField(schema.slug, "externalId")],
					},
					{
						label: "SandboxScriptId",
						property: [entityField(schema.slug, "sandboxScriptId")],
					},
				]),
				filter: {
					operator: "eq",
					type: "comparison",
					right: literalExpression(externalId),
					left: createEntityColumnExpression(schema.slug, "externalId"),
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(data.data.items).toHaveLength(1);
		expect(data.data.items[0]).toEqual(
			toQueryEngineItem([
				{ key: "column_0", kind: "text", value: externalId },
				{ key: "column_1", kind: "text", value: provider.scriptId },
			]),
		);
	});

	it("resolves externalId and sandboxScriptId as null for regular user entities", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildTableRequest({
				scope: [schema.slug],
				pagination: { page: 1, limit: 1 },
				displayConfiguration: buildTableDisplayConfiguration([
					{
						label: "ExternalId",
						property: [entityField(schema.slug, "externalId")],
					},
					{
						label: "SandboxScriptId",
						property: [entityField(schema.slug, "sandboxScriptId")],
					},
				]),
				filter: {
					operator: "eq",
					type: "comparison",
					right: literalExpression("Alpha Phone"),
					left: createEntityColumnExpression(schema.slug, "name"),
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(data.data.items).toHaveLength(1);
		expect(data.data.items[0]).toEqual(
			toQueryEngineItem([
				{ key: "column_0", kind: "null", value: null },
				{ key: "column_1", kind: "null", value: null },
			]),
		);
	});

	it("filters with isNull on externalId to find entities without an external id", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: [schema.slug],
				displayConfiguration: buildGridDisplayConfiguration({
					calloutProperty: null,
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
				}),
				filter: {
					type: "isNull",
					expression: createEntityColumnExpression(schema.slug, "externalId"),
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(data.data.items.length).toBeGreaterThan(0);
		for (const item of data.data.items) {
			expect(getQueryEngineFieldOrThrow(item, "callout").kind).toBe("null");
		}
	});

	it("resolves externalId correctly in a cross-schema query with both global and user entities", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { schema: mediaSchema } = await findBuiltinSchemaWithProviders(client, cookies);
		const provider = mediaSchema.providers[0];
		assertPresent(provider, "No provider found");

		const externalId = `cross-schema-ext-${crypto.randomUUID()}`;
		const globalEntity = await seedMediaEntity({
			externalId,
			image: null,
			userId: null,
			properties: {},
			entitySchemaId: mediaSchema.id,
			sandboxScriptId: provider.scriptId,
			name: `Cross Schema Global ${crypto.randomUUID()}`,
		});
		await insertLibraryMembership({ userId, mediaEntityId: globalEntity.id });

		const { trackerId } = await createTracker(client, cookies, {
			name: "Cross Schema Tracker",
		});
		const userSchema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "UserItem",
			propertiesSchema: {
				fields: {
					title: {
						label: "Title",
						description: "Title",
						type: "string" as const,
					},
				},
			},
		});
		const userEntityName = `Cross Schema User ${crypto.randomUUID()}`;
		await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			name: userEntityName,
			entitySchemaId: userSchema.schemaId,
		});

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildTableRequest({
				scope: [mediaSchema.slug, userSchema.slug],
				displayConfiguration: buildTableDisplayConfiguration([
					{
						label: "Name",
						property: [entityField(mediaSchema.slug, "name"), entityField(userSchema.slug, "name")],
					},
					{
						label: "ExternalId",
						property: [
							entityField(mediaSchema.slug, "externalId"),
							entityField(userSchema.slug, "externalId"),
						],
					},
				]),
				filter: {
					type: "or",
					predicates: [
						{
							operator: "eq",
							type: "comparison",
							right: literalExpression(externalId),
							left: createEntityColumnExpression(mediaSchema.slug, "externalId"),
						},
						{
							operator: "eq",
							type: "comparison",
							right: literalExpression(userEntityName),
							left: createEntityColumnExpression(userSchema.slug, "name"),
						},
					],
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(data.data.items).toHaveLength(2);

		const globalItem = data.data.items.find(
			(item) => getItemFieldValue(item, "column_1") === externalId,
		);
		const userItem = data.data.items.find(
			(item) => getItemFieldValue(item, "column_0") === userEntityName,
		);

		expect(globalItem).toBeDefined();
		expect(userItem).toBeDefined();
	});

	describe("entity-schema fields", () => {
		it("returns entity schema slug as a field", async () => {
			const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
			const { data, response } = await executeQueryEngine(client, cookies, {
				eventJoins: [],
				scope: [schema.slug],
				pagination: { page: 1, limit: 1 },
				sort: {
					direction: "asc",
					expression: createEntityColumnExpression(schema.slug, "name"),
				},
				fields: [buildQueryEngineField("entitySchemaSlug", createEntitySchemaExpression("slug"))],
			});

			expect(response.status).toBe(200);
			const field = getQueryEngineFieldOrThrow(data.data.items[0], "entitySchemaSlug");
			expect(field.kind).toBe("text");
			expect(field.value).toBe(schema.slug);
		});

		it("returns entity schema name as a field", async () => {
			const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
			const { data, response } = await executeQueryEngine(client, cookies, {
				eventJoins: [],
				scope: [schema.slug],
				pagination: { page: 1, limit: 1 },
				sort: {
					direction: "asc",
					expression: createEntityColumnExpression(schema.slug, "name"),
				},
				fields: [buildQueryEngineField("entitySchemaName", createEntitySchemaExpression("name"))],
			});

			expect(response.status).toBe(200);
			expect(data.data.items[0]).toEqual(
				toQueryEngineItem([{ key: "entitySchemaName", kind: "text", value: schema.data.name }]),
			);
		});

		it("returns entity schema isBuiltin as a boolean field", async () => {
			const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
			const { data, response } = await executeQueryEngine(client, cookies, {
				eventJoins: [],
				scope: [schema.slug],
				pagination: { page: 1, limit: 1 },
				sort: {
					direction: "asc",
					expression: createEntityColumnExpression(schema.slug, "name"),
				},
				fields: [buildQueryEngineField("isBuiltin", createEntitySchemaExpression("isBuiltin"))],
			});

			expect(response.status).toBe(200);
			expect(data.data.items[0]).toEqual(
				toQueryEngineItem([{ key: "isBuiltin", kind: "boolean", value: false }]),
			);
		});

		it("returns correct entity schema slug per entity in multi-schema queries", async () => {
			const { client, cookies, smartphoneSlug, tabletSlug } =
				await createCrossSchemaQueryEngineFixture();
			const { data, response } = await executeQueryEngine(client, cookies, {
				eventJoins: [],
				pagination: { page: 1, limit: 20 },
				scope: [smartphoneSlug, tabletSlug],
				sort: {
					direction: "asc",
					expression: createEntityColumnExpression(smartphoneSlug, "name"),
				},
				fields: [buildQueryEngineField("entitySchemaSlug", createEntitySchemaExpression("slug"))],
			});

			expect(response.status).toBe(200);
			const slugs = data.data.items.map((item) => getItemFieldValue(item, "entitySchemaSlug"));
			expect(slugs.every((slug) => slug === smartphoneSlug || slug === tabletSlug)).toBe(true);
			expect(slugs.some((slug) => slug === smartphoneSlug)).toBe(true);
			expect(slugs.some((slug) => slug === tabletSlug)).toBe(true);
		});

		it("can filter by entity schema slug", async () => {
			const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
			const { data, response } = await executeQueryEngine(client, cookies, {
				fields: [],
				eventJoins: [],
				scope: [schema.slug],
				pagination: { page: 1, limit: 10 },
				sort: {
					direction: "asc",
					expression: createEntityColumnExpression(schema.slug, "name"),
				},
				filter: {
					operator: "eq",
					type: "comparison",
					left: createEntitySchemaExpression("slug"),
					right: literalExpression(schema.slug),
				},
			});

			expect(response.status).toBe(200);
			expect(data.data.items.length).toBeGreaterThan(0);
		});

		it("can sort by entity schema name", async () => {
			const { client, cookies, smartphoneSlug, tabletSlug } =
				await createCrossSchemaQueryEngineFixture();
			const { data, response } = await executeQueryEngine(client, cookies, {
				scope: [smartphoneSlug, tabletSlug],
				eventJoins: [],
				pagination: { page: 1, limit: 20 },
				sort: {
					direction: "asc",
					expression: createEntitySchemaExpression("name"),
				},
				fields: [buildQueryEngineField("entitySchemaName", createEntitySchemaExpression("name"))],
			});

			expect(response.status).toBe(200);
			const names = data.data.items.map((item) => getItemFieldValue(item, "entitySchemaName"));
			expect(names.length).toBeGreaterThan(1);
		});

		it("rejects invalid entity schema columns", async () => {
			const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
			const { response } = await executeQueryEngine(client, cookies, {
				eventJoins: [],
				scope: [schema.slug],
				pagination: { page: 1, limit: 1 },
				sort: {
					direction: "asc",
					expression: createEntityColumnExpression(schema.slug, "name"),
				},
				fields: [buildQueryEngineField("bad", createEntitySchemaExpression("propertiesSchema"))],
			});

			expect(response.status).toBe(400);
		});

		it("rejects entity builtins masquerading as entity-schema columns", async () => {
			const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
			const { error, response } = await executeQueryEngine(client, cookies, {
				eventJoins: [],
				scope: [schema.slug],
				pagination: { page: 1, limit: 1 },
				sort: {
					direction: "asc",
					expression: createEntityColumnExpression(schema.slug, "name"),
				},
				fields: [buildQueryEngineField("bad", createEntitySchemaExpression("externalId"))],
			});

			expect(response.status).toBe(400);
			expect(error?.error.message).toBe(
				"Unsupported entity schema column 'entity-schema.externalId'",
			);
		});
	});

	registerQueryEnginePresentationAndErrorTests();

	describe("events mode", () => {
		it("returns events as primary rows with mode discriminant and pagination metadata", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { trackerId } = await createTracker(client, cookies, {
				name: "Events E2E Tracker",
			});
			const minimalSchema = {
				fields: {
					title: {
						label: "Title",
						description: "Title",
						type: "string" as const,
					},
				},
			};
			const schema = await createEntitySchema(client, cookies, {
				trackerId,
				name: "WatchItem",
				propertiesSchema: minimalSchema,
			});
			const watchSchema = await createEventSchema(client, cookies, {
				name: "Watch",
				slug: "watch",
				entitySchemaId: schema.schemaId,
				propertiesSchema: {
					fields: {
						note: {
							label: "Note",
							description: "Note",
							type: "string" as const,
						},
					},
				},
			});
			const entityId = await createQueryEngineEntity({
				client,
				cookies,
				properties: {},
				name: "My Movie",
				entitySchemaId: schema.schemaId,
			});
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				properties: {},
				eventSchemaId: watchSchema.id,
			});
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				properties: {},
				eventSchemaId: watchSchema.id,
			});

			const { data, response } = await client.POST("/query-engine/execute", {
				headers: { Cookie: cookies },
				body: {
					filter: null,
					mode: "events",
					eventJoins: [],
					computedFields: [],
					scope: [schema.slug],
					eventSchemas: [watchSchema.slug],
					pagination: { page: 1, limit: 10 },
					sort: {
						direction: "asc",
						expression: {
							type: "reference",
							reference: { type: "event", path: ["createdAt"] },
						},
					},
					fields: [
						{
							key: "eventId",
							expression: {
								type: "reference",
								reference: { type: "event", path: ["id"] },
							},
						},
					],
				},
			});

			expect(response.status).toBe(200);
			expect(data?.mode).toBe("events");
			const result = data?.mode === "events" ? data.data : undefined;
			expect(result?.items).toHaveLength(2);
			expect(result?.meta.pagination.total).toBe(2);
			expect(result?.meta.pagination.hasNextPage).toBe(false);
			expect(result?.meta.fieldOrder).toEqual(["eventId"]);
			for (const item of result?.items ?? []) {
				expect(typeof getItemFieldValue(item, "eventId")).toBe("string");
			}
		});

		it("returns only events from the specified eventSchemas", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { trackerId } = await createTracker(client, cookies, {
				name: "Events Schema Filter Tracker",
			});
			const minimalSchema = {
				fields: {
					title: {
						label: "Title",
						description: "Title",
						type: "string" as const,
					},
				},
			};
			const schema = await createEntitySchema(client, cookies, {
				trackerId,
				name: "SchemaFilterItem",
				propertiesSchema: minimalSchema,
			});
			const watchSchema = await createEventSchema(client, cookies, {
				name: "Watch",
				slug: "watch",
				entitySchemaId: schema.schemaId,
				propertiesSchema: minimalSchema,
			});
			const reviewSchema = await createEventSchema(client, cookies, {
				name: "Review",
				slug: "review",
				entitySchemaId: schema.schemaId,
				propertiesSchema: minimalSchema,
			});
			const entityId = await createQueryEngineEntity({
				client,
				cookies,
				name: "Filtered Entity",
				entitySchemaId: schema.schemaId,
				properties: {},
			});
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				properties: {},
				eventSchemaId: watchSchema.id,
			});
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				properties: {},
				eventSchemaId: reviewSchema.id,
			});

			const { data, response } = await client.POST("/query-engine/execute", {
				headers: { Cookie: cookies },
				body: {
					filter: null,
					mode: "events",
					eventJoins: [],
					computedFields: [],
					scope: [schema.slug],
					eventSchemas: [watchSchema.slug],
					pagination: { page: 1, limit: 10 },
					sort: {
						direction: "asc",
						expression: {
							type: "reference",
							reference: { type: "event", path: ["createdAt"] },
						},
					},
					fields: [
						{
							key: "schemaSlug",
							expression: {
								type: "reference",
								reference: { type: "event-schema", path: ["slug"] },
							},
						},
					],
				},
			});

			expect(response.status).toBe(200);
			const result = data?.mode === "events" ? data.data : undefined;
			expect(result?.items).toHaveLength(1);
			expect(getItemFieldValue(result?.items[0], "schemaSlug")).toBe(watchSchema.slug);
		});

		it("sorts events by a numeric event property expression", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { trackerId } = await createTracker(client, cookies, {
				name: "Events Sort Tracker",
			});
			const schema = await createEntitySchema(client, cookies, {
				trackerId,
				name: "SortItem",
				propertiesSchema: {
					fields: {
						title: {
							label: "Title",
							description: "Title",
							type: "string" as const,
						},
					},
				},
			});
			const reviewSchema = await createEventSchema(client, cookies, {
				name: "Review",
				slug: "review",
				entitySchemaId: schema.schemaId,
				propertiesSchema: {
					fields: {
						rating: {
							label: "Rating",
							description: "Rating",
							type: "integer" as const,
						},
					},
				},
			});
			const entityId = await createQueryEngineEntity({
				client,
				cookies,
				properties: {},
				name: "Sort Entity",
				entitySchemaId: schema.schemaId,
			});
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				properties: { rating: 3 },
				eventSchemaId: reviewSchema.id,
			});
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				properties: { rating: 1 },
				eventSchemaId: reviewSchema.id,
			});
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				properties: { rating: 5 },
				eventSchemaId: reviewSchema.id,
			});

			const { data, response } = await client.POST("/query-engine/execute", {
				headers: { Cookie: cookies },
				body: {
					filter: null,
					mode: "events",
					eventJoins: [],
					computedFields: [],
					scope: [schema.slug],
					eventSchemas: [reviewSchema.slug],
					pagination: { page: 1, limit: 10 },
					sort: {
						direction: "desc",
						expression: {
							type: "reference",
							reference: {
								type: "event",
								path: ["properties", "rating"],
								eventSchemaSlug: reviewSchema.slug,
							},
						},
					},
					fields: [
						{
							key: "rating",
							expression: {
								type: "reference",
								reference: {
									type: "event",
									path: ["properties", "rating"],
									eventSchemaSlug: reviewSchema.slug,
								},
							},
						},
					],
				},
			});

			expect(response.status).toBe(200);
			const items = data?.mode === "events" ? data.data.items : [];
			expect(items).toHaveLength(3);
			const ratings = items.map((item) => getItemFieldValue(item, "rating"));
			expect(ratings).toEqual([5, 3, 1]);
		});

		it("returns entity name and event schema slug alongside events", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { trackerId } = await createTracker(client, cookies, {
				name: "Events Refs Tracker",
			});
			const schema = await createEntitySchema(client, cookies, {
				trackerId,
				name: "RefsItem",
				propertiesSchema: {
					fields: {
						title: {
							label: "Title",
							description: "Title",
							type: "string" as const,
						},
					},
				},
			});
			const reviewSchema = await createEventSchema(client, cookies, {
				name: "Review",
				slug: "review",
				entitySchemaId: schema.schemaId,
				propertiesSchema: {
					fields: {
						rating: {
							label: "Rating",
							description: "Rating",
							type: "integer" as const,
						},
					},
				},
			});
			const entityId = await createQueryEngineEntity({
				client,
				cookies,
				properties: {},
				name: "Named Entity",
				entitySchemaId: schema.schemaId,
			});
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				properties: { rating: 4 },
				eventSchemaId: reviewSchema.id,
			});

			const { data, response } = await client.POST("/query-engine/execute", {
				headers: { Cookie: cookies },
				body: {
					filter: null,
					mode: "events",
					eventJoins: [],
					computedFields: [],
					scope: [schema.slug],
					eventSchemas: [reviewSchema.slug],
					pagination: { page: 1, limit: 10 },
					sort: {
						direction: "asc",
						expression: {
							type: "reference",
							reference: { type: "event", path: ["createdAt"] },
						},
					},
					fields: [
						{
							key: "entityName",
							expression: {
								type: "reference",
								reference: {
									type: "entity",
									path: ["name"],
									slug: schema.slug,
								},
							},
						},
						{
							key: "eventSchemaSlug",
							expression: {
								type: "reference",
								reference: { type: "event-schema", path: ["slug"] },
							},
						},
						{
							key: "rating",
							expression: {
								type: "reference",
								reference: {
									type: "event",
									path: ["properties", "rating"],
									eventSchemaSlug: reviewSchema.slug,
								},
							},
						},
					],
				},
			});

			expect(response.status).toBe(200);
			const items = data?.mode === "events" ? data.data.items : [];
			expect(items).toHaveLength(1);
			const firstItem = items[0] ?? {};
			expect(getItemFieldValue(firstItem, "entityName")).toBe("Named Entity");
			expect(getItemFieldValue(firstItem, "eventSchemaSlug")).toBe(reviewSchema.slug);
			expect(getItemFieldValue(firstItem, "rating")).toBe(4);
		});

		it("returns correct paginated results and metadata in events mode", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { trackerId } = await createTracker(client, cookies, {
				name: "Events Pagination Tracker",
			});
			const schema = await createEntitySchema(client, cookies, {
				trackerId,
				name: "PaginationItem",
				propertiesSchema: {
					fields: {
						title: {
							label: "Title",
							description: "Title",
							type: "string" as const,
						},
					},
				},
			});
			const watchSchema = await createEventSchema(client, cookies, {
				name: "Watch",
				slug: "watch",
				entitySchemaId: schema.schemaId,
				propertiesSchema: {
					fields: {
						seq: { label: "Seq", description: "Seq", type: "integer" as const },
					},
				},
			});
			const entityId = await createQueryEngineEntity({
				client,
				cookies,
				name: "Pagination Entity",
				entitySchemaId: schema.schemaId,
				properties: {},
			});
			for (const seq of [1, 2, 3, 4, 5]) {
				// oxlint-disable-next-line no-await-in-loop
				await createQueryEngineEvent({
					client,
					cookies,
					entityId,
					properties: { seq },
					eventSchemaId: watchSchema.id,
				});
			}

			const sortExpr = {
				direction: "asc" as const,
				expression: {
					type: "reference" as const,
					reference: {
						type: "event" as const,
						path: ["properties", "seq"],
						eventSchemaSlug: watchSchema.slug,
					},
				},
			};
			const fields = [
				{
					key: "seq",
					expression: {
						type: "reference" as const,
						reference: {
							type: "event" as const,
							path: ["properties", "seq"],
							eventSchemaSlug: watchSchema.slug,
						},
					},
				},
			];

			const page1 = await client.POST("/query-engine/execute", {
				headers: { Cookie: cookies },
				body: {
					fields,
					filter: null,
					sort: sortExpr,
					mode: "events",
					eventJoins: [],
					computedFields: [],
					scope: [schema.slug],
					eventSchemas: [watchSchema.slug],
					pagination: { page: 1, limit: 2 },
				},
			});
			const page3 = await client.POST("/query-engine/execute", {
				headers: { Cookie: cookies },
				body: {
					fields,
					filter: null,
					mode: "events",
					eventJoins: [],
					sort: sortExpr,
					computedFields: [],
					scope: [schema.slug],
					eventSchemas: [watchSchema.slug],
					pagination: { page: 3, limit: 2 },
				},
			});

			const result1 = page1.data?.mode === "events" ? page1.data.data : undefined;
			const result3 = page3.data?.mode === "events" ? page3.data.data : undefined;

			expect(page1.response.status).toBe(200);
			expect(result1?.items).toHaveLength(2);
			expect(result1?.meta.pagination).toEqual({
				page: 1,
				total: 5,
				limit: 2,
				totalPages: 3,
				hasNextPage: true,
				hasPreviousPage: false,
			});
			expect(getItemFieldValue(result1?.items[0], "seq")).toBe(1);

			expect(page3.response.status).toBe(200);
			expect(result3?.items).toHaveLength(1);
			expect(result3?.meta.pagination).toEqual({
				page: 3,
				total: 5,
				limit: 2,
				totalPages: 3,
				hasNextPage: false,
				hasPreviousPage: true,
			});
			expect(getItemFieldValue(result3?.items[0], "seq")).toBe(5);
		});

		it("attaches event-join data to each event row via a lateral join", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { trackerId } = await createTracker(client, cookies, {
				name: "Events Join Tracker",
			});
			const schema = await createEntitySchema(client, cookies, {
				trackerId,
				name: "JoinItem",
				propertiesSchema: {
					fields: {
						title: {
							label: "Title",
							description: "Title",
							type: "string" as const,
						},
					},
				},
			});
			const watchSchema = await createEventSchema(client, cookies, {
				name: "Watch",
				slug: "watch",
				entitySchemaId: schema.schemaId,
				propertiesSchema: {
					fields: {
						note: {
							label: "Note",
							description: "Note",
							type: "string" as const,
						},
					},
				},
			});
			const reviewSchema = await createEventSchema(client, cookies, {
				name: "Review",
				slug: "review",
				entitySchemaId: schema.schemaId,
				propertiesSchema: {
					fields: {
						rating: {
							label: "Rating",
							description: "Rating",
							type: "integer" as const,
						},
					},
				},
			});
			const entityId = await createQueryEngineEntity({
				client,
				cookies,
				properties: {},
				name: "Join Entity",
				entitySchemaId: schema.schemaId,
			});
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				eventSchemaId: watchSchema.id,
				properties: { note: "first watch" },
			});
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				eventSchemaId: watchSchema.id,
				properties: { note: "second watch" },
			});
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				properties: { rating: 7 },
				eventSchemaId: reviewSchema.id,
			});

			const reviewEventSchemas = await listEventSchemas(client, cookies, schema.schemaId);
			const reviewEventSchema = reviewEventSchemas.find((s) => s.slug === reviewSchema.slug);
			assertPresent(reviewEventSchema, "Review event schema not found");

			const { data, response } = await client.POST("/query-engine/execute", {
				headers: { Cookie: cookies },
				body: {
					filter: null,
					mode: "events",
					computedFields: [],
					scope: [schema.slug],
					eventSchemas: [watchSchema.slug],
					pagination: { page: 1, limit: 10 },
					sort: {
						direction: "asc",
						expression: {
							type: "reference",
							reference: { type: "event", path: ["createdAt"] },
						},
					},
					eventJoins: [
						{
							key: "review",
							kind: "latestEvent",
							eventSchemaSlug: reviewSchema.slug,
						},
					],
					fields: [
						{
							key: "latestRating",
							expression: {
								type: "reference",
								reference: {
									joinKey: "review",
									type: "event-join",
									path: ["properties", "rating"],
								},
							},
						},
					],
				},
			});

			expect(response.status).toBe(200);
			const items = data?.mode === "events" ? data.data.items : [];
			// Both watch events should have the latest review rating attached
			expect(items).toHaveLength(2);
			for (const item of items) {
				expect(getItemFieldValue(item, "latestRating")).toBe(7);
			}
		});

		it("filters events by an event property predicate before returning rows", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { trackerId } = await createTracker(client, cookies, {
				name: "Events Filter Tracker",
			});
			const schema = await createEntitySchema(client, cookies, {
				trackerId,
				name: "FilterModeItem",
				propertiesSchema: {
					fields: {
						title: {
							label: "Title",
							description: "Title",
							type: "string" as const,
						},
					},
				},
			});
			const reviewSchema = await createEventSchema(client, cookies, {
				name: "Review",
				slug: "review",
				entitySchemaId: schema.schemaId,
				propertiesSchema: {
					fields: {
						rating: {
							label: "Rating",
							description: "Rating",
							type: "integer" as const,
						},
					},
				},
			});
			const entityId = await createQueryEngineEntity({
				client,
				cookies,
				name: "Filter Mode Entity",
				entitySchemaId: schema.schemaId,
				properties: {},
			});
			for (const rating of [1, 2, 3, 4, 5]) {
				// oxlint-disable-next-line no-await-in-loop
				await createQueryEngineEvent({
					client,
					cookies,
					entityId,
					properties: { rating },
					eventSchemaId: reviewSchema.id,
				});
			}

			const ratingRef = {
				type: "reference" as const,
				reference: {
					type: "event" as const,
					path: ["properties", "rating"],
					eventSchemaSlug: reviewSchema.slug,
				},
			};

			const { data, response } = await client.POST("/query-engine/execute", {
				headers: { Cookie: cookies },
				body: {
					mode: "events",
					eventJoins: [],
					computedFields: [],
					scope: [schema.slug],
					eventSchemas: [reviewSchema.slug],
					pagination: { page: 1, limit: 10 },
					sort: { direction: "asc", expression: ratingRef },
					fields: [{ key: "rating", expression: ratingRef }],
					filter: {
						operator: "gte",
						left: ratingRef,
						type: "comparison",
						right: literalExpression(4),
					},
				},
			});

			expect(response.status).toBe(200);
			const items = data?.mode === "events" ? data.data.items : [];
			expect(items).toHaveLength(2);
			const ratings = items.map((item) => getItemFieldValue(item, "rating"));
			expect(ratings).toEqual([4, 5]);
		});

		it("rejects event-aggregate references in events mode", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { trackerId } = await createTracker(client, cookies, {
				name: "Events Ref Rejection Tracker",
			});
			const schema = await createEntitySchema(client, cookies, {
				trackerId,
				name: "RefRejectionItem",
				propertiesSchema: {
					fields: {
						title: {
							label: "Title",
							description: "Title",
							type: "string" as const,
						},
					},
				},
			});
			const reviewSchema = await createEventSchema(client, cookies, {
				name: "Review",
				slug: "review",
				entitySchemaId: schema.schemaId,
				propertiesSchema: {
					fields: {
						rating: {
							label: "Rating",
							description: "Rating",
							type: "integer" as const,
						},
					},
				},
			});

			const { error, response } = await client.POST("/query-engine/execute", {
				headers: { Cookie: cookies },
				body: {
					filter: null,
					mode: "events",
					eventJoins: [],
					computedFields: [],
					scope: [schema.slug],
					eventSchemas: [reviewSchema.slug],
					pagination: { page: 1, limit: 10 },
					sort: {
						direction: "asc",
						expression: {
							type: "reference",
							reference: { type: "event", path: ["createdAt"] },
						},
					},
					fields: [
						{
							key: "avgRating",
							expression: {
								type: "reference",
								reference: {
									aggregation: "avg",
									type: "event-aggregate",
									path: ["properties", "rating"],
									eventSchemaSlug: reviewSchema.slug,
								},
							},
						},
					],
				},
			});

			expect(response.status).toBe(400);
			expect(error?.error.message).toBe(
				"event-aggregate references are not supported in this query mode",
			);
		});

		it("rejects a missing event-join reference in events mode", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { trackerId } = await createTracker(client, cookies, {
				name: "Events Join Ref Reject Tracker",
			});
			const schema = await createEntitySchema(client, cookies, {
				trackerId,
				name: "JoinRefRejectItem",
				propertiesSchema: {
					fields: {
						title: {
							label: "Title",
							description: "Title",
							type: "string" as const,
						},
					},
				},
			});
			const watchSchema = await createEventSchema(client, cookies, {
				name: "Watch",
				slug: "watch",
				entitySchemaId: schema.schemaId,
				propertiesSchema: {
					fields: {
						note: {
							label: "Note",
							description: "Note",
							type: "string" as const,
						},
					},
				},
			});

			const { error, response } = await client.POST("/query-engine/execute", {
				headers: { Cookie: cookies },
				body: {
					filter: null,
					mode: "events",
					eventJoins: [],
					computedFields: [],
					scope: [schema.slug],
					pagination: { page: 1, limit: 10 },
					eventSchemas: [watchSchema.slug],
					sort: {
						direction: "asc",
						expression: {
							type: "reference",
							reference: { type: "event", path: ["createdAt"] },
						},
					},
					fields: [
						{
							key: "reviewRating",
							expression: {
								type: "reference",
								reference: {
									type: "event-join",
									joinKey: "review",
									path: ["properties", "rating"],
								},
							},
						},
					],
				},
			});

			expect(response.status).toBe(400);
			expect(error?.error.message).toBe(
				"Event join 'event.review' is not part of this runtime request",
			);
		});

		it("rejects primary event references in entities mode", async () => {
			const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();

			const { error, response } = await executeQueryEngine(client, cookies, {
				eventJoins: [],
				scope: [schema.slug],
				pagination: { page: 1, limit: 1 },
				sort: {
					direction: "asc",
					expression: createEntityColumnExpression(schema.slug, "name"),
				},
				fields: [
					buildQueryEngineField("eventCreatedAt", {
						type: "reference",
						reference: { type: "event", path: ["createdAt"] },
					}),
				],
			});

			expect(response.status).toBe(400);
			expect(error?.error.message).toBe(
				"Primary event references are not supported in this query mode",
			);
		});

		it("rejects primary event property sort expressions without eventSchemaSlug in events mode", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { trackerId } = await createTracker(client, cookies, {
				name: "Primary Event Schema Slug Tracker",
			});
			const schema = await createEntitySchema(client, cookies, {
				trackerId,
				name: "StrictEventProps",
				propertiesSchema: {
					fields: {
						title: {
							label: "Title",
							description: "Title",
							type: "string" as const,
						},
					},
				},
			});
			const reviewSchema = await createEventSchema(client, cookies, {
				name: "Review",
				slug: "review",
				entitySchemaId: schema.schemaId,
				propertiesSchema: {
					fields: {
						rating: {
							label: "Rating",
							description: "Rating",
							type: "integer" as const,
						},
					},
				},
			});
			const entityId = await createQueryEngineEntity({
				client,
				cookies,
				name: "Strict Event Entity",
				entitySchemaId: schema.schemaId,
				properties: {},
			});
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				eventSchemaId: reviewSchema.id,
				properties: { rating: 5 },
			});

			const { error, response } = await client.POST("/query-engine/execute", {
				headers: { Cookie: cookies },
				body: {
					filter: null,
					mode: "events",
					eventJoins: [],
					computedFields: [],
					scope: [schema.slug],
					eventSchemas: [reviewSchema.slug],
					pagination: { page: 1, limit: 10 },
					sort: {
						direction: "asc",
						expression: {
							type: "reference",
							reference: {
								type: "event",
								path: ["properties", "rating"],
							},
						},
					},
					fields: [],
				},
			});

			expect(response.status).toBe(400);
			expect(error?.error.message).toBe(
				"Primary event property references in this context must specify eventSchemaSlug",
			);
		});
	});

	describe("time-series mode", () => {
		it("returns day buckets with correct event counts and fills empty buckets with 0", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { trackerId } = await createTracker(client, cookies, {
				name: "TimeSeries Tracker",
			});
			const minimalPropertiesSchema = {
				fields: {
					title: {
						label: "Title",
						description: "Title",
						type: "string" as const,
					},
				},
			};
			const schema = await createEntitySchema(client, cookies, {
				trackerId,
				name: "TSItem",
				propertiesSchema: minimalPropertiesSchema,
			});
			const reviewSchema = await createEventSchema(client, cookies, {
				name: "Review",
				slug: "review",
				entitySchemaId: schema.schemaId,
				propertiesSchema: minimalPropertiesSchema,
			});
			const entityId = await createQueryEngineEntity({
				client,
				cookies,
				properties: {},
				name: "TS Entity",
				entitySchemaId: schema.schemaId,
			});

			// Create 2 events now. They will fall in today's bucket.
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				properties: {},
				eventSchemaId: reviewSchema.id,
			});
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				properties: {},
				eventSchemaId: reviewSchema.id,
			});

			// Date range: today UTC to today+3 days UTC (3 day buckets)
			const startAt = dayjs.utc().startOf("day").toISOString();
			const endAt = dayjs.utc().startOf("day").add(3, "day").toISOString();

			const { data, response } = await client.POST("/query-engine/execute", {
				headers: { Cookie: cookies },
				body: {
					filter: null,
					bucket: "day",
					mode: "timeSeries",
					computedFields: [],
					scope: [schema.slug],
					metric: { type: "count" },
					dateRange: { startAt, endAt },
					eventSchemas: [reviewSchema.slug],
				},
			});

			expect(response.status).toBe(200);
			expect(data?.mode).toBe("timeSeries");
			const buckets = data?.mode === "timeSeries" ? data.data.buckets : [];
			expect(buckets).toHaveLength(3);
			expect(buckets[0]?.value).toBe(2);
			// Future buckets should be 0 (empty bucket fill)
			expect(buckets[1]?.value).toBe(0);
			expect(buckets[2]?.value).toBe(0);
			expect(typeof buckets[0]?.date).toBe("string");
		});

		it("returns timeSeries mode discriminant in response", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { trackerId } = await createTracker(client, cookies, {
				name: "TimeSeries Mode Check",
			});
			const minimalPropertiesSchema = {
				fields: {
					title: {
						label: "Title",
						description: "Title",
						type: "string" as const,
					},
				},
			};
			const schema = await createEntitySchema(client, cookies, {
				trackerId,
				name: "ModeCheckItem",
				propertiesSchema: minimalPropertiesSchema,
			});
			const reviewSchema = await createEventSchema(client, cookies, {
				name: "Review",
				slug: "review",
				entitySchemaId: schema.schemaId,
				propertiesSchema: minimalPropertiesSchema,
			});

			const startAt = dayjs.utc().startOf("day").toISOString();
			const endAt = dayjs.utc().startOf("day").add(1, "day").toISOString();

			const { data, response } = await client.POST("/query-engine/execute", {
				headers: { Cookie: cookies },
				body: {
					filter: null,
					bucket: "hour",
					mode: "timeSeries",
					computedFields: [],
					scope: [schema.slug],
					metric: { type: "count" },
					dateRange: { startAt, endAt },
					eventSchemas: [reviewSchema.slug],
				},
			});

			expect(response.status).toBe(200);
			expect(data?.mode).toBe("timeSeries");
			const buckets = data?.mode === "timeSeries" ? data.data.buckets : [];
			expect(buckets).toHaveLength(24);
		});

		it("rejects requests where startAt is not before endAt", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { trackerId } = await createTracker(client, cookies, {
				name: "TimeSeries DateRange Check",
			});
			const minimalPropertiesSchema = {
				fields: {
					title: {
						label: "Title",
						description: "Title",
						type: "string" as const,
					},
				},
			};
			const schema = await createEntitySchema(client, cookies, {
				trackerId,
				name: "DateRangeItem",
				propertiesSchema: minimalPropertiesSchema,
			});
			const reviewSchema = await createEventSchema(client, cookies, {
				name: "Review",
				slug: "review",
				entitySchemaId: schema.schemaId,
				propertiesSchema: minimalPropertiesSchema,
			});

			const now = dayjs.utc().toISOString();

			const { response } = await client.POST("/query-engine/execute", {
				headers: { Cookie: cookies },
				body: {
					filter: null,
					bucket: "day",
					mode: "timeSeries",
					computedFields: [],
					scope: [schema.slug],
					metric: { type: "count" },
					eventSchemas: [reviewSchema.slug],
					// endAt before startAt
					dateRange: { startAt: now, endAt: now },
				},
			});

			expect(response.status).toBe(400);
		});

		it("returns zero for a partial bucket range that excludes the event", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { trackerId } = await createTracker(client, cookies, {
				name: "TimeSeries Single Bucket",
			});
			const minimalPropertiesSchema = {
				fields: {
					title: {
						label: "Title",
						description: "Title",
						type: "string" as const,
					},
				},
			};
			const schema = await createEntitySchema(client, cookies, {
				trackerId,
				name: "SingleBucketItem",
				propertiesSchema: minimalPropertiesSchema,
			});
			const reviewSchema = await createEventSchema(client, cookies, {
				name: "Review",
				slug: "review",
				entitySchemaId: schema.schemaId,
				propertiesSchema: minimalPropertiesSchema,
			});
			const entityId = await createQueryEngineEntity({
				client,
				cookies,
				properties: {},
				name: "Single Bucket Entity",
				entitySchemaId: schema.schemaId,
			});

			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				properties: {},
				eventSchemaId: reviewSchema.id,
			});

			const startAt = dayjs.utc().add(1, "year").startOf("day").add(10, "hour").toISOString();
			const endAt = dayjs.utc().add(1, "year").startOf("day").add(12, "hour").toISOString();

			const { data, response } = await client.POST("/query-engine/execute", {
				headers: { Cookie: cookies },
				body: {
					filter: null,
					bucket: "day",
					mode: "timeSeries",
					computedFields: [],
					scope: [schema.slug],
					metric: { type: "count" },
					dateRange: { startAt, endAt },
					eventSchemas: [reviewSchema.slug],
				},
			});

			expect(response.status).toBe(200);
			const buckets = data?.mode === "timeSeries" ? data.data.buckets : [];
			expect(buckets).toHaveLength(1);
			expect(buckets[0]?.value).toBe(0);
		});

		it("filters events before bucketing with an event property filter", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { trackerId } = await createTracker(client, cookies, {
				name: "TimeSeries Filter Tracker",
			});
			const minimalPropertiesSchema = {
				fields: {
					title: {
						type: "string" as const,
						label: "Title",
						description: "Title",
					},
				},
			};
			const schema = await createEntitySchema(client, cookies, {
				trackerId,
				name: "FilterItem",
				propertiesSchema: minimalPropertiesSchema,
			});
			const reviewSchema = await createEventSchema(client, cookies, {
				name: "Review",
				slug: "review",
				entitySchemaId: schema.schemaId,
				propertiesSchema: {
					fields: {
						rating: { type: "integer", label: "Rating", description: "Rating" },
					},
				},
			});
			const entityId = await createQueryEngineEntity({
				client,
				cookies,
				properties: {},
				name: "Filter Entity",
				entitySchemaId: schema.schemaId,
			});

			// Create 3 events: 2 with rating=5, 1 with rating=3
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				properties: { rating: 5 },
				eventSchemaId: reviewSchema.id,
			});
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				properties: { rating: 5 },
				eventSchemaId: reviewSchema.id,
			});
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				properties: { rating: 3 },
				eventSchemaId: reviewSchema.id,
			});

			const startAt = dayjs.utc().startOf("day").toISOString();
			const endAt = dayjs.utc().startOf("day").add(1, "day").toISOString();

			const { data, response } = await client.POST("/query-engine/execute", {
				headers: { Cookie: cookies },
				body: {
					bucket: "day",
					mode: "timeSeries",
					computedFields: [],
					scope: [schema.slug],
					metric: { type: "count" },
					dateRange: { startAt, endAt },
					eventSchemas: [reviewSchema.slug],
					filter: {
						operator: "gte",
						type: "comparison",
						right: literalExpression(5),
						left: {
							type: "reference",
							reference: {
								type: "event",
								path: ["properties", "rating"],
								eventSchemaSlug: reviewSchema.slug,
							},
						},
					},
				},
			});

			expect(response.status).toBe(200);
			const buckets = data?.mode === "timeSeries" ? data.data.buckets : [];
			// Only the 2 events with rating >= 5 should be counted
			expect(buckets[0]?.value).toBe(2);
		});

		it("rejects event-join references in time-series mode", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { trackerId } = await createTracker(client, cookies, {
				name: "TimeSeries Ref Rejection",
			});
			const minimalPropertiesSchema = {
				fields: {
					title: {
						label: "Title",
						description: "Title",
						type: "string" as const,
					},
				},
			};
			const schema = await createEntitySchema(client, cookies, {
				trackerId,
				name: "RefRejection",
				propertiesSchema: minimalPropertiesSchema,
			});
			const reviewSchema = await createEventSchema(client, cookies, {
				name: "Review",
				slug: "review",
				entitySchemaId: schema.schemaId,
				propertiesSchema: minimalPropertiesSchema,
			});

			const startAt = dayjs.utc().startOf("day").toISOString();
			const endAt = dayjs.utc().startOf("day").add(1, "day").toISOString();

			const { error, response } = await client.POST("/query-engine/execute", {
				headers: { Cookie: cookies },
				body: {
					filter: null,
					bucket: "day",
					mode: "timeSeries",
					computedFields: [],
					scope: [schema.slug],
					dateRange: { startAt, endAt },
					eventSchemas: [reviewSchema.slug],
					metric: {
						type: "sum",
						expression: {
							type: "reference",
							reference: {
								joinKey: "review",
								type: "event-join",
								path: ["createdAt"],
							},
						},
					},
				},
			});

			expect(response.status).toBe(400);
			expect(error?.error.message).toBe(
				"Event join 'event.review' is not part of this runtime request",
			);
		});

		it("rejects non-numeric sum metric expressions", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { trackerId } = await createTracker(client, cookies, {
				name: "TimeSeries Sum Type Rejection",
			});
			const minimalPropertiesSchema = {
				fields: {
					title: {
						label: "Title",
						description: "Title",
						type: "string" as const,
					},
				},
			};
			const schema = await createEntitySchema(client, cookies, {
				trackerId,
				name: "SumTypeRejection",
				propertiesSchema: minimalPropertiesSchema,
			});
			const reviewSchema = await createEventSchema(client, cookies, {
				name: "Review",
				slug: "review",
				entitySchemaId: schema.schemaId,
				propertiesSchema: minimalPropertiesSchema,
			});

			const startAt = dayjs.utc().startOf("day").toISOString();
			const endAt = dayjs.utc().startOf("day").add(1, "day").toISOString();

			const { response } = await client.POST("/query-engine/execute", {
				headers: { Cookie: cookies },
				body: {
					filter: null,
					bucket: "day",
					mode: "timeSeries",
					computedFields: [],
					scope: [schema.slug],
					dateRange: { startAt, endAt },
					eventSchemas: [reviewSchema.slug],
					metric: {
						type: "sum",
						expression: { type: "reference", reference: { type: "event", path: ["createdAt"] } },
					},
				},
			});

			// createdAt is a datetime, not a number
			expect(response.status).toBe(400);
		});
	});
});
