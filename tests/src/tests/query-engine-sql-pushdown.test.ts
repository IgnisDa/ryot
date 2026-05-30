import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createCourseLessonFilterFixture,
	createQueryEngineEntity,
	createQueryEngineTrackerAndSchema,
	createRelationship,
	createRelationshipSchema,
	executeAggregateQueryEngine,
	executeQueryEngine,
	propertyRef,
	requireQueryEngineFieldValue,
	systemRef,
	type QueryEnginePayload,
} from "../fixtures";
import { assertPresent } from "../test-support/assertions";

// Parity: aggregate/time-series over a filtered source, relationship-root filtering, and
// correlated exists/aggregate must return the same results whether they run in SQL or app-side.

const lessonSchema = () => ({
	fields: {
		difficulty: { type: "string" as const, label: "Difficulty", description: "Difficulty" },
		durationMinutes: { type: "integer" as const, label: "Duration", description: "Duration" },
	},
});

describe("aggregate returns over a filtered source", () => {
	it("groups and counts only the rows matching a pushable numeric where", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "PushdownGroupedLesson",
			propertiesSchema: lessonSchema(),
		});
		await Promise.all(
			[
				{ difficulty: "advanced", durationMinutes: 30 },
				{ difficulty: "advanced", durationMinutes: 60 },
				{ difficulty: "beginner", durationMinutes: 90 },
				{ difficulty: "beginner", durationMinutes: 20 },
			].map((properties, index) =>
				createQueryEngineEntity(client, { name: `Lesson ${index}`, entitySchemaId: schemaId, properties }),
			),
		);

		const doc: QueryEnginePayload = {
			source: {
				alias: "lesson",
				schemas: [slug],
				type: "entities",
				where: {
					operator: "gt",
					type: "comparison",
					right: { type: "literal", value: 25 },
					left: propertyRef("lesson", slug, "durationMinutes"),
				},
			},
			output: {
				limit: 10,
				type: "aggregate",
				measures: [{ key: "count", aggregation: { function: "count" } }],
				orderBy: [{ order: "desc", expr: { type: "measureRef", key: "count" } }],
				groupBy: [{ key: "difficulty", expr: propertyRef("lesson", slug, "difficulty") }],
			},
		};

		const result = await executeAggregateQueryEngine(client, doc);
		expect(result.data.pageInfo).toEqual({ limit: 10, hasMore: false });
		const byDifficulty = new Map(
			result.data.items.map((item) => [
				requireQueryEngineFieldValue(item, "difficulty").value,
				requireQueryEngineFieldValue(item, "count").value,
			]),
		);
		expect(byDifficulty.get("advanced")).toBe(2);
		expect(byDifficulty.get("beginner")).toBe(1);
	});

	it("computes ungrouped sum/count only over rows matching a pushable string where", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			propertiesSchema: lessonSchema(),
			schemaName: "PushdownUngroupedLesson",
		});
		await Promise.all(
			[
				{ difficulty: "advanced", durationMinutes: 30 },
				{ difficulty: "advanced", durationMinutes: 60 },
				{ difficulty: "beginner", durationMinutes: 90 },
			].map((properties, index) =>
				createQueryEngineEntity(client, { name: `Lesson ${index}`, entitySchemaId: schemaId, properties }),
			),
		);

		const doc: QueryEnginePayload = {
			source: {
				alias: "lesson",
				schemas: [slug],
				type: "entities",
				where: {
					operator: "eq",
					type: "comparison",
					right: { type: "literal", value: "advanced" },
					left: propertyRef("lesson", slug, "difficulty"),
				},
			},
			output: {
				type: "aggregate",
				measures: [
					{ key: "count", aggregation: { function: "count" } },
					{ key: "total", aggregation: { function: "sum", expr: propertyRef("lesson", slug, "durationMinutes") } },
				],
			},
		};

		const result = await executeAggregateQueryEngine(client, doc);
		expect(result.data.pageInfo).toBeUndefined();
		const item = result.data.items[0];
		assertPresent(item, "Expected ungrouped aggregate item");
		expect(requireQueryEngineFieldValue(item, "count").value).toBe(2);
		expect(requireQueryEngineFieldValue(item, "total").value).toBe(90);
	});
});

