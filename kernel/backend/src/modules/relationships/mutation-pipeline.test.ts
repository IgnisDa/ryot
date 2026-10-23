import { expect, layer } from "@effect/vitest";
import {
	definitionKey,
	definitionOwner,
	type RelationshipSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import {
	AutomationRunId,
	EntityId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { assert, describe } from "vitest";

import {
	withLifecycleBatchPlanning,
	withLifecycleDispatch,
} from "#modules/automations/lifecycle.test-support";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecyclePlanner } from "#modules/automations/lifecycle/planning";
import { DefinitionRepository } from "#modules/definitions/repository";
import {
	countStatementClasses,
	StatementLog,
} from "#modules/entities/statement-recording.test-support";
import { catalogDefinitionFingerprint } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import {
	baseInput,
	command,
	installPolicyFixture,
	ownedEndpoints,
	propertiesSchema,
	relationshipDatabaseLayer,
	RelationshipFixture,
	relationshipsServiceWith,
	sourceEntityId,
	userId,
} from "./lifecycle.test-support";
import { RelationshipMutationPipeline } from "./mutation-pipeline";
import { itemCommand, type Mutation } from "./mutation-support";
import { RelationshipsRepository } from "./repository";
import { RelationshipsService } from "./service";

const otherUserId = UserId.make("other-relationship-owner");

type RelationshipBase = {
	readonly sourceEntityId: EntityId;
	readonly relationshipSchema: RelationshipSchemaReference;
};

const insertEntities = Effect.fnUntraced(function* (
	ids: ReadonlyArray<string>,
	owner: UserId | null = null,
	entitySchemaPluginId: string | null = null,
) {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		db
			.insert(tables.entity)
			.values(
				ids.map((id) => ({
					id,
					name: id,
					userId: owner,
					properties: {},
					entitySchemaPluginId,
					entitySchemaSlug: "fixture",
				})),
			),
	);
	return ids.map((id) => EntityId.make(id));
});

const insertForeignEntity = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		db
			.insert(tables.user)
			.values({
				id: otherUserId,
				name: "Other owner",
				email: "other-relationship@example.test",
				accountGeneration: "test-account-generation",
			}),
	);
	const [foreign] = yield* insertEntities(["foreign-private-entity"], otherUserId);
	assert(foreign);
	return foreign;
});

const deleteEntity = (session: DatabaseSession["Service"], entityId: EntityId) =>
	session
		.run((db) => db.delete(tables.entity).where(eq(tables.entity.id, entityId)))
		.pipe(Effect.orDie);

const userMutations = Effect.fnUntraced(function* (
	base: RelationshipBase,
	targets: ReadonlyArray<EntityId>,
	id: string,
	properties: Record<string, unknown> = { rank: 1 },
) {
	const definitions = yield* DefinitionRepository;
	const reference = base.relationshipSchema;
	const definition = (yield* definitions.findUserRelationshipSchemas(userId, [reference]))[
		definitionKey("relationship", reference.owner, reference.slug)
	];
	assert(definition);
	return targets.map((targetEntityId): Mutation => {
		const input = {
			userId,
			targetEntityId,
			scope: "user" as const,
			sourceEntityId: base.sourceEntityId,
			relationshipSchemaSlug: reference.slug,
			relationshipSchemaPluginId: definition.pluginId ?? null,
		};
		return {
			input,
			properties,
			mode: "upsert",
			propertiesSchema: definition.propertiesSchema,
			command: itemCommand(command(id), input, "test"),
			schemaFingerprint: catalogDefinitionFingerprint(definition),
		};
	});
});

const reconciliationGroup = (
	base: RelationshipBase,
	targets: ReadonlyArray<EntityId>,
	rank: number,
) => ({
	relationshipSchema: base.relationshipSchema,
	selector: {
		type: "anchored" as const,
		direction: "outgoing" as const,
		anchorEntityId: base.sourceEntityId,
	},
	relationships: targets.map((targetEntityId) => ({
		targetEntityId,
		properties: { rank },
		sourceEntityId: base.sourceEntityId,
	})),
});

