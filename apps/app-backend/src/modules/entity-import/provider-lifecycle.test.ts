import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import {
	EntityId,
	EntitySchemaId,
	ImportRunId,
	IntegrationId,
	RelationshipId,
	RelationshipSchemaId,
} from "@ryot/contract/schema/brands";
import { assert, expect, it } from "vitest";

import { buildLifecycleOccurrences } from "./lifecycle-occurrences";
import type { PopulationMutationResult } from "./population";

const timestamp = "2026-07-12T00:00:00.000Z";

const entity = (input: { id: string; name: string; schemaId: string; properties: unknown }) =>
	({
		name: input.name,
		createdAt: timestamp,
		updatedAt: timestamp,
		externalId: input.id,
		sandboxScriptId: null,
		populatedAt: timestamp,
		properties: input.properties,
		id: EntityId.make(input.id),
		entitySchemaId: EntitySchemaId.make(input.schemaId),
	}) satisfies ListedEntity;

it("keeps nested entity and relationship mutations in one root correlation and scope", () => {
	const root = entity({ id: "show", name: "The Show", schemaId: "show-schema", properties: {} });
	const before = entity({
		id: "episode",
		name: "Old Name",
		schemaId: "episode-schema",
		properties: { episodeNumber: 1 },
	});
	const after = { ...before, name: "New Name" };
	const relationshipSchemaId = RelationshipSchemaId.make("season-episodes");
	const relationship = (id: string, targetId: string) => ({
		properties: {},
		relationshipSchemaId,
		id: RelationshipId.make(id),
		relationshipSchemaSlug: "show-season-to-show-episode",
		source: { id: EntityId.make("season"), name: "Season 1", entitySchemaSlug: "show-season" },
		target: { id: EntityId.make(targetId), name: targetId, entitySchemaSlug: "show-episode" },
	});
	const mutations = {
		entities: [
			{
				entitySchemaSlug: "show-episode",
				owningSeason: { name: "Season 1", number: 1 },
				outcome: { operation: "update", before, entity: after },
			},
		],
		relationships: [
			{
				relationshipSchemaId,
				direction: "outgoing",
				anchorEntityId: EntityId.make("season"),
				owningSeason: { name: "Season 1", number: 1 },
				outcome: {
					afterCount: 2,
					beforeCount: 0,
					mutations: [
						{ operation: "create", after: relationship("relationship-a", "episode-a") },
						{ operation: "create", after: relationship("relationship-b", "episode-b") },
					],
				},
			},
		],
	} satisfies PopulationMutationResult;

	const occurrences = buildLifecycleOccurrences({
		root,
		mutations,
		rootSchemaSlug: "show",
		executionId: "refresh-root",
		rootPreviouslyPopulated: true,
		origin: {
			kind: "integration",
			integrationId: IntegrationId.make("integration-1"),
			importRunId: ImportRunId.make("run-1"),
		},
	});

	expect(occurrences).toHaveLength(3);
	expect(occurrences.every((occurrence) => occurrence.correlationId === "refresh-root")).toBe(true);
	expect(
		occurrences.every((occurrence) => occurrence.automation.origin.kind === "integration"),
	).toBe(true);
	expect(occurrences.every((occurrence) => occurrence.automation.scopeEntity?.id === root.id)).toBe(
		true,
	);
	const relationshipOccurrences = occurrences.filter(
		(occurrence) => occurrence.target.kind === "relationship",
	);
	expect(relationshipOccurrences.map((occurrence) => occurrence.automation.batch)).toEqual([
		expect.objectContaining({ createdCount: 2, isLeader: true }),
		expect.objectContaining({ createdCount: 2, isLeader: false }),
	]);
});

it("emits a related-entity occurrence under the root scope and drops noop related stubs", () => {
	const root = entity({ id: "book", name: "The Book", schemaId: "book-schema", properties: {} });
	const createdAuthor = entity({
		properties: {},
		id: "author-new",
		name: "New Author",
		schemaId: "person-schema",
	});
	const existingAuthor = entity({
		properties: {},
		id: "author-existing",
		name: "Existing Author",
		schemaId: "person-schema",
	});
	const mutations = {
		relationships: [],
		entities: [
			{ entitySchemaSlug: "book", outcome: { operation: "create", entity: root } },
			{ entitySchemaSlug: "person", outcome: { operation: "create", entity: createdAuthor } },
			{ entitySchemaSlug: "person", outcome: { operation: "noop", entity: existingAuthor } },
		],
	} satisfies PopulationMutationResult;

	const occurrences = buildLifecycleOccurrences({
		root,
		mutations,
		rootSchemaSlug: "book",
		origin: { kind: "api" },
		executionId: "populate-book",
		rootPreviouslyPopulated: false,
	});

	expect(occurrences).toHaveLength(2);
	const relatedOccurrence = occurrences.find(
		(occurrence) =>
			occurrence.target.kind === "entity" && occurrence.target.schemaId === "person-schema",
	);
	assert(relatedOccurrence !== undefined);
	expect(relatedOccurrence.automation.operation).toBe("create");
	expect(relatedOccurrence.automation.automationDepth).toBe(1);
	expect(relatedOccurrence.automation.rootPreviouslyPopulated).toBe(false);
	expect(relatedOccurrence.automation.scopeEntity?.id).toBe(root.id);
	expect(relatedOccurrence.automation.scopeEntity?.entitySchemaSlug).toBe("book");
	const relatedSource = relatedOccurrence.automation.source;
	assert(relatedSource.kind === "entity");
	assert(relatedSource.after !== undefined);
	expect(relatedSource.after.id).toBe(createdAuthor.id);
	expect(relatedSource.after.entitySchemaSlug).toBe("person");
});
