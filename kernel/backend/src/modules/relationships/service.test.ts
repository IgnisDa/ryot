import { describe, expect } from "bun:test";

import { BunCrypto } from "@effect/platform-bun";
import { DbError } from "@ryot-app/contract/errors";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { RelationshipBadRequest } from "@ryot-app/contract/modules/relationships/schemas";
import {
	AutomationHookSlug,
	AutomationRunId,
	EntityId,
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";

import { insertManagedAsset } from "#lib/domain/managed-asset-writes.test-support";
import {
	withLifecycleBatchPlanning,
	withLifecycleDispatch,
} from "#modules/automations/lifecycle.test-support";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecyclePlanner } from "#modules/automations/lifecycle/planning";
import { EntitiesService } from "#modules/entities/service";
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
	relationshipSchemaSlug,
	relationshipsServiceWith,
	sourceEntityId,
	targetEntityId,
	userId,
} from "./lifecycle.test-support";
import { RelationshipsRepository } from "./repository";
import { RelationshipsService } from "./service";

describe("Relationships lifecycle owner", () => {
	layer(relationshipDatabaseLayer())("uses the active relationship schema", (test) => {
		test.effect(
			"uses the active relationship schema",
			() =>
				Effect.gen(function* () {
					const service = yield* RelationshipsService;
					expect(
						yield* service
							.create({ ...baseInput, properties: { rank: "invalid" } }, command("active-schema"))
							.pipe(Effect.flip),
					).toMatchObject({ reason: { code: "invalid-properties" } });
				}),
			testTimeout,
		);
	});

	layer(relationshipDatabaseLayer())(
		"commits a no-hook relationship in the prepare transaction",
		(test) => {
			test.effect(
				"commits a no-hook relationship in the prepare transaction",
				() =>
					Effect.gen(function* () {
						const service = yield* RelationshipsService;
						const session = yield* DatabaseSession;
						const fast = yield* service.prepareCreate(baseInput, command("step-fast"));
						assert(fast._tag === "Committed");
						expect(fast.result.relationship?.wasInserted).toBe(true);
						expect(fast.dispatch).toEqual([]);
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

	layer(relationshipDatabaseLayer())(
		"preserves relationship metadata on repeated ensure",
		(test) => {
			test.effect(
				"preserves relationship metadata on repeated ensure",
				() =>
					Effect.gen(function* () {
						const service = yield* RelationshipsService;
						const existingProperties = { rank: 1, labels: ["saved"] };
						const created = yield* service.prepareCreate(
							{ ...baseInput, ifAbsent: true, properties: existingProperties },
							command("ensure-initial"),
						);
						assert(created._tag === "Committed");
						expect(created.result.operation).toBe("create");

						const repeated = yield* service.prepareCreate(
							{ ...baseInput, ifAbsent: true, properties: { rank: 2, labels: ["incoming"] } },
							command("ensure-repeated"),
						);
						assert(repeated._tag === "Committed");
						expect(repeated.result).toMatchObject({
							operation: "noop",
							relationship: { properties: existingProperties },
						});
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipDatabaseLayer())("rejects a foreign qualified relationship schema", (test) => {
		test.effect(
			"rejects a foreign qualified relationship schema",
			() =>
				Effect.gen(function* () {
					const service = yield* RelationshipsService;
					expect(
						yield* service
							.create(
								{
									...baseInput,
									relationshipSchema: {
										slug: relationshipSchemaSlug,
										owner: definitionOwner("stale-plugin"),
									},
								},
								command("stale-plugin"),
							)
							.pipe(Effect.flip),
					).toMatchObject({ reason: { code: "relationship-schema-not-found" } });
				}),
			testTimeout,
		);
	});

	layer(relationshipDatabaseLayer({ omitSchemaBeforeWrite: true }))(
		"rejects a disabled or missing relationship definition before lifecycle planning",
		(test) => {
			test.effect(
				"rejects a disabled or missing relationship definition before lifecycle planning",
				() =>
					Effect.gen(function* () {
						const service = yield* RelationshipsService;
						const session = yield* DatabaseSession;
						expect(
							yield* service.create(baseInput, command("missing-schema")).pipe(Effect.flip),
						).toMatchObject({ reason: { code: "relationship-schema-not-found" } });
						expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual(
							[],
						);
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipDatabaseLayer({ activateSchemaOnWrite: true }))(
		"revalidates the relationship schema under the catalog lock before writing",
		(test) => {
			test.effect(
				"revalidates the relationship schema under the catalog lock before writing",
				() =>
					Effect.gen(function* () {
						const service = yield* RelationshipsService;
						const session = yield* DatabaseSession;
						expect(
							yield* service
								.createUser(userId, baseInput, command("schema-race"))
								.pipe(Effect.flip),
						).toEqual(
							new RelationshipBadRequest({ reason: { code: "concurrent-relationship-change" } }),
						);
						expect(yield* session.run((db) => db.select().from(tables.relationship))).toEqual([]);
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipDatabaseLayer({ mutableRelationshipSchema: true }))(
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
										selector: { type: "self" },
										relationshipSchema: baseInput.relationshipSchema,
										relationships: [
											{ sourceEntityId, properties: { rank: 1 }, targetEntityId: sourceEntityId },
										],
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

	layer(relationshipDatabaseLayer())(
		"replays no-hook merge, update, and delete by ID without automation history",
		(test) => {
			test.effect(
				"replays no-hook merge, update, and delete by ID without automation history",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const execution = yield* LifecycleExecution;
						const warning = {
							code: "required-hook-pending" as const,
							runId: AutomationRunId.make("pending-merge"),
							hookSlug: AutomationHookSlug.make("required"),
						};
						const service = yield* relationshipsServiceWith({
							execution: withLifecycleDispatch({
								...execution,
								after: () => Effect.succeed([warning]),
							}),
						});
						const input = { ...baseInput, properties: { rank: 1, labels: ["a"] } };
						const created = yield* service.mergeUserProperties(input, command("merge-create"));
						assert(created.relationship);
						expect(created.warnings).toEqual([]);
						const merged = yield* service.mergeUserProperties(
							{ ...input, properties: { labels: ["a", "b"] } },
							command("merge-update"),
						);
						expect(merged).toMatchObject({
							warnings: [],
							relationship: {
								wasInserted: false,
								id: created.relationship.id,
								properties: { rank: 1, labels: ["a", "b"] },
							},
						});
						expect(
							yield* service.mergeUserProperties(
								{ ...input, properties: { labels: ["a", "b"] } },
								command("merge-update"),
							),
						).toEqual(merged);
						const noop = yield* service.mergeUserProperties(
							{ ...input, properties: { labels: ["a", "b"] } },
							command("merge-noop"),
						);
						expect(noop.warnings).toEqual([]);
						expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual(
							[],
						);
						const updated = yield* service.update(
							{ ...input, properties: { rank: 3, labels: ["b"] } },
							command("explicit-update"),
						);
						expect(updated.warnings).toEqual([]);
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
							yield* service.deleteUserRelationshipById(
								UserId.make("other-owner"),
								created.relationship.id,
								command("foreign-delete", UserId.make("other-owner")),
							),
						).toEqual({ warnings: [], relationship: null });
						const deleted = yield* service.deleteUserRelationshipById(
							userId,
							created.relationship.id,
							command("delete-id"),
						);
						expect(deleted).toEqual(updated);
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
	layer(relationshipDatabaseLayer())(
		"rejects nested transaction entry before planning or source writes",
		(test) => {
			test.effect(
				"rejects nested transaction entry before planning or source writes",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const service = yield* RelationshipsService;
						const exit = yield* Effect.exit(
							session.transaction(service.create(baseInput, command("nested-entry"))),
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
	layer(relationshipDatabaseLayer())(
		"commits pinned required and async runs with their source, rolling all three back on failure",
		(test) => {
			test.effect(
				"commits pinned required and async runs with their source, rolling all three back on failure",
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
											delivery: "required",
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
											delivery: "async",
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
							(yield* relationshipsServiceWith({
								planner: withLifecycleBatchPlanning({
									plan: (value) =>
										Effect.gen(function* () {
											const plan = yield* planner.plan(value);
											if (value.trigger.kind.category === "change") {
												expect(plan.runs.map(({ delivery }) => delivery).sort()).toEqual([
													"async",
													"required",
												]);
												return yield* new DbError({ message: "Fail after run insertion" });
											}
											return plan;
										}),
								}),
							})).create(input, command("runs")),
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
						yield* (yield* relationshipsServiceWith({
							execution: withLifecycleDispatch({
								...execution,
								executePolicy: () => Effect.die("Unexpected policy"),
								after: ({ runs, triggerId }) =>
									Effect.gen(function* () {
										runCounts.push(runs.length);
										if (runs.length === 0) {
											return [];
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
										return [];
									}),
							}),
						})).create(input, command("runs"));
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
						const limited = yield* (yield* relationshipsServiceWith({
							planner: runLimitedPlanner,
						})).create(
							{
								...input,
								sourceEntityId: input.targetEntityId,
								targetEntityId: input.sourceEntityId,
							},
							{ ...limitedCommand, causation: { ...limitedCommand.causation, depth: 1 } },
						);
						const blocked = (yield* session.run((db) =>
							db.select().from(tables.automationTrigger),
						)).find(({ blockedReason }) => blockedReason !== null);
						assert(blocked);
						expect(limited.relationship?.wasInserted).toBe(true);
						expect(limited.warnings).toEqual<unknown>([
							{
								triggerId: blocked.id,
								hasRequiredHooks: true,
								code: "automation-limit-reached",
								omittedHooks: [
									{ hookSlug: "async", pluginId: installed.pluginId },
									{ hookSlug: "required", pluginId: installed.pluginId },
								],
							},
						]);
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
	layer(relationshipDatabaseLayer())(
		"does not dispatch no-hook writes and rejects a nested transaction",
		(test) => {
			test.effect(
				"does not dispatch no-hook writes and rejects a nested transaction",
				() =>
					Effect.gen(function* () {
						const service = yield* RelationshipsService;
						const session = yield* DatabaseSession;
						yield* service.create(baseInput, command("commit"));
						expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual(
							[],
						);
						const nested = yield* Effect.exit(
							session.transaction(service.delete(baseInput, command("nested"))),
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

	layer(relationshipDatabaseLayer())(
		"chains policy drafts, preserves trusted identity, and validates final properties outside transactions",
		(test) => {
			test.effect(
				"chains policy drafts, preserves trusted identity, and validates final properties outside transactions",
				() =>
					Effect.gen(function* () {
						const planner = yield* LifecyclePlanner;
						const session = yield* DatabaseSession;
						const policyInput = yield* installPolicyFixture();
						const seen: unknown[] = [];
						const execution = yield* LifecycleExecution;
						const result = yield* (yield* relationshipsServiceWith({
							planner: withLifecycleBatchPlanning({
								plan: (input) =>
									planner.plan(input).pipe(
										Effect.map((plan) => {
											if (input.trigger.kind.category !== "request") {
												return plan;
											}
											assert(plan.trigger);
											return {
												...plan,
												policies: [
													{ position: 1, pluginId: null, runId: AutomationRunId.make("first") },
													{ position: 2, pluginId: null, runId: AutomationRunId.make("second") },
												],
											};
										}),
									),
							}),
							execution: withLifecycleDispatch({
								...execution,
								after: () => Effect.succeed([]),
								executePolicy: ({ runId, acceptedPatches }) =>
									Effect.gen(function* () {
										expect(!(yield* session.isTransactionActive)).toBe(true);
										seen.push(acceptedPatches);
										return {
											action: "transform" as const,
											patch: {
												resource: "relationship",
												draft: {
													properties: { remove: [], set: { rank: runId === "first" ? 2 : 3 } },
												},
											},
										};
									}),
							}),
						})).create(policyInput, command("policies"));
						expect(seen).toEqual([
							[],
							[
								{
									resource: "relationship",
									draft: { properties: { remove: [], set: { rank: 2 } } },
								},
							],
						]);
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

	layer(relationshipDatabaseLayer())(
		"detects writes made during policy execution without overwriting them",
		(test) => {
			test.effect(
				"detects writes made during policy execution without overwriting them",
				() =>
					Effect.gen(function* () {
						const repository = yield* RelationshipsRepository;
						const planner = yield* LifecyclePlanner;
						const execution = yield* LifecycleExecution;
						const policyInput = yield* installPolicyFixture();
						const created = yield* repository.createRelationship({
							...policyInput,
							properties: { rank: 1 },
						});
						const exit = yield* Effect.exit(
							(yield* relationshipsServiceWith({
								execution: withLifecycleDispatch({
									...execution,
									after: () => Effect.succeed([]),
									executePolicy: () =>
										repository
											.updateRelationshipsById([{ id: created.id, properties: { rank: 9 } }])
											.pipe(Effect.as({ action: "allow" as const }), Effect.orDie),
								}),
								planner: withLifecycleBatchPlanning({
									plan: (input) =>
										planner.plan(input).pipe(
											Effect.map((plan) => {
												if (input.trigger.kind.category !== "request") {
													return plan;
												}
												assert(plan.trigger);
												return {
													...plan,
													policies: [
														{
															position: 1,
															pluginId: null,
															runId: AutomationRunId.make("concurrent"),
														},
													],
												};
											}),
										),
								}),
							})).update({ ...policyInput, properties: { rank: 2 } }, command("stale")),
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

	layer(relationshipDatabaseLayer())(
		"retains request history on policy rejection, invalid transforms, and planning limits",
		(test) => {
			test.effect(
				"retains request history on policy rejection, invalid transforms, and planning limits",
				() =>
					Effect.gen(function* () {
						const planner = yield* LifecyclePlanner;
						const session = yield* DatabaseSession;
						const policyInput = yield* installPolicyFixture();
						for (const mode of ["reject", "invalid", "limit"] as const) {
							const execution = yield* LifecycleExecution;
							const exit = yield* Effect.exit(
								(yield* relationshipsServiceWith({
									execution: withLifecycleDispatch({
										...execution,
										after: () => Effect.die("A rejected write cannot dispatch"),
										executePolicy: () => {
											return Effect.succeed(
												mode === "reject"
													? { action: "reject" as const, reason: { key: "rejection.rejected" } }
													: {
															action: "transform" as const,
															patch: {
																resource: "relationship",
																draft: { properties: { remove: [], set: { rank: "invalid" } } },
															},
														},
											);
										},
									}),
									planner: withLifecycleBatchPlanning({
										plan: (input) =>
											planner.plan(input).pipe(
												Effect.map((plan) => {
													assert(plan.trigger);
													return {
														...plan,
														policies: [
															{ position: 1, pluginId: null, runId: AutomationRunId.make(mode) },
														],
														trigger:
															mode === "limit"
																? {
																		...plan.trigger,
																		blockedReason: {
																			omittedHooks: [],
																			hasRequiredHooks: false,
																			code: "automation-limit-reached" as const,
																		},
																	}
																: plan.trigger,
													};
												}),
											),
									}),
								})).create(policyInput, command(mode)),
							);
							switch (mode) {
								case "limit":
									assertExitFails(
										exit,
										new RelationshipBadRequest({ reason: { code: "automation-limit-reached" } }),
									);
									break;
								case "reject":
									assertExitFails(
										exit,
										new RelationshipBadRequest({
											reason: {
												code: "policy-rejected",
												runId: AutomationRunId.make(mode),
												message: { namespace: "kernel", key: "rejection.rejected" },
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
						expect(
							(yield* session.run((db) => db.select().from(tables.automationTrigger))).map(
								({ category }) => category,
							),
						).toEqual(["request", "request", "request"]);
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipDatabaseLayer())(
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

	layer(relationshipDatabaseLayer())(
		"keeps provider entities, relationships, triggers, and runs in one caller transaction",
		(test) => {
			test.effect(
				"keeps provider entities, relationships, triggers, and runs in one caller transaction",
				() =>
					Effect.gen(function* () {
						const { observer } = yield* RelationshipFixture;
						const session = yield* DatabaseSession;
						const entities = yield* EntitiesService;
						const relationships = yield* RelationshipsService;
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
										delivery: "async",
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

						const persistGroup = (id: string, rollback: boolean) =>
							session.transaction(
								session.run((tx) =>
									Effect.gen(function* () {
										const entityWork = yield* entities.persistPlannedProviderUpsert({
											providerId,
											externalId: id,
											scope: "global",
											populatedAt: null,
											updateExisting: true,
											name: `Provider ${id}`,
											properties: { title: id },
											lifecycle: command(`${id}-entity`),
											entitySchema: {
												owner: definitionOwner(installed.pluginId),
												slug: EntitySchemaSlug.make("group-fixture"),
											},
										});
										const relationshipWork = yield* relationships.persistPlannedReconciliation(
											[
												{
													relationshipSchema: {
														slug: groupRelationshipSchemaSlug,
														owner: definitionOwner(installed.pluginId),
													},
													selector: {
														type: "anchored",
														direction: "outgoing",
														anchorEntityId: ownedSourceEntityId,
													},
													relationships: [
														{
															properties: { rank: 1 },
															sourceEntityId: ownedSourceEntityId,
															targetEntityId: entityWork.result.entity.id,
														},
													],
												},
											],
											command(`${id}-relationship`),
											{ scope: "global" },
										);
										expect(yield* tx.select().from(tables.relationship)).toHaveLength(1);
										expect(yield* tx.select().from(tables.automationTrigger)).toHaveLength(2);
										expect(yield* tx.select().from(tables.automationRun)).toHaveLength(2);
										const invisible = yield* Effect.tryPromise({
											catch: () => new DbError({ message: "Observer failed" }),
											try: () =>
												observer.query(
													"select (select count(*)::int from relationship) as relationships, (select count(*)::int from automation_trigger) as triggers, (select count(*)::int from automation_run) as runs",
												),
										});
										expect(invisible.rows).toEqual([{ runs: 0, triggers: 0, relationships: 0 }]);
										if (rollback) {
											return yield* new DbError({ message: "Rollback provider group" });
										}
										return {
											entityDispatch: entityWork.dispatch,
											relationshipDispatch: relationshipWork.dispatch,
										};
									}),
								),
							);

						expect(yield* persistGroup("rollback", true).pipe(Effect.flip)).toMatchObject({
							message: "Rollback provider group",
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

						const work = yield* persistGroup("commit", false);
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
						expect([...work.entityDispatch, ...work.relationshipDispatch]).toHaveLength(2);
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipDatabaseLayer())(
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
											delivery: "async",
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

	layer(relationshipDatabaseLayer())(
		"keeps prepared user relationship changes in the caller transaction",
		(test) => {
			test.effect(
				"keeps prepared user relationship changes in the caller transaction",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const service = yield* RelationshipsService;
						const repository = yield* RelationshipsRepository;
						const planner = yield* LifecyclePlanner;
						const execution = yield* LifecycleExecution;

						const created = yield* repository.createRelationship(baseInput);
						const stale = yield* service.prepareUserDelete(baseInput, command("prepared-stale"));
						assert(stale);
						yield* repository.updateRelationshipsById([
							{ id: created.id, properties: { rank: 9 } },
						]);
						expect(
							yield* session
								.transaction(service.persistPreparedUserDelete(stale))
								.pipe(Effect.flip),
						).toMatchObject({ reason: { code: "concurrent-relationship-change" } });

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
						const creation = yield* service.prepareUserCreate(
							createInput,
							command("prepared-create"),
						);
						assert(deletion);
						assert(creation);
						expect(
							yield* service.persistPreparedUserCreate(creation).pipe(Effect.flip),
						).toMatchObject({ code: "active-transaction-required" });
						expect(
							yield* session
								.transaction(
									session.run((tx) =>
										Effect.gen(function* () {
											yield* service.persistPreparedUserDelete(deletion);
											yield* service.persistPreparedUserCreate(creation);
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

						const work = yield* session.transaction(service.persistPreparedUserCreate(creation));
						expect(work.dispatch).toEqual([]);

						const rejectedInput = yield* installPolicyFixture();
						yield* repository.createRelationship(rejectedInput);
						const rejectingService = yield* relationshipsServiceWith({
							execution: withLifecycleDispatch({
								...execution,
								executePolicy: () =>
									Effect.gen(function* () {
										expect(!(yield* session.isTransactionActive)).toBe(true);
										return { action: "reject" as const, reason: { key: "rejection.rejected" } };
									}),
							}),
							planner: withLifecycleBatchPlanning({
								plan: (input) =>
									planner.plan(input).pipe(
										Effect.map((plan) => {
											assert(plan.trigger);
											return {
												...plan,
												policies: [
													{
														position: 1,
														pluginId: null,
														runId: AutomationRunId.make("reject-relationship"),
													},
												],
											};
										}),
									),
							}),
						});
						const rejected = yield* rejectingService
							.prepareUserDelete(rejectedInput, command("prepared-rejected"))
							.pipe(Effect.flip);
						expect(rejected).toMatchObject({ reason: { code: "policy-rejected" } });
						expect(yield* repository.findRelationship(rejectedInput)).not.toBeNull();
					}),
				testTimeout,
			);
		},
	);

	layer(relationshipDatabaseLayer())(
		"retains prepared updates transformed back to source properties",
		(test) => {
			test.effect(
				"retains prepared updates transformed back to source properties",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const repository = yield* RelationshipsRepository;
						const execution = yield* LifecycleExecution;
						const input = yield* installPolicyFixture();
						yield* repository.createRelationship(input);
						let policyCalls = 0;
						const service = yield* relationshipsServiceWith({
							execution: withLifecycleDispatch({
								...execution,
								executePolicy: () =>
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
							}),
						});
						expect(
							yield* service.prepareUserCreate(input, command("prepared-initial-noop")),
						).toBeNull();
						expect(policyCalls).toBe(0);
						const submitted = { ...input, properties: { rank: 2 } };
						const lifecycle = command("prepared-policy-noop");
						const prepared = yield* service.prepareUserCreate(submitted, lifecycle);
						assert(prepared);
						expect(policyCalls).toBe(1);
						const work = yield* session.transaction(service.persistPreparedUserCreate(prepared));
						expect(work.result.properties).toEqual({ rank: 1 });
					}),
				testTimeout,
			);
		},
	);

	layer(Layer.provideMerge(relationshipDatabaseLayer(), BunCrypto.layerSecureRandom))(
		"rejects another user's managed asset on relationship writes",
		(test) => {
			test.effect(
				"rejects another user's managed asset on relationship writes",
				() =>
					Effect.gen(function* () {
						const service = yield* RelationshipsService;
						const foreign = yield* insertManagedAsset(UserId.make("relationship-asset-foreign"));
						const session = yield* DatabaseSession;
						const forbidden = new RelationshipBadRequest({ reason: { code: "asset-forbidden" } });
						const prepared = yield* service.prepareUserCreate(
							{ ...baseInput, properties: { rank: 1, image: foreign } },
							command("foreign-asset-single"),
						);
						assert(prepared);
						assertExitFails(
							yield* Effect.exit(session.transaction(service.persistPreparedUserCreate(prepared))),
							forbidden,
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
												selector: { type: "self" },
												relationshipSchema: baseInput.relationshipSchema,
												relationships: [
													{
														sourceEntityId,
														targetEntityId: sourceEntityId,
														properties: { rank: 1, image: own },
													},
												],
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
});
