import { describe, expect, it } from "bun:test";

import {
	buildRowsDoc,
	createAuthenticatedClient,
	createEventSchema,
	createGlobalBookEntityFixture,
	createRelationship,
	createRelationshipSchema,
	createQueryEngineEntity,
	createQueryEngineEvent,
	createQueryEngineTrackerAndSchema,
	executeQueryEngine,
	executeQueryEngineError,
	executeTimeSeriesQueryEngine,
	expectMalformedQueryBadRequest,
	insertLibraryMembership,
	propertyRef,
	requireQueryEngineFieldValue,
	systemRef,
	type QueryEnginePayload,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";

describe("Time series returns", () => {
	it("returns event buckets with half-open range filtering and zero fill", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId: lessonSchemaId, slug: lessonSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{ schemaName: "TimeSeriesEventLesson" },
		);
		const completeSlug = `time-series-complete-${crypto.randomUUID()}`;
		const completeSchema = await createEventSchema(client, {
			slug: completeSlug,
			name: "Time Series Complete",
			entitySchemaId: lessonSchemaId,
		});
		const lesson = await createQueryEngineEntity(client, {
			name: "Time Series Lesson",
			entitySchemaId: lessonSchemaId,
		});

		await createQueryEngineEvent(client, {
			entityId: lesson.id,
			properties: { note: "included" },
			eventSchemaId: completeSchema.id,
			occurredAt: "2026-01-01T12:00:00.000Z",
		});
		await createQueryEngineEvent(client, {
			entityId: lesson.id,
			properties: { note: "excluded" },
			eventSchemaId: completeSchema.id,
			occurredAt: "2026-01-03T00:00:00.000Z",
		});

		const doc: QueryEnginePayload = {
			source: {
				where: null,
				type: "events",
				alias: "completion",
				schemas: [completeSlug],
				entity: { alias: "lesson", schemas: [lessonSlug] },
			},
			output: {
				type: "timeSeries",
				measure: { aggregation: { function: "count" } },
				time: {
					bucket: "day",
					expr: systemRef("completion", "occurredAt"),
					range: { endAt: "2026-01-03T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
				},
			},
		};

		const result = await executeTimeSeriesQueryEngine(client, doc);

		expect(result.data.buckets).toEqual([
			{ value: 1, endAt: "2026-01-02T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
			{ value: 0, endAt: "2026-01-03T00:00:00.000Z", startAt: "2026-01-02T00:00:00.000Z" },
		]);
	});

	it("returns entity buckets using a date property", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "TimeSeriesEntity",
			propertiesSchema: {
				fields: {
					publishedAt: { type: "datetime", label: "Published At", description: "Published at" },
				},
			},
		});
		await Promise.all([
			createQueryEngineEntity(client, {
				name: "Entity One",
				entitySchemaId: schemaId,
				properties: { publishedAt: "2026-01-01T12:00:00.000Z" },
			}),
			createQueryEngineEntity(client, {
				name: "Entity Two",
				entitySchemaId: schemaId,
				properties: { publishedAt: "2026-01-01T13:00:00.000Z" },
			}),
		]);

		const doc: QueryEnginePayload = {
			source: { where: null, type: "entities", alias: "entity", schemas: [slug] },
			output: {
				type: "timeSeries",
				measure: { aggregation: { function: "count" } },
				time: {
					bucket: "day",
					expr: propertyRef("entity", slug, "publishedAt"),
					range: { endAt: "2026-01-03T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
				},
			},
		};

		const result = await executeTimeSeriesQueryEngine(client, doc);

		expect(result.data.buckets).toHaveLength(2);
		expect(result.data.buckets[0]?.value).toBe(2);
		expect(result.data.buckets[1]?.value).toBe(0);
	});

	it("returns relationship buckets using relationship createdAt", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId: memberSchemaId, slug: memberSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{ schemaName: "TimeSeriesRelMember" },
		);
		const { schemaId: collectionSchemaId, slug: collectionSlug } =
			await createQueryEngineTrackerAndSchema(client, { schemaName: "TimeSeriesRelCollection" });
		const relationshipSlug = `time-series-membership-${crypto.randomUUID()}`;
		const relationshipSchema = await createRelationshipSchema(client, {
			slug: relationshipSlug,
			name: "Time Series Membership",
			sourceEntitySchemaId: memberSchemaId,
			targetEntitySchemaId: collectionSchemaId,
		});
		const member = await createQueryEngineEntity(client, {
			name: "Time Series Member",
			entitySchemaId: memberSchemaId,
		});
		const collection = await createQueryEngineEntity(client, {
			name: "Time Series Collection",
			entitySchemaId: collectionSchemaId,
		});
		await createRelationship(client, {
			sourceEntityId: member.id,
			targetEntityId: collection.id,
			relationshipSchemaId: relationshipSchema.id,
		});

		const doc: QueryEnginePayload = {
			output: {
				type: "timeSeries",
				measure: { aggregation: { function: "count" } },
				time: {
					bucket: "month",
					expr: systemRef("membership", "createdAt"),
					range: { endAt: "2031-01-01T00:00:00.000Z", startAt: "2020-01-01T00:00:00.000Z" },
				},
			},
			source: {
				where: null,
				alias: "membership",
				type: "relationships",
				schemas: [relationshipSlug],
				sourceEntity: { alias: "memberEntity", schemas: [memberSlug] },
				targetEntity: { alias: "collectionEntity", schemas: [collectionSlug] },
			},
		};

		const result = await executeTimeSeriesQueryEngine(client, doc);

		expect(result.data.buckets.some((bucket) => bucket.value === 1)).toBe(true);
	});

	it("rejects date ranges that produce more than 1000 buckets", async () => {
		const { client } = await createAuthenticatedClient();
		const { slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "TimeSeriesBucketCap",
		});
		const doc: QueryEnginePayload = {
			source: { where: null, type: "entities", alias: "entity", schemas: [slug] },
			output: {
				type: "timeSeries",
				measure: { aggregation: { function: "count" } },
				time: {
					bucket: "day",
					expr: systemRef("entity", "createdAt"),
					range: { endAt: "2028-10-01T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
				},
			},
		};

		const error = await executeQueryEngineError(client, doc);
		expect(error).toMatchObject({ _tag: "BadRequest" });
	});
});

