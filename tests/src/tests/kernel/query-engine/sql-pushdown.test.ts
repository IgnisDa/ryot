import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createCourseLessonFilterFixture,
	createQueryEngineEntity,
	createQueryEnginePluginSchema,
	createRelationship,
	createRelationshipSchema,
	executeAggregateQueryEngine,
	executeQueryEngine,
	propertyRef,
	requireQueryEngineFieldValue,
	systemRef,
	type QueryEnginePayload,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const lessonSchema = () => ({
	fields: {
		difficulty: { type: "string" as const, label: "Difficulty", description: "Difficulty" },
		durationMinutes: { type: "integer" as const, label: "Duration", description: "Duration" },
	},
});

describe("aggregate returns over a filtered source", () => {
	it.live("groups and counts only the rows matching a pushable numeric where", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEnginePluginSchema(client, {
				schemaName: "PushdownGroupedLesson",
				propertiesSchema: lessonSchema(),
			});
			yield* Effect.all(
				[
					{ difficulty: "advanced", durationMinutes: 30 },
					{ difficulty: "advanced", durationMinutes: 60 },
					{ difficulty: "beginner", durationMinutes: 90 },
					{ difficulty: "beginner", durationMinutes: 20 },
				].map((properties, index) =>
					createQueryEngineEntity(client, {
						name: `Lesson ${index}`,
						entitySchemaSlug: schemaId,
						properties,
					}),
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

			const result = yield* executeAggregateQueryEngine(client, doc);
			expect(result.data.pageInfo).toEqual({ limit: 10, hasMore: false });
			const byDifficulty = new Map(
				result.data.items.map((item) => [
					requireQueryEngineFieldValue(item, "difficulty").value,
					requireQueryEngineFieldValue(item, "count").value,
				]),
			);
			expect(byDifficulty.get("advanced")).toBe(2);
			expect(byDifficulty.get("beginner")).toBe(1);
		}),
	);

	it.live("computes ungrouped sum/count only over rows matching a pushable string where", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEnginePluginSchema(client, {
				propertiesSchema: lessonSchema(),
				schemaName: "PushdownUngroupedLesson",
			});
			yield* Effect.all(
				[
					{ difficulty: "advanced", durationMinutes: 30 },
					{ difficulty: "advanced", durationMinutes: 60 },
					{ difficulty: "beginner", durationMinutes: 90 },
				].map((properties, index) =>
					createQueryEngineEntity(client, {
						name: `Lesson ${index}`,
						entitySchemaSlug: schemaId,
						properties,
					}),
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
						{
							key: "total",
							aggregation: {
								function: "sum",
								expr: propertyRef("lesson", slug, "durationMinutes"),
							},
						},
					],
				},
			};

			const result = yield* executeAggregateQueryEngine(client, doc);
			expect(result.data.pageInfo).toBeUndefined();
			const item = result.data.items[0];
			assertPresent(item, "Expected ungrouped aggregate item");
			expect(requireQueryEngineFieldValue(item, "count").value).toBe(2);
			expect(requireQueryEngineFieldValue(item, "total").value).toBe(90);
		}),
	);
});

describe("relationship root filtering (pushdown)", () => {
	it.live("filters relationship rows by relationship property and endpoint entity fields", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId: memberSchemaId, slug: memberSlug } = yield* createQueryEnginePluginSchema(
				client,
				{ schemaName: "PushdownRelMember" },
			);
			const { schemaId: collectionSchemaId, slug: collectionSlug } =
				yield* createQueryEnginePluginSchema(client, { schemaName: "PushdownRelCollection" });
			const relationshipSlug = `pushdown-membership-${crypto.randomUUID()}`;
			const relationshipSchema = yield* createRelationshipSchema(client, {
				name: "Pushdown Membership",
				slug: relationshipSlug,
				sourceEntitySchemaSlug: memberSchemaId,
				targetEntitySchemaSlug: collectionSchemaId,
				propertiesSchema: {
					fields: { role: { type: "string", label: "Role", description: "Membership role" } },
				},
			});
			const memberOne = yield* createQueryEngineEntity(client, {
				name: "Member One",
				entitySchemaSlug: memberSchemaId,
			});
			const memberTwo = yield* createQueryEngineEntity(client, {
				name: "Member Two",
				entitySchemaSlug: memberSchemaId,
			});
			const collection = yield* createQueryEngineEntity(client, {
				name: "Collection",
				entitySchemaSlug: collectionSchemaId,
			});
			yield* createRelationship(client, {
				sourceEntityId: memberOne.id,
				targetEntityId: collection.id,
				properties: { role: "first" },
				relationshipSchemaSlug: relationshipSchema.id,
			});
			yield* createRelationship(client, {
				sourceEntityId: memberTwo.id,
				targetEntityId: collection.id,
				properties: { role: "second" },
				relationshipSchemaSlug: relationshipSchema.id,
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

			const byRole = yield* executeQueryEngine(
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
			expect(requireQueryEngineFieldValue(byRole.data.items[0], "memberName").value).toBe(
				"Member One",
			);

			const byMemberName = yield* executeQueryEngine(
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
			expect(requireQueryEngineFieldValue(byMemberName.data.items[0], "memberName").value).toBe(
				"Member Two",
			);
		}),
	);
});

describe("aggregate over a correlated-exists filtered source", () => {
	it.live("counts entities whose descendants satisfy nested exists", () =>
		Effect.gen(function* () {
			const {
				client,
				courseSlug,
				moduleSlug,
				lessonSlug,
				completeSlug,
				moduleLessonSlug,
				courseModuleSlug,
			} = yield* createCourseLessonFilterFixture();
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
							via: {
								entityRef: "course",
								direction: "outgoing",
								schema: courseModuleSlug,
								alias: "courseModule",
							},
							where: {
								type: "exists",
								source: {
									alias: "lesson",
									type: "entities",
									schemas: [lessonSlug],
									via: {
										entityRef: "module",
										direction: "outgoing",
										schema: moduleLessonSlug,
										alias: "moduleLesson",
									},
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

			const result = yield* executeAggregateQueryEngine(client, doc);
			const item = result.data.items[0];
			assertPresent(item, "Expected aggregate item");
			// Advanced Course and Short Course have completed lessons; Long Incomplete Course does not.
			expect(requireQueryEngineFieldValue(item, "count").value).toBe(2);
		}),
	);
});
