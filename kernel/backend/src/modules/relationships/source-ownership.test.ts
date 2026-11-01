import { expect, layer } from "@effect/vitest";
import { RelationshipBadRequest } from "@ryot-app/contract/modules/relationships/schemas";
import { EntityId, EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Effect } from "effect";
import { assert } from "vitest";

import { DefinitionRepository } from "#modules/definitions/repository";
import { definitionSourceFromSnapshot } from "#modules/definitions/snapshot";
import { EntitiesRepository } from "#modules/entities/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import {
	baseInput,
	command,
	relationshipDatabaseLayer,
	sourceEntityId,
	targetEntityId,
	userId,
} from "./lifecycle.test-support";
import { RelationshipsService } from "./service";

layer(relationshipDatabaseLayer({ userWritePolicy: "source-owner" }))((test) => {
	test.effect("rejects personal creates and batches from global sources", () =>
		Effect.gen(function* () {
			const service = yield* RelationshipsService;
			assertExitFails(
				yield* Effect.exit(service.create(baseInput, command("owned-source-create"))),
				new RelationshipBadRequest({ reason: { sourceEntityId, code: "source-not-owned" } }),
			);
			assertExitFails(
				yield* Effect.exit(
					service.changeUser(
						userId,
						[{ deletes: [], creates: [{ ...baseInput, propertiesMode: "replace" }] }],
						command("owned-source-batch"),
					),
				),
				new RelationshipBadRequest({ reason: { sourceEntityId, code: "source-not-owned" } }),
			);
			expect(
				yield* (yield* DatabaseSession).run((db) => db.select().from(tables.relationship)),
			).toEqual([]);
		}),
	);
});

layer(relationshipDatabaseLayer({ userWritePolicy: "source-owner" }))((test) => {
	test.effect("permits a user-owned source to reference a global target", () =>
		Effect.gen(function* () {
			const entities = yield* EntitiesRepository;
			const [source] = yield* entities.insertEntities([
				{
					userId,
					name: "Owned",
					scope: "user",
					properties: {},
					populatedAt: null,
					entitySchemaPluginId: null,
					id: EntityId.make("owned-source"),
					entitySchemaSlug: EntitySchemaSlug.make("fixture"),
				},
			]);
			assert(source);
			const service = yield* RelationshipsService;
			const input = { ...baseInput, sourceEntityId: source.id };
			expect(
				(yield* service.create(input, command("owned-allowed"))).relationship?.sourceEntityId,
			).toBe(source.id);
			expect(
				(yield* service.create({ ...input, properties: { rank: 2 } }, command("owned-update")))
					.relationship?.properties,
			).toEqual({ rank: 2 });
			yield* service.delete(input, command("owned-delete"));
			expect(
				yield* (yield* DatabaseSession).run((db) => db.select().from(tables.relationship)),
			).toEqual([]);
		}),
	);
});

layer(relationshipDatabaseLayer({ userWritePolicy: "source-owner" }))((test) => {
	test.effect("rejects updates and deletes of personal links on global sources", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db
					.insert(tables.relationship)
					.values({
						userId,
						sourceEntityId,
						targetEntityId,
						id: "preexisting-link",
						properties: { rank: 1 },
						relationshipSchemaPluginId: null,
						relationshipSchemaSlug: baseInput.relationshipSchemaSlug,
					}),
			);
			const service = yield* RelationshipsService;
			assertExitFails(
				yield* Effect.exit(
					service.create({ ...baseInput, properties: { rank: 2 } }, command("denied-update")),
				),
				new RelationshipBadRequest({ reason: { sourceEntityId, code: "source-not-owned" } }),
			);
			assertExitFails(
				yield* Effect.exit(service.delete(baseInput, command("denied-delete"))),
				new RelationshipBadRequest({ reason: { sourceEntityId, code: "source-not-owned" } }),
			);
			assertExitFails(
				yield* Effect.exit(service.prepareUserDelete(baseInput, command("denied-prepared-delete"))),
				new RelationshipBadRequest({ reason: { sourceEntityId, code: "source-not-owned" } }),
			);
			expect(
				(yield* session.run((db) => db.select().from(tables.relationship))).map(
					({ properties }) => properties,
				),
			).toEqual([{ rank: 1 }]);
		}),
	);
});

layer(relationshipDatabaseLayer({ userWritePolicy: "source-owner" }))((test) => {
	test.effect("allows authorized global reconciliation without a sandbox policy", () =>
		Effect.gen(function* () {
			const service = yield* RelationshipsService;
			const session = yield* DatabaseSession;
			const result = yield* session.transaction(
				service.persistPlannedReconciliation(
					[
						{
							relationshipSchema: baseInput.relationshipSchema,
							relationships: [{ sourceEntityId, targetEntityId, properties: { rank: 1 } }],
							selector: { type: "anchored", direction: "outgoing", anchorEntityId: sourceEntityId },
						},
					],
					command("global-provider-population"),
					{ scope: "global" },
				),
			);
			expect(result.result).toMatchObject([{ created: 1 }]);
		}),
	);
});

layer(relationshipDatabaseLayer())((test) => {
	test.effect("keeps unrestricted annotation relationships writable from global sources", () =>
		Effect.gen(function* () {
			const result = yield* (yield* RelationshipsService).create(baseInput, command("annotation"));
			expect(result.relationship?.sourceEntityId).toBe(sourceEntityId);
		}),
	);
});

layer(relationshipDatabaseLayer())((test) => {
	test.effect("rechecks source ownership at the prepared commit after schema policy changes", () =>
		Effect.gen(function* () {
			const service = yield* RelationshipsService;
			const prepared = yield* service.prepareUserCreate(
				baseInput,
				command("prepared-before-policy"),
			);
			assert(prepared !== null);
			const definitions = yield* DefinitionRepository;
			const source = definitionSourceFromSnapshot(yield* definitions.getGlobalSnapshot);
			yield* definitions.replaceKernelDefinitions({
				...source,
				relationshipSchemas: source.relationshipSchemas.map((schema) =>
					Object.assign({}, schema, { userWritePolicy: "source-owner" as const }),
				),
			});
			assertExitFails(
				yield* Effect.exit(
					(yield* DatabaseSession).transaction(service.persistPreparedUserCreate(prepared)),
				),
				new RelationshipBadRequest({ reason: { sourceEntityId, code: "source-not-owned" } }),
			);
			expect(
				yield* (yield* DatabaseSession).run((db) => db.select().from(tables.relationship)),
			).toEqual([]);
		}),
	);
});