describe("Visibility boundary", () => {
	it("does not allow a user to query another user's private entity schema", async () => {
		const userA = await createAuthenticatedClient();
		const userB = await createAuthenticatedClient();

		const { slug } = await createQueryEngineTrackerAndSchema(userA.client, {
			schemaName: "UserAPrivateCourse",
		});

		const doc = buildRowsDoc({ fields: [], alias: "course", schemas: [slug] });

		const error = await executeQueryEngineError(userB.client, doc);
		expect(error).toMatchObject({ _tag: "NotFound" });
	});

	it("only returns entities owned by the authenticated user", async () => {
		const userA = await createAuthenticatedClient();
		const userB = await createAuthenticatedClient();

		const { schemaId: schemaA, slug: slugA } = await createQueryEngineTrackerAndSchema(
			userA.client,
			{
				schemaName: "VisibilityCourse",
			},
		);
		const { schemaId: schemaB, slug: slugB } = await createQueryEngineTrackerAndSchema(
			userB.client,
			{
				schemaName: "VisibilityCourse",
			},
		);

		await createQueryEngineEntity(userA.client, {
			name: "User A Entity",
			entitySchemaId: schemaA,
		});
		await createQueryEngineEntity(userB.client, {
			name: "User B Entity",
			entitySchemaId: schemaB,
		});

		const resultA = await executeQueryEngine(
			userA.client,
			buildRowsDoc({
				alias: "course",
				schemas: [slugA],
				fields: [{ key: "name", expr: systemRef("course", "name") }],
			}),
		);

		expect(resultA.data.items).toHaveLength(1);
		const itemA = resultA.data.items[0];
		assertPresent(itemA, "Expected User A's result item");
		expect(requireQueryEngineFieldValue(itemA, "name").value).toBe("User A Entity");

		const resultB = await executeQueryEngine(
			userB.client,
			buildRowsDoc({
				alias: "course",
				schemas: [slugB],
				fields: [{ key: "name", expr: systemRef("course", "name") }],
			}),
		);

		expect(resultB.data.items).toHaveLength(1);
		const itemB = resultB.data.items[0];
		assertPresent(itemB, "Expected User B's result item");
		expect(requireQueryEngineFieldValue(itemB, "name").value).toBe("User B Entity");
	});
});

describe("In-library filter", () => {
	it("isolates global media entities by library membership per user", async () => {
		const userA = await createAuthenticatedClient();
		const userB = await createAuthenticatedClient();
		const { entity, schema } = await createGlobalBookEntityFixture(userA.client, {
			name: `Isolated Library Entity ${crypto.randomUUID()}`,
			externalId: `isolated-library-entity-${crypto.randomUUID()}`,
		});

		await insertLibraryMembership(userA.client, {
			userId: userA.userId,
			mediaEntityId: entity.id,
		});

		const doc: QueryEnginePayload = {
			source: {
				alias: "entity",
				schemas: [schema.slug],
				type: "entities",
				where: {
					type: "exists",
					source: {
						where: null,
						type: "entities",
						alias: "library",
						schemas: ["library"],
						via: {
							alias: "inLibrary",
							entityRef: "entity",
							schema: "in-library",
							direction: "outgoing",
						},
					},
				},
			},
			output: {
				type: "rows",
				pagination: { page: 1, limit: 20 },
				fields: [{ key: "name", expr: systemRef("entity", "name") }],
				orderBy: [{ order: "asc", expr: systemRef("entity", "name") }],
			},
		};

		const userAResult = await executeQueryEngine(userA.client, doc);
		const userBResult = await executeQueryEngine(userB.client, doc);

		const userANames = userAResult.data.items.map(
			(item) => requireQueryEngineFieldValue(item, "name").value,
		);
		expect(userANames).toContain(entity.name);
		expect(userBResult.data.items).toHaveLength(0);
	});
});

