import { expect } from "bun:test";

import { RelationshipBadRequest } from "@ryot-app/contract/modules/relationships/schemas";
import { EntityId, EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { definitionSourceFromSnapshot } from "@ryot-app/definitions/snapshot";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { DatabaseSession } from "#platform/db/session";
import { WritePreparation, WriteTransaction } from "#platform/db/write-transaction";
import * as tables from "#schema/tables/combined";

import {
	baseInput,
	command,
	persistPrepared,
	relationshipChangeSetsLayer,
	sourceEntityId,
	targetEntityId,
	userId,
	writeRelationship,
} from "./lifecycle.test-support";
import { RelationshipsService } from "./service";

layer(relationshipChangeSetsLayer({ userWritePolicy: "source-owner" }))((test) => {
	test.effect(
		"rejects personal creates from global sources",
		() =>
			Effect.gen(function* () {
				assertExitFails(
					yield* Effect.exit(
						writeRelationship("upsert", baseInput, command("owned-source-create")),
					),
					new RelationshipBadRequest({ reason: { sourceEntityId, code: "source-not-owned" } }),
				);
				expect(
					yield* (yield* DatabaseSession).run((db) => db.select().from(tables.relationship)),
				).toEqual([]);
			}),
		testTimeout,
	);
});

layer(relationshipChangeSetsLayer({ userWritePolicy: "source-owner" }))((test) => {
	test.effect(
		"permits a user-owned source to reference a global target",
		() =>
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
				const input = { ...baseInput, sourceEntityId: source.id };
				expect(
					(yield* writeRelationship("upsert", input, command("owned-allowed"))).relationship
						?.sourceEntityId,
				).toBe(source.id);
				expect(
					(yield* writeRelationship(
						"upsert",
						{ ...input, properties: { rank: 2 } },
						command("owned-update"),
					)).relationship?.properties,
				).toEqual({ rank: 2 });
				yield* writeRelationship("delete", input, command("owned-delete"));
				expect(
					yield* (yield* DatabaseSession).run((db) => db.select().from(tables.relationship)),
				).toEqual([]);
			}),
		testTimeout,
	);
});

layer(relationshipChangeSetsLayer({ userWritePolicy: "source-owner" }))((test) => {
	test.effect(
		"rejects updates and deletes of personal links on global sources",
		() =>
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
						writeRelationship(
							"upsert",
							{ ...baseInput, properties: { rank: 2 } },
							command("denied-update"),
						),
					),
					new RelationshipBadRequest({ reason: { sourceEntityId, code: "source-not-owned" } }),
				);
				assertExitFails(
					yield* Effect.exit(writeRelationship("delete", baseInput, command("denied-delete"))),
					new RelationshipBadRequest({ reason: { sourceEntityId, code: "source-not-owned" } }),
				);
				assertExitFails(
					yield* Effect.exit(
						service.prepareUserDelete(
							new WritePreparation(),
							baseInput,
							command("denied-prepared-delete"),
						),
					),
					new RelationshipBadRequest({ reason: { sourceEntityId, code: "source-not-owned" } }),
				);
				expect(
					(yield* session.run((db) => db.select().from(tables.relationship))).map(
						({ properties }) => properties,
					),
				).toEqual([{ rank: 1 }]);
			}),
		testTimeout,
	);
});

layer(relationshipChangeSetsLayer({ userWritePolicy: "source-owner" }))((test) => {
	test.effect(
		"allows authorized global reconciliation without a sandbox policy",
		() =>
			Effect.gen(function* () {
				const service = yield* RelationshipsService;
				const session = yield* DatabaseSession;
				const result = yield* session.transaction(
					service.persistPlannedReconciliation(
						new WriteTransaction(),
						[
							{
								relationshipSchema: baseInput.relationshipSchema,
								relationships: [{ sourceEntityId, targetEntityId, properties: { rank: 1 } }],
								selector: {
									type: "anchored",
									direction: "outgoing",
									anchorEntityId: sourceEntityId,
								},
							},
						],
						command("global-provider-population"),
						{ scope: "global" },
					),
				);
				expect(result.result).toMatchObject([{ created: 1 }]);
			}),
		testTimeout,
	);
});

layer(relationshipChangeSetsLayer())((test) => {
	test.effect(
		"keeps unrestricted annotation relationships writable from global sources",
		() =>
			Effect.gen(function* () {
				const result = yield* writeRelationship("upsert", baseInput, command("annotation"));
				expect(result.relationship?.sourceEntityId).toBe(sourceEntityId);
			}),
		testTimeout,
	);
});

layer(relationshipChangeSetsLayer())((test) => {
	test.effect(
		"rechecks source ownership at the prepared commit after schema policy changes",
		() =>
			Effect.gen(function* () {
				const service = yield* RelationshipsService;
				const prepared = yield* service.prepareUserWrite(
					new WritePreparation(),
					baseInput,
					command("prepared-before-policy"),
					"upsert",
				);
				const definitions = yield* DefinitionRepository;
				const source = definitionSourceFromSnapshot(yield* definitions.getGlobalSnapshot);
				yield* definitions.replaceKernelDefinitions({
					...source,
					relationshipSchemas: source.relationshipSchemas.map((schema) =>
						Object.assign({}, schema, { userWritePolicy: "source-owner" as const }),
					),
				});
				assertExitFails(
					yield* Effect.exit(persistPrepared(prepared)),
					new RelationshipBadRequest({ reason: { sourceEntityId, code: "source-not-owned" } }),
				);
				expect(
					yield* (yield* DatabaseSession).run((db) => db.select().from(tables.relationship)),
				).toEqual([]);
			}),
		testTimeout,
	);
});