describe("relationship root filtering (pushdown)", () => {
	it("filters relationship rows by relationship property and endpoint entity fields", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId: memberSchemaId, slug: memberSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{ schemaName: "PushdownRelMember" },
		);
		const { schemaId: collectionSchemaId, slug: collectionSlug } =
			await createQueryEngineTrackerAndSchema(client, { schemaName: "PushdownRelCollection" });
		const relationshipSlug = `pushdown-membership-${crypto.randomUUID()}`;
		const relationshipSchema = await createRelationshipSchema(client, {
			name: "Pushdown Membership",
			slug: relationshipSlug,
			sourceEntitySchemaId: memberSchemaId,
			targetEntitySchemaId: collectionSchemaId,
			propertiesSchema: {
				fields: { role: { type: "string", label: "Role", description: "Membership role" } },
			},
		});
		const memberOne = await createQueryEngineEntity(client, {
			name: "Member One",
			entitySchemaId: memberSchemaId,
		});
		const memberTwo = await createQueryEngineEntity(client, {
			name: "Member Two",
			entitySchemaId: memberSchemaId,
		});
		const collection = await createQueryEngineEntity(client, {
			name: "Collection",
			entitySchemaId: collectionSchemaId,
		});
		await createRelationship(client, {
			sourceEntityId: memberOne.id,
			targetEntityId: collection.id,
			properties: { role: "first" },
			relationshipSchemaId: relationshipSchema.id,
		});
		await createRelationship(client, {
			sourceEntityId: memberTwo.id,
			targetEntityId: collection.id,
			properties: { role: "second" },
			relationshipSchemaId: relationshipSchema.id,
		});

		const build = (where: QueryEnginePayload["source"]["where"]): QueryEnginePayload => ({
			source: {
				where,
				alias: "membership",
				type: "relationships",
				schemas: [relationshipSlug],
				sourceEntity: { alias: "memberEntity", schemas: [memberSlug] },
				targetEntity: { alias: "collectionEntity", schemas: [collectionSlug] },
			},
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: systemRef("memberEntity", "name") }],
				fields: [{ key: "memberName", expr: systemRef("memberEntity", "name") }],
			},
		});

		const byRole = await executeQueryEngine(
			client,
			build({
				operator: "eq",
				type: "comparison",
				right: { type: "literal", value: "first" },
				left: propertyRef("membership", relationshipSlug, "role"),
			}),
		);
		expect(byRole.data.items).toHaveLength(1);
		expect(byRole.data.pageInfo.total).toBe(1);
		assertPresent(byRole.data.items[0], "Expected one membership row");
		expect(requireQueryEngineFieldValue(byRole.data.items[0], "memberName").value).toBe("Member One");

		const byMemberName = await executeQueryEngine(
			client,
			build({
				operator: "eq",
				type: "comparison",
				right: { type: "literal", value: "Member Two" },
				left: systemRef("memberEntity", "name"),
			}),
		);
		expect(byMemberName.data.items).toHaveLength(1);
		assertPresent(byMemberName.data.items[0], "Expected one membership row");
		expect(requireQueryEngineFieldValue(byMemberName.data.items[0], "memberName").value).toBe("Member Two");
	});
});

describe("aggregate over a correlated-exists filtered source", () => {
	it("counts entities whose descendants satisfy nested exists", async () => {
		const { client, courseSlug, moduleSlug, lessonSlug, completeSlug, moduleLessonSlug, courseModuleSlug } =
			await createCourseLessonFilterFixture();
		const doc: QueryEnginePayload = {
			source: {
				alias: "course",
				type: "entities",
				schemas: [courseSlug],
				where: {
					type: "exists",
					source: {
						alias: "module",
						type: "entities",
						schemas: [moduleSlug],
						via: { entityRef: "course", direction: "outgoing", schema: courseModuleSlug, alias: "courseModule" },
						where: {
							type: "exists",
							source: {
								alias: "lesson",
								type: "entities",
								schemas: [lessonSlug],
								via: { entityRef: "module", direction: "outgoing", schema: moduleLessonSlug, alias: "moduleLesson" },
								where: {
									type: "exists",
									source: {
										where: null,
										type: "events",
										entityRef: "lesson",
										alias: "completion",
										schemas: [completeSlug],
									},
								},
							},
						},
					},
				},
			},
			output: {
				type: "aggregate",
				measures: [{ key: "count", aggregation: { function: "count" } }],
			},
		};

		const result = await executeAggregateQueryEngine(client, doc);
		const item = result.data.items[0];
		assertPresent(item, "Expected aggregate item");
		// Advanced Course and Short Course have completed lessons; Long Incomplete Course does not.
		expect(requireQueryEngineFieldValue(item, "count").value).toBe(2);
	});
});