describe("Validation errors", () => {
	it("rejects a pagination limit exceeding 100", async () => {
		const { client } = await createAuthenticatedClient();
		const { slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "LimitTestSchema",
		});

		const doc = buildRowsDoc({ alias: "e", schemas: [slug], limit: 101 });
		const error = await executeQueryEngineError(client, doc);
		expect(error).toMatchObject({ _tag: "BadRequest" });
	});

	it("rejects an invalid system field for an entity source", async () => {
		const { client } = await createAuthenticatedClient();
		const { slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "SystemFieldTestSchema",
		});

		const doc = buildRowsDoc({
			alias: "e",
			schemas: [slug],
			// occurredAt is an event-only system field
			orderByExpr: systemRef("e", "occurredAt"),
		});
		const error = await executeQueryEngineError(client, doc);
		expect(error).toMatchObject({ _tag: "BadRequest" });
	});

	it("rejects a property field that references a schema not in the source schemas", async () => {
		const { client } = await createAuthenticatedClient();
		const { slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "PropSchemaTestSchema",
			propertiesSchema: {
				fields: { title: { type: "string", label: "Title", description: "Title value" } },
			},
		});

		const doc = buildRowsDoc({
			alias: "e",
			schemas: [slug],
			fields: [{ key: "title", expr: propertyRef("e", "other-schema", "title") }],
		});
		const error = await executeQueryEngineError(client, doc);
		expect(error).toMatchObject({ _tag: "BadRequest" });
	});

	it("rejects duplicate source schema slugs", async () => {
		const { client } = await createAuthenticatedClient();
		const { slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "DuplicateSchemaGuardrail",
		});

		const doc = buildRowsDoc({ alias: "e", schemas: [slug, slug] });
		const error = await executeQueryEngineError(client, doc);
		expect(error).toMatchObject({ _tag: "BadRequest" });
	});

	it("rejects old predicate operand keys", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "OldPredicateGuardrail",
		});
		const invalidExpr = {
			type: "and" as const,
			predicates: [{ type: "literal", value: true }],
			values: [{ type: "literal" as const, value: true }] as const,
		};

		const doc = buildRowsDoc({ alias: "e", schemas: [slug], orderByExpr: invalidExpr });
		await expectMalformedQueryBadRequest(doc, cookies);
	});

	it("rejects unsupported legacy filter keys", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "LegacyFilterGuardrail",
		});

		const doc = {
			...buildRowsDoc({ alias: "e", schemas: [slug] }),
			source: {
				alias: "e",
				where: null,
				schemas: [slug],
				type: "entities",
				filter: { type: "literal", value: true },
			},
		} as QueryEnginePayload;
		await expectMalformedQueryBadRequest(doc, cookies);
	});

	it("rejects ordering a string property against a number literal", async () => {
		const { client } = await createAuthenticatedClient();
		const { slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "TypeCheckOrderingGuardrail",
			propertiesSchema: {
				fields: { title: { type: "string", label: "Title", description: "Title" } },
			},
		});

		const doc = buildRowsDoc({
			alias: "e",
			schemas: [slug],
			source: {
				alias: "e",
				schemas: [slug],
				type: "entities",
				where: {
					operator: "gt",
					type: "comparison",
					left: propertyRef("e", slug, "title"),
					right: { type: "literal", value: 5 },
				},
			},
		});
		const error = await executeQueryEngineError(client, doc);
		expect(error).toMatchObject({ _tag: "BadRequest" });
	});

	it("rejects arithmetic with a non-numeric operand", async () => {
		const { client } = await createAuthenticatedClient();
		const { slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "TypeCheckArithmeticGuardrail",
			propertiesSchema: {
				fields: { title: { type: "string", label: "Title", description: "Title" } },
			},
		});

		const doc = buildRowsDoc({
			alias: "e",
			schemas: [slug],
			fields: [
				{
					key: "computed",
					expr: {
						type: "arithmetic",
						operator: "add",
						left: propertyRef("e", slug, "title"),
						right: { type: "literal", value: 1 },
					},
				},
			],
		});
		const error = await executeQueryEngineError(client, doc);
		expect(error).toMatchObject({ _tag: "BadRequest" });
	});
});
