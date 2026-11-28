import { describe, expect } from "bun:test";

import type { AutomationPolicyOutput } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	definitionOwner,
	type RelationshipSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import { EntityId, RelationshipSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { decidingPolicies } from "#modules/automations/lifecycle.test-support";
import { LifecyclePolicies } from "#modules/automations/lifecycle/policies";
import { CommitConflict } from "#modules/changes/conflict";
import { ChangeSets } from "#modules/changes/service";
import {
	countStatementClasses,
	StatementLog,
} from "#modules/entities/statement-recording.test-support";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import { WriteTransaction } from "#platform/db/write-transaction";
import * as tables from "#schema/tables/combined";

import {
	baseInput,
	changeSetsWith,
	command,
	installPolicyFixture,
	ownedEndpoints,
	persistPrepared,
	prepareUserChange,
	propertiesSchema,
	relationshipChangeSetsLayer,
	RelationshipFixture,
	sourceEntityId,
	userId,
	writeRelationship,
} from "./lifecycle.test-support";
import { RelationshipsRepository } from "./repository";
import { RelationshipsService } from "./service";

const otherUserId = UserId.make("other-relationship-owner");

type RelationshipBase = {
	readonly sourceEntityId: EntityId;
	readonly relationshipSchema: RelationshipSchemaReference;
};

const insertEntities = Effect.fnUntraced(function* (
	ids: ReadonlyArray<string>,
	owner: null | UserId = null,
	entitySchemaPluginId: null | string = null,
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
			.values({ id: otherUserId, name: "Other owner", email: "other-relationship@example.test" }),
	);
	const [foreign] = yield* insertEntities(["foreign-private-entity"], otherUserId);
	assert(foreign);
	return foreign;
});

const deleteEntity = (session: DatabaseSession["Service"], entityId: EntityId) =>
	session
		.run((db) => db.delete(tables.entity).where(eq(tables.entity.id, entityId)))
		.pipe(Effect.orDie);

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
	policy: Effect.Effect<AutomationPolicyOutput> = Effect.succeed({ action: "allow" as const }),
) {
	return { policies: decidingPolicies((yield* LifecyclePolicies).match, () => policy) };
});

const lastTransactionChecks = Effect.gen(function* () {
	const log = yield* StatementLog;
	return countStatementClasses(yield* log.lastTransaction).check;
});

const entityNotFound = (targetEntityId: EntityId, source: EntityId = sourceEntityId) =>
	new RelationshipNotFound({
		reason: { code: "entity-not-found", entityIds: [source, targetEntityId] },
	});

const entityConflict = (targetEntityId: EntityId, source: EntityId = sourceEntityId) =>
	new CommitConflict({ reason: { code: "entity-not-found", entityIds: [source, targetEntityId] } });

const concurrentChange = new RelationshipBadRequest({
	reason: { code: "concurrent-relationship-change" },
});

