import { describe, expect, it } from "bun:test";

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
} from "../fixtures";
import { assertPresent } from "../test-support/assertions";

describe("Relationship includes", () => {
	it("filters included child rows by a child property while keeping parents with zero matches", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId: courseSchemaId, slug: courseSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{ schemaName: "WhereIncludeCourse" },
		);
		const { schemaId: moduleSchemaId, slug: moduleSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{
				schemaName: "WhereIncludeModule",
				propertiesSchema: {
					fields: {
						moduleNumber: { type: "integer", label: "Module Number", description: "Sort order" },
					},
				},
			},
		);
		const relationshipSlug = `where-course-module-${crypto.randomUUID()}`;
		const relationshipSchema = await createRelationshipSchema(client, {
			name: "Where Course Module",
			slug: relationshipSlug,
			sourceEntitySchemaId: courseSchemaId,
			targetEntitySchemaId: moduleSchemaId,
		});

		const courseWithMatch = await createQueryEngineEntity(client, {
			name: "Course With Match",
			entitySchemaId: courseSchemaId,
		});
		const courseWithoutMatch = await createQueryEngineEntity(client, {
			name: "Course Without Match",
			entitySchemaId: courseSchemaId,
		});
		const moduleLow = await createQueryEngineEntity(client, {
			name: "Module Low",
			entitySchemaId: moduleSchemaId,
			properties: { moduleNumber: 1 },
		});
		const moduleHigh = await createQueryEngineEntity(client, {
			name: "Module High",
			entitySchemaId: moduleSchemaId,
			properties: { moduleNumber: 5 },
		});
		const onlyLowModule = await createQueryEngineEntity(client, {
			name: "Only Low Module",
			entitySchemaId: moduleSchemaId,
			properties: { moduleNumber: 1 },
		});

		await createRelationship(client, {
			sourceEntityId: courseWithMatch.id,
			targetEntityId: moduleLow.id,
			relationshipSchemaId: relationshipSchema.id,
		});
		await createRelationship(client, {
			sourceEntityId: courseWithMatch.id,
			targetEntityId: moduleHigh.id,
			relationshipSchemaId: relationshipSchema.id,
		});
		await createRelationship(client, {
			sourceEntityId: courseWithoutMatch.id,
			targetEntityId: onlyLowModule.id,
			relationshipSchemaId: relationshipSchema.id,
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
						orderBy: [{ order: "asc", expr: propertyRef("module", moduleSlug, "moduleNumber") }],
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

		const result = await executeQueryEngine(client, doc);

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
	});

	it("includes event sources under an entity as a nested list of event rows", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId: lessonSchemaId, slug: lessonSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{ schemaName: "EventIncludeLesson" },
		);
		const completeSlug = `event-include-complete-${crypto.randomUUID()}`;
		const completeSchema = await createEventSchema(client, {
			slug: completeSlug,
			name: "Event Include Complete",
			entitySchemaId: lessonSchemaId,
			propertiesSchema: {
				fields: { score: { type: "integer", label: "Score", description: "Completion score" } },
			},
		});

		const lesson = await createQueryEngineEntity(client, {
			name: "Lesson With Completions",
			entitySchemaId: lessonSchemaId,
		});
		await createQueryEngineEvent(client, {
			entityId: lesson.id,
			properties: { score: 1 },
			eventSchemaId: completeSchema.id,
			occurredAt: "2026-01-01T00:00:00.000Z",
		});
		await createQueryEngineEvent(client, {
			entityId: lesson.id,
			properties: { score: 2 },
			eventSchemaId: completeSchema.id,
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

		const result = await executeQueryEngine(client, doc);

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
	});

	it("filters an event include by an event property, keeping parents with zero matches", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId: lessonSchemaId, slug: lessonSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{ schemaName: "EventIncludeFilterLesson" },
		);
		const completeSlug = `event-include-filter-${crypto.randomUUID()}`;
		const completeSchema = await createEventSchema(client, {
			slug: completeSlug,
			name: "Event Include Filter Complete",
			entitySchemaId: lessonSchemaId,
			propertiesSchema: {
				fields: { score: { type: "integer", label: "Score", description: "Completion score" } },
			},
		});

		const lesson = await createQueryEngineEntity(client, {
			name: "Filter Lesson",
			entitySchemaId: lessonSchemaId,
		});
		await createQueryEngineEvent(client, {
			entityId: lesson.id,
			properties: { score: 1 },
			eventSchemaId: completeSchema.id,
			occurredAt: "2026-01-01T00:00:00.000Z",
		});
		await createQueryEngineEvent(client, {
			entityId: lesson.id,
			properties: { score: 2 },
			eventSchemaId: completeSchema.id,
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

		const result = await executeQueryEngine(client, doc);

		const lessonItem = result.data.items.find(
			(item) => requireQueryEngineFieldValue(item, "name").value === "Filter Lesson",
		);
		assertPresent(lessonItem, "Expected lesson row");
		const highScores = requireQueryEngineIncludeValue(lessonItem, "highScores");
		expect(highScores.items).toHaveLength(1);
		const only = highScores.items[0];
		assertPresent(only, "Expected the single high-score completion");
		expect(requireQueryEngineFieldValue(only, "score").value).toBe(2);
	});

	it("reports hasMore on an event include with a low limit", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId: lessonSchemaId, slug: lessonSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{ schemaName: "EventIncludeHasMore" },
		);
		const completeSlug = `event-include-hasmore-${crypto.randomUUID()}`;
		const completeSchema = await createEventSchema(client, {
			slug: completeSlug,
			name: "Event Include HasMore",
			entitySchemaId: lessonSchemaId,
			propertiesSchema: {
				fields: { score: { type: "integer", label: "Score", description: "Completion score" } },
			},
		});

		const lesson = await createQueryEngineEntity(client, {
			name: "Lesson HasMore",
			entitySchemaId: lessonSchemaId,
		});
		await createQueryEngineEvent(client, {
			entityId: lesson.id,
			properties: { score: 1 },
			eventSchemaId: completeSchema.id,
			occurredAt: "2026-01-01T00:00:00.000Z",
		});
		await createQueryEngineEvent(client, {
			entityId: lesson.id,
			properties: { score: 2 },
			eventSchemaId: completeSchema.id,
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

		const result = await executeQueryEngine(client, doc);

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
	});
});
