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
	it("returns one-hop entity includes with limit metadata", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId: courseSchemaId, slug: courseSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{ schemaName: "IncludeCourse" },
		);
		const { schemaId: moduleSchemaId, slug: moduleSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{
				schemaName: "IncludeModule",
				propertiesSchema: {
					fields: {
						moduleNumber: { type: "integer", label: "Module Number", description: "Sort order" },
					},
				},
			},
		);
		const relationshipSlug = `course-module-${crypto.randomUUID()}`;
		const relationshipSchema = await createRelationshipSchema(client, {
			name: "Course Module",
			slug: relationshipSlug,
			sourceEntitySchemaId: courseSchemaId,
			targetEntitySchemaId: moduleSchemaId,
			propertiesSchema: {
				fields: {
					position: { type: "integer", label: "Position", description: "Edge sort order" },
				},
			},
		});

		const courseA = await createQueryEngineEntity(client, {
			name: "Course A",
			entitySchemaId: courseSchemaId,
		});
		const courseB = await createQueryEngineEntity(client, {
			name: "Course B",
			entitySchemaId: courseSchemaId,
		});
		const moduleOne = await createQueryEngineEntity(client, {
			name: "Module One",
			entitySchemaId: moduleSchemaId,
			properties: { moduleNumber: 1 },
		});
		const moduleTwo = await createQueryEngineEntity(client, {
			name: "Module Two",
			entitySchemaId: moduleSchemaId,
			properties: { moduleNumber: 2 },
		});
		const moduleThree = await createQueryEngineEntity(client, {
			name: "Module Three",
			entitySchemaId: moduleSchemaId,
			properties: { moduleNumber: 3 },
		});

		await createRelationship(client, {
			sourceEntityId: courseA.id,
			properties: { position: 2 },
			targetEntityId: moduleTwo.id,
			relationshipSchemaId: relationshipSchema.id,
		});
		await createRelationship(client, {
			sourceEntityId: courseA.id,
			properties: { position: 1 },
			targetEntityId: moduleOne.id,
			relationshipSchemaId: relationshipSchema.id,
		});
		await createRelationship(client, {
			sourceEntityId: courseB.id,
			properties: { position: 3 },
			targetEntityId: moduleThree.id,
			relationshipSchemaId: relationshipSchema.id,
		});

		const doc = buildRowsDoc({
			limit: 2,
			alias: "course",
			schemas: [courseSlug],
			fields: [{ key: "name", expr: systemRef("course", "name") }],
			output: {
				fields: [{ key: "name", expr: systemRef("course", "name") }],
				type: "rows",
				pagination: { page: 1, limit: 2 },
				orderBy: [{ order: "asc", expr: systemRef("course", "name") }],
				include: [
					{
						limit: 1,
						key: "modules",
						orderBy: [{ order: "asc", expr: propertyRef("module", moduleSlug, "moduleNumber") }],
						fields: [
							{ key: "name", expr: systemRef("module", "name") },
							{ key: "moduleNumber", expr: propertyRef("module", moduleSlug, "moduleNumber") },
							{
								key: "position",
								expr: propertyRef("courseModule", relationshipSlug, "position"),
							},
						],
						source: {
							where: null,
							alias: "module",
							type: "entities",
							schemas: [moduleSlug],
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

		expect(result.data.items).toHaveLength(2);
		expect(result.data.pageInfo.total).toBe(2);
		const courseAItem = result.data.items.find(
			(item) => requireQueryEngineFieldValue(item, "name").value === "Course A",
		);
		assertPresent(courseAItem, "Expected Course A row");
		const modules = requireQueryEngineIncludeValue(courseAItem, "modules");
		expect(modules.items).toHaveLength(1);
		expect(modules.pageInfo).toEqual({ limit: 1, hasMore: true });
		const firstModule = modules.items[0];
		assertPresent(firstModule, "Expected first module row");
		expect(requireQueryEngineFieldValue(firstModule, "name").value).toBe("Module One");
		expect(requireQueryEngineFieldValue(firstModule, "moduleNumber").value).toBe(1);
		expect(requireQueryEngineFieldValue(firstModule, "position").value).toBe(1);
	});

	it("orders nested includes numerically by an integer property, not lexicographically", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId: courseSchemaId, slug: courseSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{ schemaName: "NumOrderCourse" },
		);
		const { schemaId: moduleSchemaId, slug: moduleSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{
				schemaName: "NumOrderModule",
				propertiesSchema: {
					fields: {
						moduleNumber: { type: "integer", label: "Module Number", description: "Sort order" },
					},
				},
			},
		);
		const relationshipSlug = `num-course-module-${crypto.randomUUID()}`;
		const relationshipSchema = await createRelationshipSchema(client, {
			name: "Num Course Module",
			slug: relationshipSlug,
			propertiesSchema: { fields: {} },
			sourceEntitySchemaId: courseSchemaId,
			targetEntitySchemaId: moduleSchemaId,
		});

		const course = await createQueryEngineEntity(client, {
			name: "Numbered Course",
			entitySchemaId: courseSchemaId,
		});
		// 10 created before 2 so insertion order can't mask the sort: numeric order must give 2, 10.
		const moduleTen = await createQueryEngineEntity(client, {
			name: "Module Ten",
			entitySchemaId: moduleSchemaId,
			properties: { moduleNumber: 10 },
		});
		const moduleTwo = await createQueryEngineEntity(client, {
			name: "Module Two",
			entitySchemaId: moduleSchemaId,
			properties: { moduleNumber: 2 },
		});
		await createRelationship(client, {
			properties: {},
			sourceEntityId: course.id,
			targetEntityId: moduleTen.id,
			relationshipSchemaId: relationshipSchema.id,
		});
		await createRelationship(client, {
			properties: {},
			sourceEntityId: course.id,
			targetEntityId: moduleTwo.id,
			relationshipSchemaId: relationshipSchema.id,
		});

		const doc = buildRowsDoc({
			alias: "course",
			schemas: [courseSlug],
			fields: [{ key: "name", expr: systemRef("course", "name") }],
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
							{ key: "moduleNumber", expr: propertyRef("module", moduleSlug, "moduleNumber") },
						],
						source: {
							where: null,
							alias: "module",
							type: "entities",
							schemas: [moduleSlug],
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
		const courseItem = result.data.items[0];
		assertPresent(courseItem, "Expected course row");
		const modules = requireQueryEngineIncludeValue(courseItem, "modules");
		expect(
			modules.items.map((item) => requireQueryEngineFieldValue(item, "moduleNumber").value),
		).toEqual([2, 10]);
	});

	it("returns deep entity includes with event existence fields", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId: courseSchemaId, slug: courseSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{ schemaName: "DeepCourse" },
		);
		const { schemaId: moduleSchemaId, slug: moduleSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{
				schemaName: "DeepModule",
				propertiesSchema: {
					fields: {
						moduleNumber: { type: "integer", label: "Module Number", description: "Sort order" },
					},
				},
			},
		);
		const { schemaId: lessonSchemaId, slug: lessonSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{
				schemaName: "DeepLesson",
				propertiesSchema: {
					fields: {
						lessonNumber: { type: "integer", label: "Lesson Number", description: "Sort order" },
					},
				},
			},
		);
		const completeSlug = `complete-${crypto.randomUUID()}`;
		const completeSchema = await createEventSchema(client, {
			slug: completeSlug,
			name: "Complete",
			entitySchemaId: lessonSchemaId,
			propertiesSchema: {
				fields: { note: { type: "string", label: "Note", description: "Completion note" } },
			},
		});
		const courseModuleSlug = `deep-course-module-${crypto.randomUUID()}`;
		const moduleLessonSlug = `deep-module-lesson-${crypto.randomUUID()}`;
		const courseModuleSchema = await createRelationshipSchema(client, {
			slug: courseModuleSlug,
			name: "Deep Course Module",
			propertiesSchema: { fields: {} },
			targetEntitySchemaId: moduleSchemaId,
			sourceEntitySchemaId: courseSchemaId,
		});
		const moduleLessonSchema = await createRelationshipSchema(client, {
			slug: moduleLessonSlug,
			name: "Deep Module Lesson",
			propertiesSchema: { fields: {} },
			targetEntitySchemaId: lessonSchemaId,
			sourceEntitySchemaId: moduleSchemaId,
		});

		const course = await createQueryEngineEntity(client, {
			name: "Course",
			entitySchemaId: courseSchemaId,
		});
		const module = await createQueryEngineEntity(client, {
			name: "Module",
			entitySchemaId: moduleSchemaId,
			properties: { moduleNumber: 1 },
		});
		const secondLesson = await createQueryEngineEntity(client, {
			name: "Lesson Two",
			entitySchemaId: lessonSchemaId,
			properties: { lessonNumber: 2 },
		});
		const firstLesson = await createQueryEngineEntity(client, {
			name: "Lesson One",
			entitySchemaId: lessonSchemaId,
			properties: { lessonNumber: 1 },
		});

		await createRelationship(client, {
			targetEntityId: module.id,
			sourceEntityId: course.id,
			relationshipSchemaId: courseModuleSchema.id,
		});
		await createRelationship(client, {
			sourceEntityId: module.id,
			targetEntityId: secondLesson.id,
			relationshipSchemaId: moduleLessonSchema.id,
		});
		await createRelationship(client, {
			sourceEntityId: module.id,
			targetEntityId: firstLesson.id,
			relationshipSchemaId: moduleLessonSchema.id,
		});
		await createQueryEngineEvent(client, {
			entityId: firstLesson.id,
			eventSchemaId: completeSchema.id,
		});

		const doc = buildRowsDoc({
			limit: 1,
			alias: "course",
			schemas: [courseSlug],
			fields: [{ key: "name", expr: systemRef("course", "name") }],
			output: {
				fields: [{ key: "name", expr: systemRef("course", "name") }],
				type: "rows",
				pagination: { page: 1, limit: 1 },
				orderBy: [{ order: "asc", expr: systemRef("course", "name") }],
				include: [
					{
						limit: 10,
						key: "modules",
						fields: [{ key: "name", expr: systemRef("module", "name") }],
						orderBy: [{ order: "asc", expr: propertyRef("module", moduleSlug, "moduleNumber") }],
						source: {
							where: null,
							alias: "module",
							type: "entities",
							schemas: [moduleSlug],
							via: {
								entityRef: "course",
								alias: "courseModule",
								direction: "outgoing",
								schema: courseModuleSlug,
							},
						},
						include: [
							{
								limit: 10,
								key: "lessons",
								orderBy: [
									{ order: "asc", expr: propertyRef("lesson", lessonSlug, "lessonNumber") },
								],
								fields: [
									{ key: "name", expr: systemRef("lesson", "name") },
									{
										key: "lessonNumber",
										expr: propertyRef("lesson", lessonSlug, "lessonNumber"),
									},
									{
										key: "isComplete",
										expr: {
											type: "exists",
											source: {
												where: null,
												type: "events",
												entityRef: "lesson",
												schemas: [completeSlug],
												alias: "lessonCompletion",
											},
										},
									},
								],
								source: {
									where: null,
									alias: "lesson",
									type: "entities",
									schemas: [lessonSlug],
									via: {
										entityRef: "module",
										alias: "moduleLesson",
										direction: "outgoing",
										schema: moduleLessonSlug,
									},
								},
							},
						],
					},
				],
			},
		});

		const result = await executeQueryEngine(client, doc);

		expect(result.data.items).toHaveLength(1);
		const courseItem = result.data.items[0];
		assertPresent(courseItem, "Expected course row");
		const modules = requireQueryEngineIncludeValue(courseItem, "modules");
		expect(modules.items).toHaveLength(1);
		const moduleItem = modules.items[0];
		assertPresent(moduleItem, "Expected module row");
		const lessons = requireQueryEngineIncludeValue(moduleItem, "lessons");
		expect(lessons.items).toHaveLength(2);

		const lessonOne = lessons.items[0];
		const lessonTwo = lessons.items[1];
		assertPresent(lessonOne, "Expected first lesson row");
		assertPresent(lessonTwo, "Expected second lesson row");
		expect(requireQueryEngineFieldValue(lessonOne, "name").value).toBe("Lesson One");
		expect(requireQueryEngineFieldValue(lessonOne, "lessonNumber").value).toBe(1);
		expect(requireQueryEngineFieldValue(lessonOne, "isComplete")).toEqual({
			value: true,
			kind: "boolean",
		});
		expect(requireQueryEngineFieldValue(lessonTwo, "name").value).toBe("Lesson Two");
		expect(requireQueryEngineFieldValue(lessonTwo, "isComplete")).toEqual({
			value: false,
			kind: "boolean",
		});
	});
});
