import { describe, expect } from "bun:test";

import { DbError } from "@ryot-app/contract/errors";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { RelationshipBadRequest } from "@ryot-app/contract/modules/relationships/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { insertManagedAsset } from "#lib/domain/managed-asset-writes.test-support";
import {
	decidingPolicies,
	policyFixture,
	withLifecycleBatchPlanning,
	withLifecycleDispatch,
} from "#modules/automations/lifecycle.test-support";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecyclePlanner } from "#modules/automations/lifecycle/planning";
import { LifecyclePolicies } from "#modules/automations/lifecycle/policies";
import { ChangeSets } from "#modules/changes/service";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import {
	baseInput,
	changeSetsWith,
	command,
	deleteRelationshipById,
	installPolicyFixture,
	ownedEndpoints,
	persistPrepared,
	propertiesSchema,
	relationshipChangeSetsLayer,
	RelationshipFixture,
	relationshipSchemaSlug,
	sourceEntityId,
	targetEntityId,
	userId,
	writeRelationship,
} from "./lifecycle.test-support";
import { RelationshipsRepository } from "./repository";
import { RelationshipsService } from "./service";

const between = (source: EntityId, target: EntityId) => ({
	...baseInput,
	sourceEntityId: source,
	targetEntityId: target,
});

const selfGroup = (slug: string, entityIds: ReadonlyArray<EntityId>) => ({
	relationshipSchema: baseInput.relationshipSchema,
	selector: {
		type: "self" as const,
		entitySchema: { slug: EntitySchemaSlug.make(slug), owner: { kind: "kernel" as const } },
	},
	relationships: entityIds.map((entityId) => ({
		properties: { rank: 1 },
		sourceEntityId: entityId,
		targetEntityId: entityId,
	})),
});