const policyLifecycle = Effect.fnUntraced(function* (
	policy: ReturnType<LifecycleExecution["Service"]["executePolicy"]> = Effect.succeed({
		action: "allow" as const,
	}),
) {
	const planner = yield* LifecyclePlanner;
	const execution = yield* LifecycleExecution;
	return {
		execution: withLifecycleDispatch({
			...execution,
			executePolicy: () => policy,
			after: () => Effect.succeed([]),
		}),
		planner: withLifecycleBatchPlanning({
			plan: (input) =>
				planner
					.plan(input)
					.pipe(
						Effect.map((plan) =>
							plan.trigger === null || input.trigger.kind.category !== "request"
								? plan
								: {
										...plan,
										policies: [{ position: 1, runId: AutomationRunId.make("test-policy") }],
									},
						),
					),
		}),
	};
});

const pipelineWith = (lifecycle: Effect.Success<ReturnType<typeof policyLifecycle>>) =>
	RelationshipMutationPipeline.make.pipe(
		Effect.provideService(LifecyclePlanner, lifecycle.planner),
		Effect.provideService(LifecycleExecution, lifecycle.execution),
	);

const lastTransactionChecks = Effect.gen(function* () {
	const log = yield* StatementLog;
	return countStatementClasses(yield* log.lastTransaction).check;
});

const entityNotFound = (targetEntityId: EntityId, source: EntityId = sourceEntityId) =>
	new RelationshipNotFound({
		reason: { code: "entity-not-found", entityIds: [source, targetEntityId] },
	});

const overlappingBatch = (order: ReadonlyArray<EntityId>, rank: number) => [
	{
		deletes: [],
		creates: order.map((targetEntityId) => ({
			...baseInput,
			targetEntityId,
			properties: { rank },
			propertiesMode: "replace" as const,
		})),
	},
];

const concurrentChange = new RelationshipBadRequest({
	reason: { code: "concurrent-relationship-change" },
});

