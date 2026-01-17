import { Effect } from "effect";

import {
	buildRowsDoc,
	createAuthenticatedClient,
	createEventSchema,
	createRelationship,
	createRelationshipSchema,
	createQueryEngineEntity,
	createQueryEngineEvent,
	createQueryEngineTrackerAndSchema,
	executeQueryEngine,
	propertyRef,
	requireQueryEngineFieldValue,
	requireQueryEngineIncludeValue,
	systemRef,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Relationship includes", () => {
	it.live(
		"filters included child rows by a child property while keeping parents with zero matches",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { schemaId: courseSchemaId, slug: courseSlug } =
					yield* createQueryEngineTrackerAndSchema(client, { schemaName: "WhereIncludeCourse" });
				const { schemaId: moduleSchemaId, slug: moduleSlug } =
					yield* createQueryEngineTrackerAndSchema(client, {
						schemaName: "WhereIncludeModule",
						propertiesSchema: {
							fields: {
								moduleNumber: {
									type: "integer",
									label: "Module Number",
									description: "Sort order",
								},
							},
						},
					});
				const relationshipSlug = `where-course-module-${crypto.randomUUID()}`;
				const relationshipSchema = yield* createRelationshipSchema(client, {
					name: "Where Course Module",
					slug: relationshipSlug,
					sourceEntitySchemaSlug: courseSchemaId,
					targetEntitySchemaSlug: moduleSchemaId,
				});

				const courseWithMatch = yield* createQueryEngineEntity(client, {
					name: "Course With Match",
					entitySchemaSlug: courseSchemaId,
				});
				const courseWithoutMatch = yield* createQueryEngineEntity(client, {
					name: "Course Without Match",
					entitySchemaSlug: courseSchemaId,
				});
				const moduleLow = yield* createQueryEngineEntity(client, {
					name: "Module Low",
					entitySchemaSlug: moduleSchemaId,
					properties: { moduleNumber: 1 },
				});
				const moduleHigh = yield* createQueryEngineEntity(client, {
					name: "Module High",
					entitySchemaSlug: moduleSchemaId,
					properties: { moduleNumber: 5 },
				});
				const onlyLowModule = yield* createQueryEngineEntity(client, {
					name: "Only Low Module",
					entitySchemaSlug: moduleSchemaId,
					properties: { moduleNumber: 1 },
				});

				yield* createRelationship(client, {
					sourceEntityId: courseWithMatch.id,
					targetEntityId: moduleLow.id,
					relationshipSchemaSlug: relationshipSchema.id,
				});
				yield* createRelationship(client, {
					sourceEntityId: courseWithMatch.id,
					targetEntityId: moduleHigh.id,
					relationshipSchemaSlug: relationshipSchema.id,
				});
				yield* createRelationship(client, {
					sourceEntityId: courseWithoutMatch.id,
					targetEntityId: onlyLowModule.id,
					relationshipSchemaSlug: relationshipSchema.id,
				});

				const doc = buildRowsDoc({
					limit: 10,
					alias: "course",
					schemas: [courseSlug],
					output: {
						type: "rows",
						pagination: { page: 1, limit: 10 },
						fields: [{ key: "name", expr: systemRef("course", "name") }],
						orderBy: [{ order: "asc", expr: systemRef("course", "name") }],
						include: [
							{
								limit: 10,
								key: "modules",
								orderBy: [
									{ order: "asc", expr: propertyRef("module", moduleSlug, "moduleNumber") },
								],
								fields: [
									{ key: "name", expr: systemRef("module", "name") },
									{ key: "moduleNumber", expr: propertyRef("module", moduleSlug, "moduleNumber") },
								],
								source: {
									alias: "module",
									type: "entities",
									schemas: [moduleSlug],
									where: {
										type: "comparison",
										operator: "gt",
										right: { type: "literal", value: 1 },
										left: propertyRef("module", moduleSlug, "moduleNumber"),
									},
									via: {
										entityRef: "course",
										alias: "courseModule",
										direction: "outgoing",
										schema: relationshipSlug,
									},
								},
							},
						],
					},
				});

				const result = yield* executeQueryEngine(client, doc);

				const matchItem = result.data.items.find(
					(item) => requireQueryEngineFieldValue(item, "name").value === "Course With Match",
				);
				const noMatchItem = result.data.items.find(
					(item) => requireQueryEngineFieldValue(item, "name").value === "Course Without Match",
				);
				assertPresent(matchItem, "Expected Course With Match row");
				assertPresent(noMatchItem, "Expected Course Without Match row");

				const matchedModules = requireQueryEngineIncludeValue(matchItem, "modules");
				expect(matchedModules.items).toHaveLength(1);
				const matchedModule = matchedModules.items[0];
				assertPresent(matchedModule, "Expected matched module row");
				expect(requireQueryEngineFieldValue(matchedModule, "name").value).toBe("Module High");
				expect(requireQueryEngineFieldValue(matchedModule, "moduleNumber").value).toBe(5);

				const emptyModules = requireQueryEngineIncludeValue(noMatchItem, "modules");
				expect(emptyModules.items).toHaveLength(0);
				expect(emptyModules.pageInfo).toEqual({ limit: 10, hasMore: false });
			}),
	);

	it.live("includes event sources under an entity as a nested list of event rows", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId: lessonSchemaId, slug: lessonSlug } =
				yield* createQueryEngineTrackerAndSchema(client, { schemaName: "EventIncludeLesson" });
			const completeSlug = `event-include-complete-${crypto.randomUUID()}`;
			const completeSchema = yield* createEventSchema(client, {
				slug: completeSlug,
				name: "Event Include Complete",
				entitySchemaSlug: lessonSchemaId,
				propertiesSchema: {
					fields: { score: { type: "integer", label: "Score", description: "Completion score" } },
				},
			});

			const lesson = yield* createQueryEngineEntity(client, {
				name: "Lesson With Completions",
				entitySchemaSlug: lessonSchemaId,
			});
			yield* createQueryEngineEvent(client, {
				entityId: lesson.id,
				properties: { score: 1 },
				eventSchemaSlug: completeSchema.id,
				occurredAt: "2026-01-01T00:00:00.000Z",
			});
			yield* createQueryEngineEvent(client, {
				entityId: lesson.id,
				properties: { score: 2 },
				eventSchemaSlug: completeSchema.id,
				occurredAt: "2026-02-01T00:00:00.000Z",
			});

			const doc = buildRowsDoc({
				limit: 10,
				alias: "lesson",
				schemas: [lessonSlug],
				output: {
					type: "rows",
					pagination: { page: 1, limit: 10 },
					fields: [{ key: "name", expr: systemRef("lesson", "name") }],
					orderBy: [{ order: "asc", expr: systemRef("lesson", "name") }],
					include: [
						{
							limit: 10,
							key: "completions",
							orderBy: [{ order: "desc", expr: systemRef("completion", "occurredAt") }],
							fields: [
								{ key: "occurredAt", expr: systemRef("completion", "occurredAt") },
								{ key: "score", expr: propertyRef("completion", completeSlug, "score") },
								{ key: "lessonName", expr: systemRef("lesson", "name") },
							],
							source: {
								where: null,
								type: "events",
								entityRef: "lesson",
								alias: "completion",
								schemas: [completeSlug],
							},
						},
					],
				},
			});

			const result = yield* executeQueryEngine(client, doc);

			const lessonItem = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "Lesson With Completions",
			);
			assertPresent(lessonItem, "Expected lesson row");
			const completions = requireQueryEngineIncludeValue(lessonItem, "completions");
			expect(completions.items).toHaveLength(2);
			expect(completions.pageInfo).toEqual({ limit: 10, hasMore: false });
			const firstCompletion = completions.items[0];
			const secondCompletion = completions.items[1];
			assertPresent(firstCompletion, "Expected first completion row");
			assertPresent(secondCompletion, "Expected second completion row");
			expect(requireQueryEngineFieldValue(firstCompletion, "score").value).toBe(2);
			expect(requireQueryEngineFieldValue(secondCompletion, "score").value).toBe(1);
			expect(requireQueryEngineFieldValue(firstCompletion, "lessonName").value).toBe(
				"Lesson With Completions",
			);
		}),
	);

	it.live("filters an event include by an event property, keeping parents with zero matches", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId: lessonSchemaId, slug: lessonSlug } =
				yield* createQueryEngineTrackerAndSchema(client, {
					schemaName: "EventIncludeFilterLesson",
				});
			const completeSlug = `event-include-filter-${crypto.randomUUID()}`;
			const completeSchema = yield* createEventSchema(client, {
				slug: completeSlug,
				name: "Event Include Filter Complete",
				entitySchemaSlug: lessonSchemaId,
				propertiesSchema: {
					fields: { score: { type: "integer", label: "Score", description: "Completion score" } },
				},
			});

			const lesson = yield* createQueryEngineEntity(client, {
				name: "Filter Lesson",
				entitySchemaSlug: lessonSchemaId,
			});
			yield* createQueryEngineEvent(client, {
				entityId: lesson.id,
				properties: { score: 1 },
				eventSchemaSlug: completeSchema.id,
				occurredAt: "2026-01-01T00:00:00.000Z",
			});
			yield* createQueryEngineEvent(client, {
				entityId: lesson.id,
				properties: { score: 2 },
				eventSchemaSlug: completeSchema.id,
				occurredAt: "2026-02-01T00:00:00.000Z",
			});

			const doc = buildRowsDoc({
				limit: 10,
				alias: "lesson",
				schemas: [lessonSlug],
				output: {
					type: "rows",
					pagination: { page: 1, limit: 10 },
					fields: [{ key: "name", expr: systemRef("lesson", "name") }],
					orderBy: [{ order: "asc", expr: systemRef("lesson", "name") }],
					include: [
						{
							limit: 10,
							key: "highScores",
							orderBy: [{ order: "desc", expr: systemRef("completion", "occurredAt") }],
							fields: [{ key: "score", expr: propertyRef("completion", completeSlug, "score") }],
							source: {
								type: "events",
								entityRef: "lesson",
								alias: "completion",
								schemas: [completeSlug],
								where: {
									type: "comparison",
									operator: "gt",
									right: { type: "literal", value: 1 },
									left: propertyRef("completion", completeSlug, "score"),
								},
							},
						},
					],
				},
			});

			const result = yield* executeQueryEngine(client, doc);

			const lessonItem = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "Filter Lesson",
			);
			assertPresent(lessonItem, "Expected lesson row");
			const highScores = requireQueryEngineIncludeValue(lessonItem, "highScores");
			expect(highScores.items).toHaveLength(1);
			const only = highScores.items[0];
			assertPresent(only, "Expected the single high-score completion");
			expect(requireQueryEngineFieldValue(only, "score").value).toBe(2);
		}),
	);

	it.live("reports hasMore on an event include with a low limit", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId: lessonSchemaId, slug: lessonSlug } =
				yield* createQueryEngineTrackerAndSchema(client, { schemaName: "EventIncludeHasMore" });
			const completeSlug = `event-include-hasmore-${crypto.randomUUID()}`;
			const completeSchema = yield* createEventSchema(client, {
				slug: completeSlug,
				name: "Event Include HasMore",
				entitySchemaSlug: lessonSchemaId,
				propertiesSchema: {
					fields: { score: { type: "integer", label: "Score", description: "Completion score" } },
				},
			});

			const lesson = yield* createQueryEngineEntity(client, {
				name: "Lesson HasMore",
				entitySchemaSlug: lessonSchemaId,
			});
			yield* createQueryEngineEvent(client, {
				entityId: lesson.id,
				properties: { score: 1 },
				eventSchemaSlug: completeSchema.id,
				occurredAt: "2026-01-01T00:00:00.000Z",
			});
			yield* createQueryEngineEvent(client, {
				entityId: lesson.id,
				properties: { score: 2 },
				eventSchemaSlug: completeSchema.id,
				occurredAt: "2026-02-01T00:00:00.000Z",
			});

			const doc = buildRowsDoc({
				limit: 10,
				alias: "lesson",
				schemas: [lessonSlug],
				output: {
					type: "rows",
					pagination: { page: 1, limit: 10 },
					fields: [{ key: "name", expr: systemRef("lesson", "name") }],
					orderBy: [{ order: "asc", expr: systemRef("lesson", "name") }],
					include: [
						{
							limit: 1,
							key: "completions",
							orderBy: [{ order: "desc", expr: systemRef("completion", "occurredAt") }],
							fields: [{ key: "score", expr: propertyRef("completion", completeSlug, "score") }],
							source: {
								where: null,
								type: "events",
								entityRef: "lesson",
								alias: "completion",
								schemas: [completeSlug],
							},
						},
					],
				},
			});

			const result = yield* executeQueryEngine(client, doc);

			const lessonItem = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "Lesson HasMore",
			);
			assertPresent(lessonItem, "Expected lesson row");
			const completions = requireQueryEngineIncludeValue(lessonItem, "completions");
			expect(completions.items).toHaveLength(1);
			expect(completions.pageInfo).toEqual({ limit: 1, hasMore: true });
			const onlyCompletion = completions.items[0];
			assertPresent(onlyCompletion, "Expected the single completion row");
			expect(requireQueryEngineFieldValue(onlyCompletion, "score").value).toBe(2);
		}),
	);
});