describe("Relationships lifecycle owner", () => {
	layer(relationshipChangeSetsLayer())("uses the active relationship schema", (test) => {
		test.effect(
			"uses the active relationship schema",
			() =>
				Effect.gen(function* () {
					expect(
						yield* writeRelationship(
							"upsert",
							{ ...baseInput, properties: { rank: "invalid" } },
							command("active-schema"),
						).pipe(Effect.flip),
					).toMatchObject({ reason: { code: "invalid-properties" } });
				}),
			testTimeout,
		);
	});

	layer(relationshipChangeSetsLayer())(
		"commits a no-hook relationship without a policy round",
		(test) => {
			test.effect(
				"commits a no-hook relationship without a policy round",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const fast = yield* writeRelationship("upsert", baseInput, command("step-fast"));
						expect(fast).toMatchObject({
							operation: "create",
							relationship: { wasInserted: true },
						});
						expect(yield* session.run((db) => db.select().from(tables.relationship))).toHaveLength(
							1,
						);
						expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual(
							[],
						);
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer())(
		"preserves relationship metadata on repeated ensure",
		(test) => {
			test.effect(
				"preserves relationship metadata on repeated ensure",
				() =>
					Effect.gen(function* () {
						const existingProperties = { rank: 1, labels: ["saved"] };
						const created = yield* writeRelationship(
							"ensure",
							{ ...baseInput, properties: existingProperties },
							command("ensure-initial"),
						);
						expect(created.operation).toBe("create");

						const repeated = yield* writeRelationship(
							"ensure",
							{ ...baseInput, properties: { rank: 2, labels: ["incoming"] } },
							command("ensure-repeated"),
						);
						expect(repeated).toMatchObject({
							operation: "noop",
							relationship: { properties: existingProperties },
						});
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer())(
		"rejects a foreign qualified relationship schema",
		(test) => {
			test.effect(
				"rejects a foreign qualified relationship schema",
				() =>
					Effect.gen(function* () {
						expect(
							yield* writeRelationship(
								"upsert",
								{
									...baseInput,
									relationshipSchema: {
										slug: relationshipSchemaSlug,
										owner: definitionOwner("stale-plugin"),
									},
								},
								command("stale-plugin"),
							).pipe(Effect.flip),
						).toMatchObject({ reason: { code: "relationship-schema-not-found" } });
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer({ omitSchemaBeforeWrite: true }))(
		"rejects a disabled or missing relationship definition before lifecycle planning",
		(test) => {
			test.effect(
				"rejects a disabled or missing relationship definition before lifecycle planning",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						expect(
							yield* writeRelationship("upsert", baseInput, command("missing-schema")).pipe(
								Effect.flip,
							),
						).toMatchObject({ reason: { code: "relationship-schema-not-found" } });
						expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual(
							[],
						);
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer({ activateSchemaOnWrite: true }))(
		"revalidates the relationship schema under the catalog lock before writing",
		(test) => {
			test.effect(
				"revalidates the relationship schema under the catalog lock before writing",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						expect(
							yield* writeRelationship("upsert", baseInput, command("schema-race")).pipe(
								Effect.flip,
							),
						).toEqual(
							new RelationshipBadRequest({ reason: { code: "concurrent-relationship-change" } }),
						);
						expect(yield* session.run((db) => db.select().from(tables.relationship))).toEqual([]);
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer({ mutableRelationshipSchema: true }))(
		"loads only requested global schemas for planned reconciliation",
		(test) => {
			test.effect(
				"loads only requested global schemas for planned reconciliation",
				() =>
					Effect.gen(function* () {
						const fixture = yield* RelationshipFixture;
						const service = yield* RelationshipsService;
						const session = yield* DatabaseSession;
						yield* session.transaction(
							service.persistPlannedReconciliation(
								[
									{
										relationshipSchema: baseInput.relationshipSchema,
										relationships: [
											{ sourceEntityId, properties: { rank: 1 }, targetEntityId: sourceEntityId },
										],
										selector: {
											type: "self",
											entitySchema: {
												owner: { kind: "kernel" },
												slug: EntitySchemaSlug.make("fixture"),
											},
										},
									},
								],
								command("planned-global-schema"),
								{ scope: "global" },
							),
						);
						expect(yield* fixture.globalRelationshipSchemaCalls).toEqual([
							[relationshipSchemaSlug],
						]);
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer())(
		"replaces only the self relationships of the selector's entity schema",
		(test) => {
			test.effect(
				"replaces only the self relationships of the selector's entity schema",
				() =>
					Effect.gen(function* () {
						const service = yield* RelationshipsService;
						const session = yield* DatabaseSession;
						const otherEntityId = EntityId.make("relationship-other");
						yield* session.run((db) =>
							db
								.insert(tables.entity)
								.values({
									name: "Other",
									properties: {},
									id: otherEntityId,
									entitySchemaSlug: "other",
								}),
						);
						const reconcile = (group: ReturnType<typeof selfGroup>, id: string) =>
							session.transaction(
								service.persistPlannedReconciliation([group], command(id), { scope: "global" }),
							);
						yield* reconcile(selfGroup("other", [otherEntityId]), "self-other");
						yield* reconcile(selfGroup("fixture", [sourceEntityId]), "self-fixture");
						yield* reconcile(selfGroup("fixture", []), "self-fixture-cleared");
						expect(
							yield* session.run((db) =>
								db
									.select({ sourceEntityId: tables.relationship.sourceEntityId })
									.from(tables.relationship),
							),
						).toEqual([{ sourceEntityId: otherEntityId }]);
						assertExitFails(
							yield* Effect.exit(reconcile(selfGroup("fixture", [otherEntityId]), "self-mismatch")),
							new RelationshipBadRequest({ reason: { code: "reconciliation-selector-mismatch" } }),
						);
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer())(
		"replays no-hook merge, update, and delete by ID without automation history",
		(test) => {
			test.effect(
				"replays no-hook merge, update, and delete by ID without automation history",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const input = { ...baseInput, properties: { rank: 1, labels: ["a"] } };
						const created = yield* writeRelationship("merge", input, command("merge-create"));
						assert(created.relationship);
						const merged = yield* writeRelationship(
							"merge",
							{ ...input, properties: { labels: ["a", "b"] } },
							command("merge-update"),
						);
						expect(merged).toMatchObject({
							operation: "update",
							relationship: {
								wasInserted: false,
								id: created.relationship.id,
								properties: { rank: 1, labels: ["a", "b"] },
							},
						});
						const replayed = yield* writeRelationship(
							"merge",
							{ ...input, properties: { labels: ["a", "b"] } },
							command("merge-update"),
						);
						expect(replayed.operation).toBe("noop");
						expect(replayed.relationship).toEqual(merged.relationship);
						yield* writeRelationship(
							"merge",
							{ ...input, properties: { labels: ["a", "b"] } },
							command("merge-noop"),
						);
						expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual(
							[],
						);
						const updated = yield* writeRelationship(
							"update",
							{ ...input, properties: { rank: 3, labels: ["b"] } },
							command("explicit-update"),
						);
						yield* session.run((db) =>
							db
								.insert(tables.user)
								.values({
									name: "Other",
									id: "other-owner",
									email: "other-relationship-owner@example.test",
								}),
						);
						expect(
							yield* deleteRelationshipById(
								UserId.make("other-owner"),
								created.relationship.id,
								command("foreign-delete", UserId.make("other-owner")),
							),
						).toMatchObject({ operation: "noop", relationship: null });
						const deleted = yield* deleteRelationshipById(
							userId,
							created.relationship.id,
							command("delete-id"),
						);
						expect(deleted).toEqual({ ...updated, operation: "delete" });
						const [relationships, triggers] = yield* session.run((db) =>
							Effect.all([
								db.select().from(tables.relationship),
								db.select().from(tables.automationTrigger),
							]),
						);
						expect(relationships).toEqual([]);
						const changes = triggers.filter(({ category }) => category === "change");
						expect(changes).toEqual([]);
					}),
				testTimeout,
			);
		},
	);
	layer(relationshipChangeSetsLayer())(
		"rejects nested transaction entry before planning or source writes",
		(test) => {
			test.effect(
				"rejects nested transaction entry before planning or source writes",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const exit = yield* Effect.exit(
							session.transaction(writeRelationship("upsert", baseInput, command("nested-entry"))),
						);
						assertExitFails(
							exit,
							new DbError({
								message: "Relationship lifecycle mutations require a root transaction boundary",
							}),
						);
						const [relationships, triggers] = yield* session.run((db) =>
							Effect.all([
								db.select().from(tables.relationship),
								db.select().from(tables.automationTrigger),
							]),
						);
						expect(relationships).toEqual([]);
						expect(triggers).toEqual([]);
					}),
				testTimeout,
			);
		},
	);
	layer(relationshipChangeSetsLayer())(
		"commits pinned runs with their source, rolling all three back on failure",
		(test) => {
			test.effect(
				"commits pinned runs with their source, rolling all three back on failure",
				() =>
					Effect.gen(function* () {
						const { observer, runLimitedPlanner } = yield* RelationshipFixture;
						const session = yield* DatabaseSession;
						const planner = yield* LifecyclePlanner;
						const fixture = revisionPackage("relationship-hooks", "v1", "fixture");
						const target = fixture.manifest.relationshipSchemas[0];
						assert(target);
						const installed = yield* installRevisionPackage(
							{
								...fixture,
								manifest: {
									...fixture.manifest,
									relationshipSchemas: [{ ...target, propertiesSchema }],
									hooks: [
										...fixture.manifest.hooks,
										{
											stage: "after",
											slug: "required",
											name: "Required",
											scriptSlug: "relationship-hooks.automation",
											targets: [
												{
													operation: "create",
													resource: "relationship",
													relationshipSchemaSlug: target.slug,
												},
											],
										},
										{
											slug: "async",
											name: "Async",
											stage: "after",
											scriptSlug: "relationship-hooks.automation",
											targets: [
												{
													operation: "create",
													resource: "relationship",
													relationshipSchemaSlug: target.slug,
												},
											],
										},
									],
								},
							},
							userId,
						);
						const input = {
							...baseInput,
							...(yield* ownedEndpoints(installed, "fixture", "user")),
							relationshipSchemaPluginId: installed.pluginId,
							relationshipSchemaSlug: RelationshipSchemaSlug.make(target.slug),
							relationshipSchema: {
								owner: definitionOwner(installed.pluginId),
								slug: RelationshipSchemaSlug.make(target.slug),
							},
						};
						const failed = yield* Effect.exit(
							writeRelationship(
								"upsert",
								input,
								command("runs"),
								yield* changeSetsWith({
									planner: withLifecycleBatchPlanning({
										plan: (value) =>
											Effect.gen(function* () {
												const plan = yield* planner.plan(value);
												if (value.trigger.kind.category === "change") {
													expect(plan.runs.map(({ hookSlug }) => hookSlug).sort()).toEqual<unknown>(
														["async", "required"],
													);
													return yield* new DbError({ message: "Fail after run insertion" });
												}
												return plan;
											}),
									}),
								}),
							),
						);
						assertExitFails(failed, new DbError({ message: "Fail after run insertion" }));
						const execution = yield* LifecycleExecution;
						const [rolledBackRelationships, rolledBackRuns] = yield* session.run((db) =>
							Effect.all([
								db.select().from(tables.relationship),
								db.select().from(tables.automationRun),
							]),
						);
						expect(rolledBackRelationships).toEqual([]);
						expect(rolledBackRuns).toEqual([]);
						const runCounts: number[] = [];
						yield* writeRelationship(
							"upsert",
							input,
							command("runs"),
							yield* changeSetsWith({
								execution: withLifecycleDispatch({
									...execution,
									after: ({ runs, triggerId }) =>
										Effect.gen(function* () {
											runCounts.push(runs.length);
											if (runs.length === 0) {
												return;
											}
											const rows = yield* Effect.promise(() =>
												observer.query(
													"select plugin_revision_id as revision from automation_run where trigger_id = $1",
													[triggerId],
												),
											);
											expect(rows.rows).toEqual([
												{ revision: installed.revisionId },
												{ revision: installed.revisionId },
											]);
										}),
								}),
							}),
						);
						expect(runCounts).toEqual([2]);
						const [relationships, runs] = yield* session.run((db) =>
							Effect.all([
								db.select().from(tables.relationship),
								db.select().from(tables.automationRun),
							]),
						);
						expect(relationships).toHaveLength(1);
						expect(runs).toHaveLength(2);
						const limitedCommand = command("limited");
						const limited = yield* writeRelationship(
							"upsert",
							{
								...input,
								sourceEntityId: input.targetEntityId,
								targetEntityId: input.sourceEntityId,
							},
							{ ...limitedCommand, causation: { ...limitedCommand.causation, depth: 1 } },
							yield* changeSetsWith({ planner: runLimitedPlanner }),
						);
						const blocked = (yield* session.run((db) =>
							db.select().from(tables.automationTrigger),
						)).find(({ blockedReason }) => blockedReason !== null);
						assert(blocked);
						expect(limited.relationship?.wasInserted).toBe(true);
						expect(blocked.blockedReason).toEqual<unknown>({
							code: "automation-limit-reached",
							omittedHooks: [
								{ hookSlug: "async", pluginId: installed.pluginId },
								{ hookSlug: "required", pluginId: installed.pluginId },
							],
						});
						const [limitedRelationships, limitedRuns] = yield* session.run((db) =>
							Effect.all([
								db.select().from(tables.relationship),
								db.select().from(tables.automationRun),
							]),
						);
						expect(limitedRelationships).toHaveLength(2);
						expect(limitedRuns).toHaveLength(2);
					}),
				testTimeout,
			);
		},
	);
	layer(relationshipChangeSetsLayer())(
		"does not dispatch no-hook writes and rejects a nested transaction",
		(test) => {
			test.effect(
				"does not dispatch no-hook writes and rejects a nested transaction",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						yield* writeRelationship("upsert", baseInput, command("commit"));
						expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual(
							[],
						);
						const nested = yield* Effect.exit(
							session.transaction(writeRelationship("delete", baseInput, command("nested"))),
						);
						assertExitFails(
							nested,
							new DbError({
								message: "Relationship lifecycle mutations require a root transaction boundary",
							}),
						);
						expect(yield* session.run((db) => db.select().from(tables.relationship))).toHaveLength(
							1,
						);
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer())(
		"chains policy drafts, preserves trusted identity, and validates final properties outside transactions",
		(test) => {
			test.effect(
				"chains policy drafts, preserves trusted identity, and validates final properties outside transactions",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const policyInput = yield* installPolicyFixture();
						const seen: unknown[] = [];
						const targets = [
							{
								operation: "create" as const,
								resource: "relationship" as const,
								relationshipSchemaSlug: policyInput.relationshipSchemaSlug,
							},
						];
						const result = yield* writeRelationship(
							"upsert",
							policyInput,
							command("policies"),
							yield* changeSetsWith({
								policies: decidingPolicies(
									() => Effect.succeed([policyFixture(1, targets), policyFixture(2, targets)]),
									(item, policy) =>
										Effect.gen(function* () {
											expect(!(yield* session.isTransactionActive)).toBe(true);
											seen.push(item.request.draft.properties);
											return {
												action: "transform" as const,
												patch: {
													resource: "relationship" as const,
													draft: { properties: { remove: [], set: { rank: policy.position + 1 } } },
												},
											};
										}),
								),
							}),
						);
						expect(seen).toEqual([{ rank: 1 }, { rank: 2 }]);
						expect(result.relationship).toMatchObject({
							properties: { rank: 3 },
							sourceEntityId: policyInput.sourceEntityId,
							targetEntityId: policyInput.targetEntityId,
						});
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer())(
		"detects writes made during policy execution without overwriting them",
		(test) => {
			test.effect(
				"detects writes made during policy execution without overwriting them",
				() =>
					Effect.gen(function* () {
						const repository = yield* RelationshipsRepository;
						const policyInput = yield* installPolicyFixture();
						const created = yield* repository.createRelationship({
							...policyInput,
							properties: { rank: 1 },
						});
						const exit = yield* Effect.exit(
							writeRelationship(
								"update",
								{ ...policyInput, properties: { rank: 2 } },
								command("stale"),
								yield* changeSetsWith({
									policies: decidingPolicies((yield* LifecyclePolicies).match, () =>
										repository
											.updateRelationshipsById([{ id: created.id, properties: { rank: 9 } }])
											.pipe(Effect.as({ action: "allow" as const }), Effect.orDie),
									),
								}),
							),
						);
						assertExitFails(
							exit,
							new RelationshipBadRequest({ reason: { code: "concurrent-relationship-change" } }),
						);
						expect((yield* repository.findRelationship(policyInput))?.properties).toEqual({
							rank: 9,
						});
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer())(
		"writes nothing on policy rejection or invalid transforms",
		(test) => {
			test.effect(
				"writes nothing on policy rejection or invalid transforms",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const policyInput = yield* installPolicyFixture();
						const policies = yield* LifecyclePolicies;
						for (const mode of ["reject", "invalid"] as const) {
							const exit = yield* Effect.exit(
								writeRelationship(
									"upsert",
									policyInput,
									command(mode),
									yield* changeSetsWith({
										policies: decidingPolicies(policies.match, () =>
											Effect.succeed(
												mode === "reject"
													? { action: "reject" as const, reason: { key: "rejection.rejected" } }
													: {
															action: "transform" as const,
															patch: {
																resource: "relationship" as const,
																draft: { properties: { remove: [], set: { rank: "invalid" } } },
															},
														},
											),
										),
									}),
								),
							);
							switch (mode) {
								case "reject":
									assertExitFails(
										exit,
										new RelationshipBadRequest({
											reason: {
												code: "policy-rejected",
												message: {
													key: "rejection.rejected",
													namespace: policyInput.relationshipSchemaPluginId,
												},
											},
										}),
									);
									break;
								case "invalid":
									assertExitFails(
										exit,
										new RelationshipBadRequest({
											reason: { paths: [["rank"]], code: "invalid-properties" },
										}),
									);
									break;
							}
						}
						expect(yield* session.run((db) => db.select().from(tables.relationship))).toEqual([]);
						expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual(
							[],
						);
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer())(
		"requires an active transaction and persists reconciliation without planning before policies",
		(test) => {
			test.effect(
				"requires an active transaction and persists reconciliation without planning before policies",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const service = yield* RelationshipsService;
						yield* session.run((db) =>
							db
								.insert(tables.user)
								.values({
									id: "owner",
									name: "Plugin owner",
									email: "global-policy-owner@example.test",
								}),
						);
						const globalPolicyInput = yield* installPolicyFixture(null);
						const groups = [
							{
								relationshipSchema: globalPolicyInput.relationshipSchema,
								selector: {
									type: "anchored" as const,
									direction: "outgoing" as const,
									anchorEntityId: globalPolicyInput.sourceEntityId,
								},
								relationships: [
									{
										properties: { rank: 1 },
										sourceEntityId: globalPolicyInput.sourceEntityId,
										targetEntityId: globalPolicyInput.targetEntityId,
									},
								],
							},
						];
						expect(
							yield* service
								.persistPlannedReconciliation(groups, command("outside"), { scope: "global" })
								.pipe(Effect.flip),
						).toMatchObject({ code: "active-transaction-required" });
						const reconciled = yield* session.transaction(
							service.persistPlannedReconciliation(groups, command("policy"), { scope: "global" }),
						);
						expect(reconciled.result).toEqual([
							{ created: 1, updated: 0, deleted: 0, upserted: 1 },
						]);
						const [relationships, triggers] = yield* session.run((db) =>
							Effect.all([
								db.select({ properties: tables.relationship.properties }).from(tables.relationship),
								db
									.select({ category: tables.automationTrigger.category })
									.from(tables.automationTrigger),
							]),
						);
						expect(relationships).toEqual([{ properties: { rank: 1 } }]);
						expect(triggers.filter(({ category }) => category === "request")).toEqual([]);
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer())(
		"commits provider entities, relationships, triggers, and runs in one change set",
		(test) => {
			test.effect(
				"commits provider entities, relationships, triggers, and runs in one change set",
				() =>
					Effect.gen(function* () {
						const { observer } = yield* RelationshipFixture;
						const session = yield* DatabaseSession;
						const changeSets = yield* ChangeSets;
						const providerId = SandboxProviderId.make("group-provider");
						const groupRelationshipSchemaSlug = RelationshipSchemaSlug.make("group-link");
						const fixture = revisionPackage("group-lifecycle", "v1", "group-fixture");
						const automation = fixture.manifest.scripts.find(
							(script) => script.kind === "automation",
						);
						assert(automation?.kind === "automation");
						yield* session.run((db) =>
							db
								.insert(tables.user)
								.values({ id: "owner", name: "Plugin owner", email: "plugin-owner@example.test" }),
						);
						const installed = yield* installRevisionPackage({
							...fixture,
							manifest: {
								...fixture.manifest,
								relationshipSchemas: fixture.manifest.relationshipSchemas.map((schema) => ({
									...schema,
									propertiesSchema,
									sourceEntitySchemaSlug: null,
									targetEntitySchemaSlug: null,
									slug: groupRelationshipSchemaSlug,
								})),
								hooks: [
									...fixture.manifest.hooks,
									{
										stage: "after",
										name: "Group lifecycle",
										scriptSlug: automation.slug,
										slug: "group-lifecycle.after",
										targets: [
											{
												resource: "entity",
												operation: "create",
												entitySchemaSlug: "group-fixture",
											},
											{
												operation: "create",
												resource: "relationship",
												relationshipSchemaSlug: groupRelationshipSchemaSlug,
											},
										],
									},
								],
							},
						});
						const { sourceEntityId: ownedSourceEntityId } = yield* ownedEndpoints(
							installed,
							"group-fixture",
							"global",
						);
						const baselineEntityIds = (yield* session.run((db) =>
							db.select({ id: tables.entity.id }).from(tables.entity),
						))
							.map(({ id }) => id)
							.sort();
						yield* session.run((db) =>
							db
								.insert(tables.sandboxProvider)
								.values({
									id: providerId,
									slug: "group-provider",
									pluginId: installed.pluginId,
									information: { source: "fixture" },
									rootEntitySchemaSlug: "group-fixture",
									name: { key: "test.group-provider", namespace: installed.pluginId },
								}),
						);

						const entitySchema = {
							owner: definitionOwner(installed.pluginId),
							slug: EntitySchemaSlug.make("group-fixture"),
						};
						const source = { kind: "existing" as const, entityId: ownedSourceEntityId };
						const persistGroup = (id: string, rank: unknown) =>
							changeSets.commit(
								{
									userId: null,
									globalEntities: [
										{
											entitySchema,
											externalId: id,
											populatedAt: null,
											name: `Provider ${id}`,
											properties: { title: id },
											provider: { providerId, updateExisting: true },
										},
									],
									globalRelationships: [
										{
											selector: { anchor: source, type: "anchored", direction: "outgoing" },
											relationshipSchema: {
												slug: groupRelationshipSchemaSlug,
												owner: definitionOwner(installed.pluginId),
											},
											relationships: [
												{
													source,
													properties: { rank },
													target: { providerId, entitySchema, externalId: id, kind: "upserted" },
												},
											],
										},
									],
								},
								command(id),
							);

						expect(yield* persistGroup("rollback", "first").pipe(Effect.flip)).toMatchObject({
							reason: { code: "invalid-properties" },
						});
						const [
							relationshipsAfterRollback,
							triggersAfterRollback,
							runsAfterRollback,
							entityRows,
						] = yield* session.run((db) =>
							Effect.all([
								db.select().from(tables.relationship),
								db.select().from(tables.automationTrigger),
								db.select().from(tables.automationRun),
								db.select().from(tables.entity),
							]),
						);
						expect(relationshipsAfterRollback).toEqual([]);
						expect(triggersAfterRollback).toEqual([]);
						expect(runsAfterRollback).toEqual([]);
						expect(entityRows.map(({ id }) => id).sort()).toEqual(baselineEntityIds);

						yield* persistGroup("commit", 1);
						const visible = yield* Effect.tryPromise({
							catch: () => new DbError({ message: "Observer failed" }),
							try: () =>
								observer.query(
									"select (select count(*)::int from entity) as entities, (select count(*)::int from relationship) as relationships, (select count(*)::int from automation_trigger) as triggers, (select count(*)::int from automation_run) as runs",
								),
						});
						expect(visible.rows).toEqual([
							{ runs: 2, triggers: 2, relationships: 1, entities: baselineEntityIds.length + 1 },
						]);
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer())(
		"reconciles private user relationships atomically without crossing owners",
		(test) => {
			test.effect(
				"reconciles private user relationships atomically without crossing owners",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const repository = yield* RelationshipsRepository;
						const relationships = yield* RelationshipsService;
						const otherUserId = UserId.make("other-relationship-owner");
						const foreignEntityId = EntityId.make("foreign-user-entity");
						const privateSchemaSlug = RelationshipSchemaSlug.make("private-reconciliation-link");
						yield* session.run((db) =>
							db
								.insert(tables.user)
								.values({
									id: otherUserId,
									name: "Other owner",
									email: "other-relationship@example.test",
								}),
						);
						yield* session.run((db) =>
							db
								.insert(tables.entity)
								.values({
									properties: {},
									userId: otherUserId,
									id: foreignEntityId,
									name: "Foreign entity",
									entitySchemaSlug: "fixture",
								}),
						);
						const fixture = revisionPackage("private-reconciliation", "v1", "fixture");
						const automation = fixture.manifest.scripts.find(
							(script) => script.kind === "automation",
						);
						assert(automation?.kind === "automation");
						const installed = yield* installRevisionPackage(
							{
								...fixture,
								manifest: {
									...fixture.manifest,
									relationshipSchemas: fixture.manifest.relationshipSchemas.map((schema) => ({
										...schema,
										slug: privateSchemaSlug,
										sourceEntitySchemaSlug: null,
										targetEntitySchemaSlug: null,
									})),
									hooks: [
										...fixture.manifest.hooks,
										{
											stage: "after",
											scriptSlug: automation.slug,
											name: "Private reconciliation",
											slug: "private-reconciliation.after",
											targets: [
												{
													operation: "create",
													resource: "relationship",
													relationshipSchemaSlug: privateSchemaSlug,
												},
											],
										},
									],
								},
							},
							userId,
						);
						const { sourceEntityId: ownedSourceEntityId, targetEntityId: ownedTargetEntityId } =
							yield* ownedEndpoints(installed, "fixture", "user");
						const group = {
							relationshipSchema: {
								slug: privateSchemaSlug,
								owner: definitionOwner(installed.pluginId),
							},
							selector: {
								type: "anchored" as const,
								direction: "outgoing" as const,
								anchorEntityId: ownedSourceEntityId,
							},
							relationships: [
								{
									properties: {},
									sourceEntityId: ownedSourceEntityId,
									targetEntityId: ownedTargetEntityId,
								},
							],
						};
						yield* repository.createRelationship({
							scope: "user",
							properties: {},
							userId: otherUserId,
							sourceEntityId: ownedSourceEntityId,
							targetEntityId: ownedTargetEntityId,
							relationshipSchemaSlug: privateSchemaSlug,
							relationshipSchemaPluginId: installed.pluginId,
						});

						const rollback = yield* session
							.transaction(
								session.run((tx) =>
									Effect.gen(function* () {
										yield* relationships.persistPlannedReconciliation(
											[group],
											command("private-rollback"),
											{ userId, scope: "user" },
										);
										expect(yield* tx.select().from(tables.automationTrigger)).toHaveLength(1);
										expect(yield* tx.select().from(tables.automationRun)).toHaveLength(1);
										return yield* new DbError({ message: "Rollback private reconciliation" });
									}),
								),
							)
							.pipe(Effect.flip);
						expect(rollback).toMatchObject({ message: "Rollback private reconciliation" });
						const [rolledBackTriggers, rolledBackRuns, retainedRelationships] = yield* session.run(
							(db) =>
								Effect.all([
									db.select().from(tables.automationTrigger),
									db.select().from(tables.automationRun),
									db.select().from(tables.relationship),
								]),
						);
						expect(rolledBackTriggers).toEqual([]);
						expect(rolledBackRuns).toEqual([]);
						expect(
							retainedRelationships.map(({ userId: relationshipUserId }) => relationshipUserId),
						).toEqual([otherUserId]);

						const inaccessible = yield* session
							.transaction(
								relationships.persistPlannedReconciliation(
									[
										{
											...group,
											relationships: [
												{
													properties: {},
													targetEntityId: foreignEntityId,
													sourceEntityId: ownedSourceEntityId,
												},
											],
										},
									],
									command("private-foreign-entity"),
									{ userId, scope: "user" },
								),
							)
							.pipe(Effect.flip);
						expect(inaccessible).toMatchObject({ reason: { code: "entity-not-found" } });

						const work = yield* session.transaction(
							relationships.persistPlannedReconciliation([group], command("private-commit"), {
								userId,
								scope: "user",
							}),
						);
						expect(work.result).toEqual([{ created: 1, updated: 0, deleted: 0, upserted: 1 }]);
						const triggers = yield* session.run((db) =>
							db
								.select({
									id: tables.automationTrigger.id,
									operation: tables.automationTrigger.operation,
								})
								.from(tables.automationTrigger),
						);
						expect(
							work.dispatch.map(
								({ triggerId }) => triggers.find(({ id }) => id === triggerId)?.operation,
							),
						).toEqual(["create"]);
						expect(
							(yield* session.run((db) => db.select().from(tables.automationTrigger))).map(
								({ scopeUserId }) => scopeUserId,
							),
						).toEqual([userId]);
						expect(
							(yield* session.run((db) => db.select().from(tables.automationRun))).map(
								({ executionUserId }) => executionUserId,
							),
						).toEqual([userId]);
						const foreignOwner = yield* session
							.transaction(
								relationships.persistPlannedReconciliation(
									[group],
									command("private-other-owner", otherUserId),
									{ scope: "user", userId: otherUserId },
								),
							)
							.pipe(Effect.flip);
						expect(foreignOwner).toMatchObject({
							reason: { code: "relationship-schema-not-found" },
						});

						expect(
							yield* session.transaction(
								relationships.persistPlannedReconciliation(
									[{ ...group, relationships: [] }],
									command("private-delete"),
									{ userId, scope: "user" },
								),
							),
						).toMatchObject({ result: [{ created: 0, updated: 0, deleted: 1, upserted: 0 }] });
						expect(
							(yield* session.run((db) => db.select().from(tables.relationship))).map(
								({ userId: relationshipUserId }) => relationshipUserId,
							),
						).toEqual([otherUserId]);
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer())(
		"keeps prepared user relationship changes in the caller transaction and rejects them by policy",
		(test) => {
			test.effect(
				"keeps prepared user relationship changes in the caller transaction and rejects them by policy",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const service = yield* RelationshipsService;
						const repository = yield* RelationshipsRepository;

						const created = yield* repository.createRelationship(baseInput);
						const stale = yield* service.prepareUserDelete(baseInput, command("prepared-stale"));
						yield* repository.updateRelationshipsById([
							{ id: created.id, properties: { rank: 9 } },
						]);
						expect(yield* persistPrepared(stale).pipe(Effect.flip)).toMatchObject({
							reason: { code: "concurrent-relationship-change" },
						});

						const deletionInput = { ...baseInput, sourceEntityId, targetEntityId: sourceEntityId };
						const createInput = {
							...baseInput,
							sourceEntityId: targetEntityId,
							targetEntityId: sourceEntityId,
						};
						yield* repository.createRelationship(deletionInput);
						const deletion = yield* service.prepareUserDelete(
							deletionInput,
							command("prepared-delete"),
						);
						const creation = yield* service.prepareUserWrite(
							createInput,
							command("prepared-create"),
							"upsert",
						);
						expect(yield* service.persistPrepared(creation).pipe(Effect.flip)).toMatchObject({
							code: "active-transaction-required",
						});
						expect(
							yield* session
								.transaction(
									session.run((tx) =>
										Effect.gen(function* () {
											yield* service.persistPrepared(deletion);
											yield* service.persistPrepared(creation);
											const changes = (yield* tx.select().from(tables.automationTrigger)).filter(
												({ category }) => category === "change",
											);
											expect(changes).toEqual([]);
											return yield* new DbError({ message: "Rollback prepared relationships" });
										}),
									),
								)
								.pipe(Effect.flip),
						).toMatchObject({ message: "Rollback prepared relationships" });
						expect(yield* repository.findRelationship(deletionInput)).not.toBeNull();
						expect(yield* repository.findRelationship(createInput)).toBeNull();
						expect(
							(yield* session.run((db) => db.select().from(tables.automationTrigger))).filter(
								({ category }) => category === "change",
							),
						).toEqual([]);

						const [work] = yield* persistPrepared(creation);
						expect(work?.dispatch).toEqual([]);

						const rejectedInput = yield* installPolicyFixture();
						yield* repository.createRelationship(rejectedInput);
						const rejecting = yield* changeSetsWith({
							policies: decidingPolicies((yield* LifecyclePolicies).match, () =>
								Effect.gen(function* () {
									expect(!(yield* session.isTransactionActive)).toBe(true);
									return { action: "reject" as const, reason: { key: "rejection.rejected" } };
								}),
							),
						});
						const rejected = yield* writeRelationship(
							"delete",
							rejectedInput,
							command("prepared-rejected"),
							rejecting,
						).pipe(Effect.flip);
						expect(rejected).toMatchObject({ reason: { code: "policy-rejected" } });
						expect(yield* repository.findRelationship(rejectedInput)).not.toBeNull();
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer())(
		"skips policies for unchanged writes and retains updates transformed back to source properties",
		(test) => {
			test.effect(
				"skips policies for unchanged writes and retains updates transformed back to source properties",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const repository = yield* RelationshipsRepository;
						const input = yield* installPolicyFixture();
						yield* repository.createRelationship(input);
						let policyCalls = 0;
						const changeSets = yield* changeSetsWith({
							policies: decidingPolicies((yield* LifecyclePolicies).match, () =>
								Effect.gen(function* () {
									expect(yield* session.isTransactionActive).toBe(false);
									policyCalls += 1;
									return {
										action: "transform" as const,
										patch: {
											resource: "relationship" as const,
											draft: { properties: { remove: [], set: { rank: 1 } } },
										},
									};
								}),
							),
						});
						expect(
							yield* writeRelationship(
								"upsert",
								input,
								command("prepared-initial-noop"),
								changeSets,
							),
						).toMatchObject({ operation: "noop" });
						expect(policyCalls).toBe(0);
						const written = yield* writeRelationship(
							"upsert",
							{ ...input, properties: { rank: 2 } },
							command("prepared-policy-noop"),
							changeSets,
						);
						expect(policyCalls).toBe(1);
						expect(written.relationship?.properties).toEqual({ rank: 1 });
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer())(
		"rejects another user's managed asset on relationship writes",
		(test) => {
			test.effect(
				"rejects another user's managed asset on relationship writes",
				() =>
					Effect.gen(function* () {
						const foreign = yield* insertManagedAsset(UserId.make("relationship-asset-foreign"));
						assertExitFails(
							yield* Effect.exit(
								writeRelationship(
									"upsert",
									{ ...baseInput, properties: { rank: 1, image: foreign } },
									command("foreign-asset-single"),
								),
							),
							new RelationshipBadRequest({ reason: { code: "asset-forbidden" } }),
						);
					}),
				testTimeout,
			);

			test.effect(
				"rejects the owner's own managed asset on a global relationship",
				() =>
					Effect.gen(function* () {
						const service = yield* RelationshipsService;
						const session = yield* DatabaseSession;
						const own = yield* insertManagedAsset(userId);
						assertExitFails(
							yield* Effect.exit(
								session.transaction(
									service.persistPlannedReconciliation(
										[
											{
												relationshipSchema: baseInput.relationshipSchema,
												relationships: [
													{
														sourceEntityId,
														targetEntityId: sourceEntityId,
														properties: { rank: 1, image: own },
													},
												],
												selector: {
													type: "self",
													entitySchema: {
														owner: { kind: "kernel" },
														slug: EntitySchemaSlug.make("fixture"),
													},
												},
											},
										],
										command("global-own-asset"),
										{ scope: "global" },
									),
								),
							),
							new RelationshipBadRequest({ reason: { code: "asset-forbidden" } }),
						);
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer())(
		"commits every relationship mode of a kernel writer in one change set",
		(test) => {
			test.effect(
				"commits every relationship mode of a kernel writer in one change set",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const repository = yield* RelationshipsRepository;
						const thirdEntityId = EntityId.make("relationship-third");
						yield* session.run((db) =>
							db
								.insert(tables.entity)
								.values({
									name: "Third",
									properties: {},
									id: thirdEntityId,
									entitySchemaSlug: "fixture",
								}),
						);
						const merged = between(sourceEntityId, thirdEntityId);
						const updated = between(targetEntityId, sourceEntityId);
						const ensured = between(targetEntityId, targetEntityId);
						const deleted = between(sourceEntityId, sourceEntityId);
						yield* repository.createRelationship({
							...merged,
							properties: { rank: 1, labels: ["a"] },
						});
						yield* repository.createRelationship({ ...updated, properties: { rank: 1 } });
						yield* repository.createRelationship({ ...ensured, properties: { rank: 1 } });
						yield* repository.createRelationship({ ...deleted, properties: { rank: 1 } });
						const byId = yield* repository.createRelationship({
							...between(thirdEntityId, sourceEntityId),
							properties: { rank: 1 },
						});
						const change = (
							itemIdentity: string,
							input: ReturnType<typeof between>,
							properties: Record<string, unknown> = {},
						) => ({
							properties,
							itemIdentity,
							relationshipSchema: input.relationshipSchema,
							source: { kind: "existing" as const, entityId: input.sourceEntityId },
							target: { kind: "existing" as const, entityId: input.targetEntityId },
						});
						const committed = yield* (yield* ChangeSets).commit(
							{
								userId,
								relationships: {
									deletes: [change("delete", deleted)],
									updates: [change("update", updated, { rank: 5 })],
									ensures: [change("ensure", ensured, { rank: 9 })],
									deletesById: [
										{ relationshipId: byId.id, itemIdentity: "delete-by-id" },
										{
											itemIdentity: "missing",
											relationshipId: RelationshipId.make("missing-relationship"),
										},
									],
									upserts: [
										{
											...change("upsert", between(sourceEntityId, targetEntityId), { rank: 2 }),
											propertiesMode: "replace",
										},
										{ ...change("merge", merged, { labels: ["b"] }), propertiesMode: "merge" },
									],
								},
							},
							command("every-mode"),
						);
						expect(
							committed.relationships.map(({ operation, itemIdentity }) => [
								itemIdentity,
								operation,
							]),
						).toEqual([
							["upsert", "create"],
							["merge", "update"],
							["update", "update"],
							["ensure", "noop"],
							["delete", "delete"],
							["delete-by-id", "delete"],
							["missing", "noop"],
						]);
						const rows = yield* session.run((db) => db.select().from(tables.relationship));
						const propertiesOf = (input: ReturnType<typeof between>) =>
							rows.find(
								(row) =>
									row.sourceEntityId === input.sourceEntityId &&
									row.targetEntityId === input.targetEntityId,
							)?.properties;
						expect(rows).toHaveLength(4);
						expect(propertiesOf(between(sourceEntityId, targetEntityId))).toEqual({ rank: 2 });
						expect(propertiesOf(merged)).toEqual({ rank: 1, labels: ["a", "b"] });
						expect(propertiesOf(updated)).toEqual({ rank: 5 });
						expect(propertiesOf(ensured)).toEqual({ rank: 1 });
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipChangeSetsLayer())(
		"runs relationship policies once per batch and rejects the whole change set",
		(test) => {
			test.effect(
				"runs relationship policies once per batch and rejects the whole change set",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const policyInput = yield* installPolicyFixture();
						const calls: Array<ReadonlyArray<string>> = [];
						const counting = (decided: LifecyclePolicies["Service"]) =>
							LifecyclePolicies.of({
								...decided,
								run: (input) => {
									calls.push(input.items.map(({ itemIdentity }) => itemIdentity));
									return decided.run(input);
								},
							});
						const { match } = yield* LifecyclePolicies;
						const pairs = [
							[policyInput.sourceEntityId, policyInput.targetEntityId],
							[policyInput.targetEntityId, policyInput.sourceEntityId],
							[policyInput.sourceEntityId, policyInput.sourceEntityId],
						] as const;
						const endpoints = pairs.map(([source, target], index) => ({
							itemIdentity: `relationship:${index}`,
							relationshipSchema: policyInput.relationshipSchema,
							source: { entityId: source, kind: "existing" as const },
							target: { entityId: target, kind: "existing" as const },
						}));
						const upserts = endpoints.map((item) =>
							Object.assign({ properties: { rank: 1 }, propertiesMode: "replace" as const }, item),
						);
						const transforming = yield* changeSetsWith({
							policies: counting(
								decidingPolicies(match, () =>
									Effect.succeed({
										action: "transform" as const,
										patch: {
											resource: "relationship" as const,
											draft: { properties: { remove: [], set: { rank: 10 } } },
										},
									}),
								),
							),
						});
						const committed = yield* transforming.commit(
							{ userId, relationships: { upserts } },
							command("batch-policies"),
						);
						expect(calls).toHaveLength(1);
						expect([...(calls[0] ?? [])].sort()).toEqual(
							upserts.map(({ itemIdentity }) => `relationship:${itemIdentity}`),
						);
						expect(
							committed.relationships.map(({ relationship }) => relationship?.properties),
						).toEqual([{ rank: 10 }, { rank: 10 }, { rank: 10 }]);

						calls.length = 0;
						const rejecting = yield* changeSetsWith({
							policies: counting(
								decidingPolicies(match, (item) =>
									Effect.succeed(
										item.itemIdentity.endsWith("relationship:2")
											? { action: "reject" as const, reason: { key: "rejection.rejected" } }
											: { action: "allow" as const },
									),
								),
							),
						});
						const rejected = yield* rejecting
							.commit({ userId, relationships: { deletes: endpoints } }, command("batch-rejection"))
							.pipe(Effect.flip);
						expect(rejected).toMatchObject({ reason: { code: "policy-rejected" } });
						expect(calls).toHaveLength(1);
						expect(yield* session.run((db) => db.select().from(tables.relationship))).toHaveLength(
							3,
						);
					}),
				testTimeout,
			);
		},
	);
});