describe("Relationship set-based mutation pipeline", () => {
	layer(relationshipDatabaseLayer())((test) => {
		test.effect("keeps a concurrent ensure from overwriting existing relationship metadata", () =>
			Effect.gen(function* () {
				const repository = yield* RelationshipsRepository;
				const policyInput = yield* installPolicyFixture();
				const pipeline = yield* pipelineWith(yield* policyLifecycle());
				const [mutation] = yield* userMutations(
					policyInput,
					[policyInput.targetEntityId],
					"ensure-race",
					{ rank: 2 },
				);
				assert(mutation);
				const prepared = yield* pipeline.prepareMutations([{ ...mutation, mode: "ensure" }]);
				assert(prepared._tag === "PoliciesRequired");
				const [pendingItem] = prepared.pending.items;
				expect(pendingItem?.receipt.commandKind).toBe("relationship:ensure");

				const existingProperties = { rank: 9, labels: ["saved"] };
				yield* repository.createRelationship({ ...mutation.input, properties: existingProperties });
				const pending = yield* pipeline.applyPolicies(prepared.pending);
				const committed = yield* pipeline.commitProjected(pending, (results) => results);
				assert(committed._tag === "Committed");
				expect(committed.result).toMatchObject([
					{ operation: "noop", relationship: { properties: existingProperties } },
				]);
			}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
		test.effect(
			"keeps write-check statements constant in every relationship writing transaction",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const service = yield* RelationshipsService;
					const pipeline = yield* RelationshipMutationPipeline;
					const policyInput = yield* installPolicyFixture();
					const policyPipeline = yield* pipelineWith(yield* policyLifecycle());
					const counts = {
						policy: [] as number[],
						ordinary: [] as number[],
						reconciliation: [] as number[],
					};
					for (const size of [2, 20]) {
						const names = Array.from({ length: size }, (_, index) => `invariance-${size}-${index}`);
						const targets = yield* insertEntities(names);
						yield* pipeline.prepareMutations(
							yield* userMutations(baseInput, targets, `ordinary-${size}`),
						);
						counts.ordinary.push(yield* lastTransactionChecks);
						const step = yield* policyPipeline.prepareMutations(
							yield* userMutations(
								policyInput,
								yield* insertEntities(
									names.map((name) => `policy-${name}`),
									userId,
									policyInput.relationshipSchemaPluginId,
								),
								`policy-${size}`,
							),
						);
						assert(step._tag === "PoliciesRequired");
						yield* policyPipeline.commitProjected(
							yield* policyPipeline.applyPolicies(step.pending),
							(results) => results,
						);
						counts.policy.push(yield* lastTransactionChecks);
						yield* session.transaction(
							service.persistPlannedReconciliation(
								[reconciliationGroup(baseInput, targets, 3)],
								command(`reconciliation-${size}`),
								{ userId, scope: "user" },
							),
						);
						counts.reconciliation.push(yield* lastTransactionChecks);
					}
					for (const [small, large] of Object.values(counts)) {
						expect(small).toBeGreaterThan(0);
						expect(large).toBe(small);
					}
				}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
		test.effect("rejects an entity deleted between plan and commit on every path", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const service = yield* RelationshipsService;
				const repository = yield* RelationshipsRepository;
				const pipeline = yield* RelationshipMutationPipeline;
				const policyInput = yield* installPolicyFixture();
				const [ordinary, reconciled, preparedCreate, preparedDelete] = yield* insertEntities([
					"deleted-ordinary",
					"deleted-reconciled",
					"deleted-prepared-create",
					"deleted-prepared-delete",
				]);
				const [policy] = yield* insertEntities(
					["deleted-policy"],
					userId,
					policyInput.relationshipSchemaPluginId,
				);
				assert(ordinary && policy && reconciled && preparedCreate && preparedDelete);

				const mutations = yield* userMutations(baseInput, [ordinary], "deleted-ordinary");
				yield* deleteEntity(session, ordinary);
				expect(yield* pipeline.prepareMutations(mutations).pipe(Effect.flip)).toEqual(
					entityNotFound(ordinary),
				);

				const policyService = yield* relationshipsServiceWith(
					yield* policyLifecycle(
						deleteEntity(session, policy).pipe(Effect.as({ action: "allow" as const })),
					),
				);
				expect(
					yield* policyService
						.createUser(
							userId,
							{ ...policyInput, targetEntityId: policy },
							command("deleted-policy"),
						)
						.pipe(Effect.flip),
				).toEqual(entityNotFound(policy, policyInput.sourceEntityId));

				yield* deleteEntity(session, reconciled);
				expect(
					yield* session
						.transaction(
							service.persistPlannedReconciliation(
								[reconciliationGroup(baseInput, [reconciled], 1)],
								command("deleted-reconciled"),
								{ userId, scope: "user" },
							),
						)
						.pipe(Effect.flip),
				).toEqual(entityNotFound(reconciled));

				const creation = yield* service.prepareUserCreate(
					{ ...baseInput, targetEntityId: preparedCreate },
					command("deleted-prepared-create"),
				);
				assert(creation);
				yield* deleteEntity(session, preparedCreate);
				expect(
					yield* session.transaction(service.persistPreparedUserCreate(creation)).pipe(Effect.flip),
				).toEqual(entityNotFound(preparedCreate));

				yield* repository.createRelationship({ ...baseInput, targetEntityId: preparedDelete });
				const deletion = yield* service.prepareUserDelete(
					{ ...baseInput, targetEntityId: preparedDelete },
					command("deleted-prepared-delete"),
				);
				assert(deletion);
				yield* deleteEntity(session, preparedDelete);
				expect(
					yield* session.transaction(service.persistPreparedUserDelete(deletion)).pipe(Effect.flip),
				).toEqual(entityNotFound(preparedDelete));
				expect(yield* session.run((db) => db.select().from(tables.relationship))).toEqual([]);
			}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
		test.effect("rejects another user's private entity on every path", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const service = yield* RelationshipsService;
				const pipeline = yield* RelationshipMutationPipeline;
				const policyInput = yield* installPolicyFixture();
				const policyPipeline = yield* pipelineWith(yield* policyLifecycle());
				const foreign = yield* insertForeignEntity;
				const foreignInput = { ...baseInput, targetEntityId: foreign };

				expect(
					yield* pipeline
						.prepareMutations(yield* userMutations(baseInput, [foreign], "foreign-ordinary"))
						.pipe(Effect.flip),
				).toEqual(entityNotFound(foreign));
				expect(
					yield* policyPipeline
						.prepareMutations(yield* userMutations(policyInput, [foreign], "foreign-policy"))
						.pipe(Effect.flip),
				).toEqual(entityNotFound(foreign, policyInput.sourceEntityId));
				expect(
					yield* session
						.transaction(
							service.persistPlannedReconciliation(
								[reconciliationGroup(baseInput, [foreign], 1)],
								command("foreign-reconciled"),
								{ userId, scope: "user" },
							),
						)
						.pipe(Effect.flip),
				).toEqual(entityNotFound(foreign));
				expect(
					yield* service
						.prepareUserCreate(foreignInput, command("foreign-create"))
						.pipe(Effect.flip),
				).toEqual(entityNotFound(foreign));
				expect(
					yield* service
						.prepareUserDelete(foreignInput, command("foreign-delete"))
						.pipe(Effect.flip),
				).toEqual(entityNotFound(foreign));
				expect(yield* session.run((db) => db.select().from(tables.relationship))).toEqual([]);
			}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
		test.effect("keeps a missing relationship schema typed in prepared mutations", () =>
			Effect.gen(function* () {
				const service = yield* RelationshipsService;
				const missing = {
					...baseInput,
					relationshipSchema: {
						...baseInput.relationshipSchema,
						slug: RelationshipSchemaSlug.make("missing-link"),
					},
				};
				expect(
					yield* service.prepareUserDelete(missing, command("missing-delete")).pipe(Effect.flip),
				).toEqual(
					new RelationshipNotFound({
						reason: { schema: missing.relationshipSchema, code: "relationship-schema-not-found" },
					}),
				);
				expect(
					yield* service.prepareUserCreate(missing, command("missing-create")).pipe(Effect.flip),
				).toEqual(concurrentChange);
			}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
		test.effect("detects a selector match committed between plan and commit", () =>
			Effect.gen(function* () {
				const repository = yield* RelationshipsRepository;
				const session = yield* DatabaseSession;
				yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({ id: "owner", name: "Plugin owner", email: "owner@example.test" }),
				);
				const globalInput = yield* installPolicyFixture(null);
				const service = yield* relationshipsServiceWith(
					yield* policyLifecycle(
						repository
							.createRelationship({
								scope: "global",
								properties: { rank: 2 },
								sourceEntityId: globalInput.sourceEntityId,
								targetEntityId: globalInput.sourceEntityId,
								relationshipSchemaSlug: globalInput.relationshipSchemaSlug,
								relationshipSchemaPluginId: globalInput.relationshipSchemaPluginId,
							})
							.pipe(Effect.orDie, Effect.as({ action: "allow" as const })),
					),
				);
				expect(
					yield* service
						.reconcileGlobal(
							[reconciliationGroup(globalInput, [globalInput.targetEntityId], 1)],
							command("selector-race"),
						)
						.pipe(Effect.flip),
				).toEqual(concurrentChange);
				expect(
					(yield* session.run((db) => db.select().from(tables.relationship))).map(
						({ targetEntityId }) => targetEntityId,
					),
				).toEqual([globalInput.sourceEntityId]);
			}),
		);
	});

	layer(relationshipDatabaseLayer({ mutableRelationshipSchema: true }))((test) => {
		test.effect("rejects a relationship schema change between plan and commit", () =>
			Effect.gen(function* () {
				const catalog = yield* RelationshipFixture;
				const session = yield* DatabaseSession;
				const service = yield* RelationshipsService;
				const prepared = yield* service.prepareUserCreate(baseInput, command("schema-change"));
				assert(prepared);
				yield* catalog.updateRelationshipSchema;
				expect(
					yield* session.transaction(service.persistPreparedUserCreate(prepared)).pipe(Effect.flip),
				).toEqual(concurrentChange);
				expect(yield* session.run((db) => db.select().from(tables.relationship))).toEqual([]);
			}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
		test.effect("rejects a plugin revision change between plan and commit", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const service = yield* RelationshipsService;
				const original = revisionPackage("revised-writer", "v1", "revised-entity");
				const installed = yield* installRevisionPackage(original, userId);
				const slug = RelationshipSchemaSlug.make("revised-writer-link");
				const prepared = yield* service.prepareUserCreate(
					{
						userId,
						scope: "user",
						properties: {},
						...(yield* ownedEndpoints(installed, "revised-entity", "user")),
						relationshipSchema: { slug, owner: definitionOwner(installed.pluginId) },
					},
					command("revised-writer"),
				);
				assert(prepared);
				const revised = revisionPackage(
					"revised-writer",
					"v2",
					"revised-entity",
					original.manifest.metadata.packageId,
				);
				const [link] = revised.manifest.relationshipSchemas;
				assert(link);
				const next = yield* installRevisionPackage(
					{
						...revised,
						manifest: { ...revised.manifest, relationshipSchemas: [{ ...link, propertiesSchema }] },
					},
					userId,
				);
				expect(next.revisionId).not.toBe(installed.revisionId);
				expect(
					yield* session.transaction(service.persistPreparedUserCreate(prepared)).pipe(Effect.flip),
				).toEqual(concurrentChange);
				expect(yield* session.run((db) => db.select().from(tables.relationship))).toEqual([]);
			}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
		test.effect("rejects policy-transformed properties invalid under the pinned schema", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const policyInput = yield* installPolicyFixture();
				const service = yield* relationshipsServiceWith(
					yield* policyLifecycle(
						Effect.succeed({
							action: "transform" as const,
							patch: {
								resource: "relationship" as const,
								draft: { properties: { remove: [], set: { rank: "invalid" } } },
							},
						}),
					),
				);
				expect(
					yield* service
						.createUser(userId, policyInput, command("invalid-transform"))
						.pipe(Effect.flip),
				).toMatchObject({ reason: { code: "invalid-properties" } });
				expect(yield* session.run((db) => db.select().from(tables.relationship))).toEqual([]);
			}),
		);
	});

	layer(relationshipDatabaseLayer({ holdLocks: /hashtextextended/ }))((test) => {
		test.effect("serializes overlapping relationship batches without deadlocks", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const service = yield* RelationshipsService;
				const log = yield* StatementLog;
				const targets = yield* insertEntities(["overlap-1", "overlap-2", "overlap-3", "overlap-4"]);
				yield* Effect.all(
					[
						service.changeUser(userId, overlappingBatch(targets, 1), command("overlap-forward")),
						service.changeUser(
							userId,
							overlappingBatch(targets.toReversed(), 2),
							command("overlap-reverse"),
						),
					],
					{ concurrency: "unbounded" },
				);
				expect(yield* log.errorCodes).not.toContain("40P01");
				const rows = yield* session.run((db) => db.select().from(tables.relationship));
				expect(rows.map(({ targetEntityId }) => targetEntityId).sort()).toEqual(
					[...targets].sort(),
				);
				expect(new Set(rows.map(({ properties }) => JSON.stringify(properties))).size).toBe(1);
			}),
		);
	});
});