describe("Prepared relationship mutations", () => {
	layer(relationshipChangeSetsLayer())("relationship mutation harness", (test) => {
		test.effect(
			"keeps a concurrent ensure from overwriting existing relationship metadata",
			() =>
				Effect.gen(function* () {
					const repository = yield* RelationshipsRepository;
					const policyInput = yield* installPolicyFixture();
					const existingProperties = { rank: 9, labels: ["saved"] };
					const committed = yield* writeRelationship(
						"ensure",
						{ ...policyInput, properties: { rank: 2 } },
						command("ensure-race"),
						yield* changeSetsWith(
							yield* policyLifecycle(
								repository
									.createRelationship(new WriteTransaction(), {
										...policyInput,
										properties: existingProperties,
									})
									.pipe(Effect.as({ action: "allow" as const }), Effect.orDie),
							),
						),
					);
					expect(committed).toMatchObject({
						operation: "noop",
						relationship: { properties: existingProperties },
					});
				}),
			testTimeout,
		);
	});

	layer(relationshipChangeSetsLayer())("relationship mutation harness", (test) => {
		test.effect(
			"keeps write-check statements constant in every relationship writing transaction",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const service = yield* RelationshipsService;
					const counts = { reconciliation: [] as number[] };
					for (const size of [2, 20]) {
						const names = Array.from({ length: size }, (_, index) => `invariance-${size}-${index}`);
						const targets = yield* insertEntities(names);
						yield* session.transaction(
							service.persistPlannedReconciliation(
								new WriteTransaction(),
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
			testTimeout,
		);
	});

	layer(relationshipChangeSetsLayer())("relationship mutation harness", (test) => {
		test.effect(
			"rejects an entity deleted between plan and commit on every path",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const service = yield* RelationshipsService;
					const repository = yield* RelationshipsRepository;
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

					yield* deleteEntity(session, ordinary);
					expect(
						yield* writeRelationship(
							"upsert",
							{ ...baseInput, targetEntityId: ordinary },
							command("deleted-ordinary"),
						).pipe(Effect.flip),
					).toEqual(entityConflict(ordinary));

					expect(
						yield* writeRelationship(
							"upsert",
							{ ...policyInput, targetEntityId: policy },
							command("deleted-policy"),
							yield* changeSetsWith(
								yield* policyLifecycle(
									deleteEntity(session, policy).pipe(Effect.as({ action: "allow" as const })),
								),
							),
						).pipe(Effect.flip),
					).toEqual(entityConflict(policy, policyInput.sourceEntityId));

					yield* deleteEntity(session, reconciled);
					expect(
						yield* session
							.transaction(
								service.persistPlannedReconciliation(
									new WriteTransaction(),
									[reconciliationGroup(baseInput, [reconciled], 1)],
									command("deleted-reconciled"),
									{ userId, scope: "user" },
								),
							)
							.pipe(Effect.flip),
					).toEqual(entityNotFound(reconciled));

					const creation = yield* prepareUserChange({
						mode: "upsert",
						command: command("deleted-prepared-create"),
						input: { ...baseInput, targetEntityId: preparedCreate },
					});
					yield* deleteEntity(session, preparedCreate);
					expect(yield* persistPrepared(creation).pipe(Effect.flip)).toEqual(
						entityNotFound(preparedCreate),
					);

					yield* repository.createRelationship(new WriteTransaction(), {
						...baseInput,
						targetEntityId: preparedDelete,
					});
					const deletion = yield* prepareUserChange({
						mode: "delete",
						command: command("deleted-prepared-delete"),
						input: { ...baseInput, targetEntityId: preparedDelete },
					});
					yield* deleteEntity(session, preparedDelete);
					expect(yield* persistPrepared(deletion).pipe(Effect.flip)).toEqual(
						entityNotFound(preparedDelete),
					);
					expect(yield* session.run((db) => db.select().from(tables.relationship))).toEqual([]);
				}),
			testTimeout,
		);
	});

	layer(relationshipChangeSetsLayer())("relationship mutation harness", (test) => {
		test.effect(
			"rejects another user's private entity on every path",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const service = yield* RelationshipsService;
					const policyInput = yield* installPolicyFixture();
					const foreign = yield* insertForeignEntity;
					const foreignInput = { ...baseInput, targetEntityId: foreign };

					expect(
						yield* writeRelationship("upsert", foreignInput, command("foreign-ordinary")).pipe(
							Effect.flip,
						),
					).toEqual(entityConflict(foreign));
					expect(
						yield* writeRelationship(
							"upsert",
							{ ...policyInput, targetEntityId: foreign },
							command("foreign-policy"),
							yield* changeSetsWith(yield* policyLifecycle()),
						).pipe(Effect.flip),
					).toEqual(entityConflict(foreign, policyInput.sourceEntityId));
					expect(
						yield* session
							.transaction(
								service.persistPlannedReconciliation(
									new WriteTransaction(),
									[reconciliationGroup(baseInput, [foreign], 1)],
									command("foreign-reconciled"),
									{ userId, scope: "user" },
								),
							)
							.pipe(Effect.flip),
					).toEqual(entityNotFound(foreign));
					expect(
						yield* prepareUserChange({
							mode: "upsert",
							input: foreignInput,
							command: command("foreign-create"),
						}).pipe(Effect.flip),
					).toEqual(entityNotFound(foreign));
					expect(
						yield* prepareUserChange({
							mode: "delete",
							input: foreignInput,
							command: command("foreign-delete"),
						}).pipe(Effect.flip),
					).toEqual(entityNotFound(foreign));
					expect(yield* session.run((db) => db.select().from(tables.relationship))).toEqual([]);
				}),
			testTimeout,
		);
	});

	layer(relationshipChangeSetsLayer())("relationship mutation harness", (test) => {
		test.effect(
			"keeps a missing relationship schema typed in prepared mutations",
			() =>
				Effect.gen(function* () {
					const missing = {
						...baseInput,
						relationshipSchema: {
							...baseInput.relationshipSchema,
							slug: RelationshipSchemaSlug.make("missing-link"),
						},
					};
					const notFound = new RelationshipNotFound({
						reason: { schema: missing.relationshipSchema, code: "relationship-schema-not-found" },
					});
					expect(
						yield* prepareUserChange({
							mode: "delete",
							input: missing,
							command: command("missing-delete"),
						}).pipe(Effect.flip),
					).toEqual(notFound);
					expect(
						yield* prepareUserChange({
							mode: "upsert",
							input: missing,
							command: command("missing-create"),
						}).pipe(Effect.flip),
					).toEqual(notFound);
				}),
			testTimeout,
		);
	});

	layer(relationshipChangeSetsLayer({ mutableRelationshipSchema: true }))(
		"relationship pipeline harness",
		(test) => {
			test.effect(
				"rejects a relationship schema change between plan and commit",
				() =>
					Effect.gen(function* () {
						const catalog = yield* RelationshipFixture;
						const session = yield* DatabaseSession;
						const prepared = yield* prepareUserChange({
							mode: "upsert",
							input: baseInput,
							command: command("schema-change"),
						});
						yield* catalog.updateRelationshipSchema;
						expect(yield* persistPrepared(prepared).pipe(Effect.flip)).toEqual(concurrentChange);
						expect(yield* session.run((db) => db.select().from(tables.relationship))).toEqual([]);
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer())("relationship mutation harness", (test) => {
		test.effect(
			"rejects a plugin revision change between plan and commit",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const original = revisionPackage("revised-writer", "v1", "revised-entity");
					const installed = yield* installRevisionPackage(original, userId);
					const slug = RelationshipSchemaSlug.make("revised-writer-link");
					const prepared = yield* prepareUserChange({
						mode: "upsert",
						command: command("revised-writer"),
						input: {
							userId,
							scope: "user",
							properties: {},
							...(yield* ownedEndpoints(installed, "revised-entity", "user")),
							relationshipSchema: { slug, owner: definitionOwner(installed.pluginId) },
						},
					});
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
							manifest: {
								...revised.manifest,
								relationshipSchemas: [{ ...link, propertiesSchema }],
							},
						},
						userId,
					);
					expect(next.revisionId).not.toBe(installed.revisionId);
					expect(yield* persistPrepared(prepared).pipe(Effect.flip)).toEqual(concurrentChange);
					expect(yield* session.run((db) => db.select().from(tables.relationship))).toEqual([]);
				}),
			testTimeout,
		);
	});

	layer(relationshipChangeSetsLayer())("relationship mutation harness", (test) => {
		test.effect(
			"rejects policy-transformed properties invalid under the pinned schema",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const policyInput = yield* installPolicyFixture();
					expect(
						yield* writeRelationship(
							"upsert",
							policyInput,
							command("invalid-transform"),
							yield* changeSetsWith(
								yield* policyLifecycle(
									Effect.succeed({
										action: "transform" as const,
										patch: {
											resource: "relationship" as const,
											draft: { properties: { remove: [], set: { rank: "invalid" } } },
										},
									}),
								),
							),
						).pipe(Effect.flip),
					).toMatchObject({ reason: { paths: [["rank"]], code: "invalid-properties" } });
					expect(yield* session.run((db) => db.select().from(tables.relationship))).toEqual([]);
				}),
			testTimeout,
		);
	});

	layer(relationshipChangeSetsLayer())("relationship mutation harness", (test) => {
		test.effect(
			"stands an ensure of the relationship an earlier write of its change set creates",
			() =>
				Effect.gen(function* () {
					const write = {
						properties: { rank: 1 },
						relationshipSchema: baseInput.relationshipSchema,
						source: { kind: "existing" as const, entityId: baseInput.sourceEntityId },
						target: { kind: "existing" as const, entityId: baseInput.targetEntityId },
					};
					const committed = yield* (yield* ChangeSets).commit(
						{
							userId,
							relationships: {
								ensures: [{ ...write, itemIdentity: "ensure" }],
								upserts: [{ ...write, itemIdentity: "upsert", propertiesMode: "replace" }],
							},
						},
						command("upsert-then-ensure"),
					);
					const [created, ensured] = committed.relationships;
					assert(created?.relationship);
					expect(created).toMatchObject({ operation: "create", itemIdentity: "upsert" });
					expect(ensured).toMatchObject({
						operation: "noop",
						itemIdentity: "ensure",
						relationship: { wasInserted: false, id: created.relationship.id },
					});
				}),
			testTimeout,
		);
	});
});
