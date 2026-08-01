import { PgClient } from "@effect/sql-pg";
import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { RelationshipBadRequest } from "@ryot-app/contract/modules/relationships/schemas";
import {
	AutomationHookSlug,
	AutomationExecutionId,
	AutomationRunId,
	AutomationTriggerId,
	EntityId,
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Cause, DateTime, Effect, Exit, Layer, Option } from "effect";
import { assert, describe } from "vitest";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import {
	AutomationPolicyExecutionError,
	LifecycleExecution,
} from "#lib/domain/lifecycle-execution";
import { AppConfig } from "#lib/infrastructure/config/service";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database } from "#lib/infrastructure/db/service";
import { assertExitFails } from "#lib/test-utils/assertions";
import { AutomationAttemptRepository } from "#modules/automations/attempt-repository";
import {
	withLifecycleBatchPlanning,
	withLifecycleDispatch,
} from "#modules/automations/lifecycle.test-support";
import { LifecyclePlannerLive } from "#modules/automations/planner";
import { EntitiesService } from "#modules/entities/service";
import { installRevisionPackage, revisionPackage } from "#modules/plugins/revision.test-support";

import {
	baseInput,
	command,
	relationshipSchemaSlug,
	sourceEntityId,
	targetEntityId,
	userId,
	withRelationshipDatabase,
} from "./lifecycle.test-support";
import { changeUserRelationships } from "./mutation-pipeline";
import { RelationshipsRepository } from "./repository";
import { RelationshipsService } from "./service";

describe("Relationships lifecycle owner", () => {
	it.effect("uses the active relationship schema", () =>
		withRelationshipDatabase(() =>
			Effect.gen(function* () {
				const service = yield* RelationshipsService;
				expect(
					yield* service
						.create({ ...baseInput, properties: { rank: "invalid" } }, command("active-schema"))
						.pipe(Effect.flip),
				).toMatchObject({ reason: { code: "invalid-properties" } });
			}),
		),
	);

	it.effect("commits relationship writes in prepare and after policies with the same rows", () =>
		withRelationshipDatabase(() =>
			Effect.gen(function* () {
				const service = yield* RelationshipsService;
				const planner = yield* LifecyclePlanner;
				const execution = yield* LifecycleExecution;
				const db = yield* Database;
				const fast = yield* service.prepareCreate(baseInput, command("step-fast"));
				assert(fast._tag === "Committed");
				expect(fast.result.relationship?.wasInserted).toBe(true);
				expect(fast.dispatch).toHaveLength(2);
				expect(yield* db.select().from(tables.relationship)).toHaveLength(1);

				const policyRunId = AutomationRunId.make("step-policy");
				const withPolicies = Effect.provideService(
					LifecyclePlanner,
					withLifecycleBatchPlanning({
						plan: (input) =>
							planner
								.plan(input)
								.pipe(
									Effect.map((plan) => ({
										...plan,
										policies:
											plan.trigger.kind.category === "request"
												? [{ position: 1, runId: policyRunId }]
												: [],
									})),
								),
					}),
				);
				const executed: string[] = [];
				const withPolicyExecution = Effect.provideService(
					LifecycleExecution,
					withLifecycleDispatch({
						...execution,
						executePolicy: ({ runId }) =>
							Effect.sync(() => {
								executed.push(runId);
								return { action: "allow" as const };
							}),
					}),
				);
				const prepared = yield* service
					.prepareCreate({ ...baseInput, properties: { rank: 5 } }, command("step-policies"))
					.pipe(withPolicies, withPolicyExecution);
				assert(prepared._tag === "PoliciesRequired");
				expect(executed).toEqual([]);
				const accepted = yield* service
					.applyPolicies(prepared.pending)
					.pipe(withPolicies, withPolicyExecution);
				expect(executed).toEqual([policyRunId]);
				const committed = yield* service
					.commitSingle(accepted)
					.pipe(withPolicies, withPolicyExecution);
				assert(committed._tag === "Committed");
				expect(committed.result.relationship?.properties).toEqual({ rank: 5 });
				expect(
					(yield* db.select().from(tables.relationship)).map(({ properties }) => properties),
				).toEqual([{ rank: 5 }]);
			}),
		),
	);

	it.effect("rejects caller relationship schema provenance that differs from the catalog", () =>
		withRelationshipDatabase(() =>
			Effect.gen(function* () {
				const service = yield* RelationshipsService;
				expect(
					yield* service
						.create(
							{ ...baseInput, relationshipSchemaPluginId: "stale-plugin" },
							command("stale-plugin"),
						)
						.pipe(Effect.flip),
				).toEqual(
					new RelationshipBadRequest({ reason: { code: "concurrent-relationship-change" } }),
				);
			}),
		),
	);

	it.effect("rejects a disabled or missing relationship definition before lifecycle planning", () =>
		withRelationshipDatabase(
			() =>
				Effect.gen(function* () {
					const service = yield* RelationshipsService;
					const db = yield* Database;
					expect(
						yield* service.create(baseInput, command("missing-schema")).pipe(Effect.flip),
					).toMatchObject({ reason: { code: "relationship-schema-not-found" } });
					expect(yield* db.select().from(tables.automationTrigger)).toEqual([]);
				}),
			{ omitSchemaBeforeWrite: true },
		),
	);

	it.effect("revalidates the relationship schema under the catalog lock before writing", () =>
		withRelationshipDatabase(
			() =>
				Effect.gen(function* () {
					const service = yield* RelationshipsService;
					const db = yield* Database;
					expect(
						yield* service.createUser(userId, baseInput, command("schema-race")).pipe(Effect.flip),
					).toEqual(
						new RelationshipBadRequest({ reason: { code: "concurrent-relationship-change" } }),
					);
					expect(yield* db.select().from(tables.relationship)).toEqual([]);
				}),
			{ activateSchemaOnWrite: true },
		),
	);

	it.effect("replays a committed relationship after its schema is updated or disabled", () =>
		withRelationshipDatabase(
			(_observer, catalog) =>
				Effect.gen(function* () {
					const service = yield* RelationshipsService;
					const db = yield* Database;
					const lifecycle = command("schema-replay");
					const created = yield* service.create(baseInput, lifecycle);
					catalog.updateRelationshipSchema();
					expect(yield* service.create(baseInput, lifecycle)).toEqual(created);
					catalog.disableRelationshipSchema();
					expect(yield* service.create(baseInput, lifecycle)).toEqual(created);
					expect(yield* db.select().from(tables.relationship)).toHaveLength(1);
					expect(yield* db.select().from(tables.automationTrigger)).toHaveLength(3);
				}),
			{ mutableRelationshipSchema: true },
		),
	);

	it.effect(
		"uses lifecycle snapshots and warning results for merge, update, and delete by ID",
		() =>
			withRelationshipDatabase(() =>
				Effect.gen(function* () {
					const service = yield* RelationshipsService;
					const db = yield* Database;
					const execution = yield* LifecycleExecution;
					const warning = {
						code: "required-hook-pending" as const,
						runId: AutomationRunId.make("pending-merge"),
						hookSlug: AutomationHookSlug.make("required"),
					};
					const input = { ...baseInput, properties: { rank: 1, labels: ["a"] } };
					yield* Effect.gen(function* () {
						const created = yield* service.mergeUserProperties(input, command("merge-create"));
						assert(created.relationship);
						expect(created.warnings).toEqual([warning, warning]);
						const merged = yield* service.mergeUserProperties(
							{ ...input, properties: { labels: ["a", "b"] } },
							command("merge-update"),
						);
						expect(merged).toMatchObject({
							warnings: [warning, warning],
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
						expect(yield* db.select().from(tables.automationTrigger)).toHaveLength(6);
						const updated = yield* service.update(
							{ ...input, properties: { rank: 3, labels: ["b"] } },
							command("explicit-update"),
						);
						expect(updated.warnings).toEqual([warning, warning]);
						expect(
							yield* service.deleteUserRelationshipById(
								UserId.make("other-owner"),
								created.relationship.id,
								command("foreign-delete"),
							),
						).toEqual({ warnings: [], relationship: null });
						const deleted = yield* service.deleteUserRelationshipById(
							userId,
							created.relationship.id,
							command("delete-id"),
						);
						expect(deleted).toEqual(updated);
						expect(yield* db.select().from(tables.relationship)).toEqual([]);
						const changes = (yield* db.select().from(tables.automationTrigger)).filter(
							({ category }) => category === "change",
						);
						expect(changes.map(({ operation }) => operation).sort()).toEqual([
							"batch",
							"batch",
							"batch",
							"batch",
							"create",
							"delete",
							"update",
							"update",
						]);
					}).pipe(
						Effect.provideService(
							LifecycleExecution,
							withLifecycleDispatch({ ...execution, after: () => Effect.succeed([warning]) }),
						),
					);
				}),
			),
	);
	it.effect("closes unstarted policies across the batch after rejection or execution failure", () =>
		withRelationshipDatabase(() =>
			Effect.gen(function* () {
				const db = yield* Database;
				const client = yield* PgClient.PgClient;
				const execution = yield* LifecycleExecution;
				const attempts = yield* AutomationAttemptRepository.make;
				const fixture = revisionPackage("relationship-policies");
				const original = fixture.scripts.find(({ metadata }) => metadata.kind === "automation");
				assert(original?.metadata.kind === "automation");
				const policy = {
					...original,
					slug: "relationship-policies.policy",
					contentHash: "relationship-policy-hash",
					metadata: {
						...original.metadata,
						automationType: "policy" as const,
						slug: "relationship-policies.policy",
					},
				};
				const target = fixture.manifest.relationshipSchemas[0];
				assert(target);
				yield* installRevisionPackage(
					{
						...fixture,
						scripts: [...fixture.scripts, policy],
						manifest: {
							...fixture.manifest,
							relationshipSchemas: [
								{ ...target, sourceEntitySchemaSlug: null, targetEntitySchemaSlug: null },
							],
							scripts: [
								...fixture.manifest.scripts,
								{ ...policy.metadata, entry: "backend/policy.sandbox.ts" },
							],
							hooks: [
								...fixture.manifest.hooks,
								...[1, 2, 3].map((position) => ({
									position,
									scriptSlug: policy.slug,
									stage: "before" as const,
									slug: `policy-${position}`,
									name: `Policy ${position}`,
									targets: [
										{
											operation: "create" as const,
											resource: "relationship" as const,
											relationshipSchemaSlug: target.slug,
										},
									],
								})),
							],
						},
					},
					userId,
				);
				for (const mode of ["reject", "failure"] as const) {
					const cleanup: string[] = [];
					const invoked: AutomationRunId[] = [];
					const exit = yield* Effect.exit(
						changeUserRelationships(
							userId,
							[
								{
									deletes: [],
									creates: [
										{
											sourceEntityId,
											targetEntityId,
											properties: {},
											relationshipSchemaSlug: RelationshipSchemaSlug.make(target.slug),
										},
										{
											properties: {},
											sourceEntityId: targetEntityId,
											targetEntityId: sourceEntityId,
											relationshipSchemaSlug: RelationshipSchemaSlug.make(target.slug),
										},
									],
								},
							],
							command(`policy-batch-${mode}`),
						).pipe(
							Effect.provideService(
								LifecycleExecution,
								withLifecycleDispatch({
									...execution,
									after: () => Effect.die("A rejected batch cannot dispatch after runs"),
									skipQueuedPolicies: (input) =>
										Effect.gen(function* () {
											expect(
												Option.isNone(yield* Effect.serviceOption(client.transactionService)),
											).toBe(true);
											cleanup.push(input.triggerId);
											yield* execution.skipQueuedPolicies(input);
										}),
									executePolicy: ({ runId }) =>
										Effect.gen(function* () {
											expect(
												Option.isNone(yield* Effect.serviceOption(client.transactionService)),
											).toBe(true);
											invoked.push(runId);
											const now = DateTime.toDate(DateTime.makeUnsafe("2026-09-15T00:00:01.000Z"));
											yield* attempts
												.claimNextAttempt({ now, runId, attemptNumber: 1 })
												.pipe(Effect.provideService(Database, db), Effect.orDie);
											if (invoked.length === 2 && mode === "failure") {
												yield* attempts
													.finalizeAttempt(
														{
															runId,
															logs: null,
															timing: null,
															attemptNumber: 1,
															status: "failed",
															returnedValue: null,
															failureKind: "sandbox-infrastructure",
															error: { message: "Policy failed", code: "policy-test-failure" },
														},
														now,
													)
													.pipe(Effect.provideService(Database, db), Effect.orDie);
												return yield* new AutomationPolicyExecutionError({
													runId,
													code: "policy-execution-failed",
												});
											}
											const output =
												invoked.length === 2
													? { reason: "Rejected", action: "reject" as const }
													: { action: "allow" as const };
											yield* attempts
												.finalizeAttempt(
													{
														runId,
														logs: null,
														error: null,
														timing: null,
														attemptNumber: 1,
														failureKind: null,
														status: "succeeded",
														returnedValue: output,
													},
													now,
												)
												.pipe(Effect.provideService(Database, db), Effect.orDie);
											return output;
										}),
								}),
							),
						),
					);
					const rejectingRunId = invoked[1];
					assert(
						rejectingRunId,
						Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "Expected the second policy to run",
					);
					assertExitFails(
						exit,
						new RelationshipBadRequest({
							reason: {
								runId: rejectingRunId,
								code: mode === "reject" ? "policy-rejected" : "policy-execution-failed",
							},
						}),
					);
					expect(invoked).toHaveLength(2);
					expect(new Set(cleanup).size).toBe(2);
					const rows = (yield* db.select().from(tables.automationRun)).filter(({ triggerId }) =>
						cleanup.includes(triggerId),
					);
					expect(rows.map(({ status }) => status).sort()).toEqual([
						mode === "reject" ? "rejected" : "failed",
						"skipped",
						"skipped",
						"skipped",
						"skipped",
						"succeeded",
					]);
					expect(
						rows
							.filter(({ status }) => status === "skipped")
							.every(({ attemptCount }) => attemptCount === 0),
					).toBe(true);
					expect(yield* db.select().from(tables.relationship)).toEqual([]);
				}
				expect(
					(yield* db.select().from(tables.automationTrigger)).every(
						({ category }) => category === "request",
					),
				).toBe(true);
			}),
		),
	);
	it.effect("rejects nested transaction entry before planning or source writes", () =>
		withRelationshipDatabase(() =>
			Effect.gen(function* () {
				const db = yield* Database;
				const service = yield* RelationshipsService;
				const exit = yield* Effect.exit(
					db.transaction((tx) =>
						service
							.create(baseInput, command("nested-entry"))
							.pipe(Effect.provideService(Database, tx)),
					),
				);
				assertExitFails(
					exit,
					new DbError({
						message: "Relationship lifecycle mutations require a root transaction boundary",
					}),
				);
				expect(yield* db.select().from(tables.relationship)).toEqual([]);
				expect(yield* db.select().from(tables.automationTrigger)).toEqual([]);
			}),
		),
	);
	it.effect(
		"commits pinned required and async runs with their source, rolling all three back on failure",
		() =>
			withRelationshipDatabase((observer) =>
				Effect.gen(function* () {
					const service = yield* RelationshipsService;
					const db = yield* Database;
					const planner = yield* LifecyclePlanner;
					const fixture = revisionPackage("relationship-hooks", "v1", "fixture");
					const target = fixture.manifest.relationshipSchemas[0];
					assert(target);
					const installed = yield* installRevisionPackage(
						{
							...fixture,
							manifest: {
								...fixture.manifest,
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
						relationshipSchemaPluginId: installed.pluginId,
						relationshipSchemaSlug: RelationshipSchemaSlug.make(target.slug),
					};
					const failed = yield* Effect.exit(
						service.create(input, command("runs")).pipe(
							Effect.provideService(
								LifecyclePlanner,
								withLifecycleBatchPlanning({
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
							),
						),
					);
					assertExitFails(failed, new DbError({ message: "Fail after run insertion" }));
					const execution = yield* LifecycleExecution;
					expect(yield* db.select().from(tables.relationship)).toEqual([]);
					expect(yield* db.select().from(tables.automationRun)).toEqual([]);
					const runCounts: number[] = [];
					yield* service.create(input, command("runs")).pipe(
						Effect.provideService(
							LifecycleExecution,
							withLifecycleDispatch({
								...execution,
								executePolicy: () => Effect.die("Unexpected policy"),
								after: ({ runs, triggerId }) =>
									Effect.gen(function* () {
										runCounts.push(runs.length);
										if (runs.length === 0) {
											return [];
										}
										const rows = yield* Effect.tryPromise(() =>
											observer.query(
												"select plugin_revision_id as revision from automation_run where trigger_id = $1",
												[triggerId],
											),
										).pipe(Effect.mapError(() => new DbError({ message: "Observer failed" })));
										expect(rows.rows).toEqual([
											{ revision: installed.revisionId },
											{ revision: installed.revisionId },
										]);
										return [];
									}),
							}),
						),
					);
					expect(runCounts).toEqual([2, 0]);
					expect(yield* db.select().from(tables.relationship)).toHaveLength(1);
					expect(yield* db.select().from(tables.automationRun)).toHaveLength(2);
					const config = yield* AppConfig;
					const limitedCommand = command("limited");
					const limited = yield* service
						.create(
							{ ...input, sourceEntityId: targetEntityId, targetEntityId: sourceEntityId },
							{ ...limitedCommand, causation: { ...limitedCommand.causation, depth: 1 } },
						)
						.pipe(
							Effect.provide(Layer.fresh(LifecyclePlannerLive)),
							Effect.provideService(AppConfig, {
								...config,
								automations: { ...config.automations, maxRuns: 1 },
							}),
						);
					const blocked = (yield* db.select().from(tables.automationTrigger)).find(
						({ blockedReason }) => blockedReason !== null,
					);
					assert(blocked);
					expect(limited.relationship?.wasInserted).toBe(true);
					expect(limited.warnings).toEqual([
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
					expect(yield* db.select().from(tables.relationship)).toHaveLength(2);
					expect(yield* db.select().from(tables.automationRun)).toHaveLength(2);
				}),
			),
	);
	it.effect(
		"persists exact create/update/delete snapshots, suppresses identical upserts, and verifies command replay",
		() =>
			withRelationshipDatabase(() =>
				Effect.gen(function* () {
					const service = yield* RelationshipsService;
					const db = yield* Database;
					const created = yield* service.create(baseInput, command("create"));
					assert(created.relationship);
					const [stored] = yield* db.select().from(tables.relationship);
					assert(stored);
					const expected = {
						id: stored.id,
						sourceEntityId,
						targetEntityId,
						relationshipSchemaSlug,
						properties: { rank: 1 },
						createdAt: stored.createdAt.toISOString(),
						updatedAt: stored.updatedAt.toISOString(),
					};
					expect(created).toMatchObject({
						warnings: [],
						relationship: { ...expected, wasInserted: true },
					});
					const noop = yield* service.create(baseInput, command("noop"));
					expect(noop.relationship?.wasInserted).toBe(false);
					expect(yield* db.select().from(tables.automationTrigger)).toHaveLength(3);
					expect(yield* service.create(baseInput, command("create"))).toEqual(created);
					const conflict = yield* Effect.exit(
						service.create({ ...baseInput, properties: { rank: 3 } }, command("create")),
					);
					assertExitFails(
						conflict,
						new RelationshipBadRequest({ reason: { code: "lifecycle-command-conflict" } }),
					);
					const updated = yield* service.create(
						{ ...baseInput, properties: { rank: 2 } },
						command("update"),
					);
					expect(updated.relationship).toMatchObject({
						id: stored.id,
						wasInserted: false,
						properties: { rank: 2 },
					});
					const [updatedRow] = yield* db.select().from(tables.relationship);
					assert(updatedRow);
					const updatedSnapshot = {
						...expected,
						properties: { rank: 2 },
						updatedAt: updatedRow.updatedAt.toISOString(),
					};
					expect(
						yield* service.create({ ...baseInput, properties: { rank: 2 } }, command("update")),
					).toEqual(updated);
					const deleted = yield* service.delete(baseInput, command("delete"));
					expect(yield* service.delete(baseInput, command("delete"))).toEqual(deleted);
					expect(yield* service.delete(baseInput, command("absent"))).toEqual({
						warnings: [],
						relationship: null,
					});
					expect(yield* db.select().from(tables.relationship)).toEqual([]);
					const triggers = yield* db.select().from(tables.automationTrigger);
					const changes = triggers.filter(
						({ category, operation }) => category === "change" && operation !== "batch",
					);
					for (const change of changes) {
						expect(triggers.find(({ id }) => id === change.parentTriggerId)).toMatchObject({
							category: "request",
							operation: change.operation,
						});
					}
					expect(changes.find(({ operation }) => operation === "create")?.payload).toEqual({
						after: expected,
						category: "change",
						operation: "create",
						resource: "relationship",
					});
					expect(changes).toHaveLength(3);
					expect(changes.find(({ operation }) => operation === "update")?.payload).toEqual({
						before: expected,
						category: "change",
						operation: "update",
						after: updatedSnapshot,
						resource: "relationship",
					});
					expect(changes.find(({ operation }) => operation === "delete")?.payload).toEqual({
						category: "change",
						operation: "delete",
						before: updatedSnapshot,
						resource: "relationship",
					});
				}),
			),
	);

	it.effect(
		"rolls back the whole batch and change triggers on planning failure, retaining request history",
		() =>
			withRelationshipDatabase(() =>
				Effect.gen(function* () {
					const planner = yield* LifecyclePlanner;
					const db = yield* Database;
					let changes = 0;
					const exit = yield* Effect.exit(
						changeUserRelationships(
							userId,
							[
								{
									deletes: [],
									creates: [
										baseInput,
										{
											...baseInput,
											sourceEntityId: targetEntityId,
											targetEntityId: sourceEntityId,
										},
									],
								},
							],
							command("batch-failure"),
						).pipe(
							Effect.provideService(
								LifecyclePlanner,
								withLifecycleBatchPlanning({
									plan: (input) =>
										Effect.gen(function* () {
											const result = yield* planner.plan(input);
											if (input.trigger.kind.category === "change" && ++changes === 2) {
												return yield* new DbError({ message: "Injected planning failure" });
											}
											return result;
										}),
								}),
							),
						),
					);
					assertExitFails(exit, new DbError({ message: "Injected planning failure" }));
					expect(yield* db.select().from(tables.relationship)).toEqual([]);
					expect(
						(yield* db.select().from(tables.automationTrigger)).map(({ category }) => category),
					).toEqual(["request", "request"]);
				}),
			),
	);

	it.effect(
		"calls after only after another connection sees committed source and trigger rows",
		() =>
			withRelationshipDatabase((observer) =>
				Effect.gen(function* () {
					const service = yield* RelationshipsService;
					const client = yield* PgClient.PgClient;
					const calls: string[] = [];
					const execution = yield* LifecycleExecution;
					yield* service.create(baseInput, command("commit")).pipe(
						Effect.provideService(
							LifecycleExecution,
							withLifecycleDispatch({
								...execution,
								executePolicy: () => Effect.die("Unexpected policy"),
								after: ({ triggerId }) =>
									Effect.gen(function* () {
										expect(
											Option.isNone(yield* Effect.serviceOption(client.transactionService)),
										).toBe(true);
										const observed = yield* Effect.tryPromise(() =>
											observer.query(
												"select (select count(*)::int from relationship) as relationships, (select count(*)::int from automation_trigger where id = $1) as triggers",
												[triggerId],
											),
										).pipe(Effect.mapError(() => new DbError({ message: "Observer failed" })));
										expect(observed.rows).toEqual([{ triggers: 1, relationships: 1 }]);
										calls.push(triggerId);
										return [];
									}),
							}),
						),
					);
					expect(calls).toHaveLength(2);
					const db = yield* Database;
					const nested = yield* Effect.exit(
						db.transaction((tx) =>
							service
								.delete(baseInput, command("nested"))
								.pipe(Effect.provideService(Database, tx)),
						),
					);
					assertExitFails(
						nested,
						new DbError({
							message: "Relationship lifecycle mutations require a root transaction boundary",
						}),
					);
					expect(yield* db.select().from(tables.relationship)).toHaveLength(1);
				}),
			),
	);

	it.effect(
		"chains policy drafts, preserves trusted identity, and validates final properties outside transactions",
		() =>
			withRelationshipDatabase(() =>
				Effect.gen(function* () {
					const planner = yield* LifecyclePlanner;
					const client = yield* PgClient.PgClient;
					const service = yield* RelationshipsService;
					const seen: unknown[] = [];
					const execution = yield* LifecycleExecution;
					const result = yield* service.create(baseInput, command("policies")).pipe(
						Effect.provideService(
							LifecyclePlanner,
							withLifecycleBatchPlanning({
								plan: (input) =>
									planner.plan(input).pipe(
										Effect.map((plan) =>
											input.trigger.kind.category === "request"
												? {
														...plan,
														policies: [
															{ position: 1, runId: AutomationRunId.make("first") },
															{ position: 2, runId: AutomationRunId.make("second") },
														],
													}
												: plan,
										),
									),
							}),
						),
						Effect.provideService(
							LifecycleExecution,
							withLifecycleDispatch({
								...execution,
								after: () => Effect.succeed([]),
								executePolicy: ({ runId, payload }) =>
									Effect.gen(function* () {
										expect(
											Option.isNone(yield* Effect.serviceOption(client.transactionService)),
										).toBe(true);
										assert(payload.resource === "relationship" && payload.operation === "create");
										seen.push(payload.draft);
										return {
											action: "transform" as const,
											payload: {
												...payload,
												draft: {
													...payload.draft,
													sourceEntityId: EntityId.make("untrusted"),
													properties: { rank: runId === "first" ? 2 : 3 },
												},
											},
										};
									}),
							}),
						),
					);
					expect(seen).toEqual([
						{ sourceEntityId, targetEntityId, relationshipSchemaSlug, properties: { rank: 1 } },
						{ sourceEntityId, targetEntityId, relationshipSchemaSlug, properties: { rank: 2 } },
					]);
					expect(result.relationship).toMatchObject({
						sourceEntityId,
						targetEntityId,
						properties: { rank: 3 },
					});
				}),
			),
	);

	it.effect("detects writes made during policy execution without overwriting them", () =>
		withRelationshipDatabase(() =>
			Effect.gen(function* () {
				const service = yield* RelationshipsService;
				const repository = yield* RelationshipsRepository;
				const planner = yield* LifecyclePlanner;
				const database = yield* Database;
				const execution = yield* LifecycleExecution;
				yield* service.create(baseInput, command("seed"));
				const exit = yield* Effect.exit(
					service
						.update({ ...baseInput, properties: { rank: 2 } }, command("stale"))
						.pipe(
							Effect.provideService(
								LifecyclePlanner,
								withLifecycleBatchPlanning({
									plan: (input) =>
										planner
											.plan(input)
											.pipe(
												Effect.map((plan) =>
													input.trigger.kind.category === "request"
														? {
																...plan,
																policies: [
																	{ position: 1, runId: AutomationRunId.make("concurrent") },
																],
															}
														: plan,
												),
											),
								}),
							),
							Effect.provideService(
								LifecycleExecution,
								withLifecycleDispatch({
									...execution,
									after: () => Effect.succeed([]),
									executePolicy: () =>
										repository
											.updateRelationship({ ...baseInput, properties: { rank: 9 } })
											.pipe(
												Effect.provideService(Database, database),
												Effect.as({ action: "allow" as const }),
												Effect.orDie,
											),
								}),
							),
						),
				);
				assertExitFails(
					exit,
					new RelationshipBadRequest({ reason: { code: "concurrent-relationship-change" } }),
				);
				expect((yield* repository.findRelationship(baseInput))?.properties).toEqual({ rank: 9 });
			}),
		),
	);

	it.effect("preserves batch counts and warnings through the host-owned mutation path", () =>
		withRelationshipDatabase(() =>
			Effect.gen(function* () {
				const service = yield* RelationshipsService;
				const db = yield* Database;
				yield* service.createUser(userId, baseInput, command("api"));
				const execution = yield* LifecycleExecution;
				const warning = {
					code: "required-hook-pending" as const,
					runId: AutomationRunId.make("pending"),
					hookSlug: AutomationHookSlug.make("required"),
				};
				const root = command("host");
				const child = {
					...root,
					causation: {
						...root.causation,
						depth: 1,
						source: "automation" as const,
						parentRunId: AutomationRunId.make("parent-run"),
						parentTriggerId: AutomationTriggerId.make("parent-trigger"),
						rootExecutionId: AutomationExecutionId.make("root-execution"),
					},
				};
				const batches = [
					{
						deletes: [],
						creates: [
							{ ...baseInput, properties: { rank: 4 } },
							{ ...baseInput, sourceEntityId: targetEntityId, targetEntityId: sourceEntityId },
						],
					},
				];
				const result = yield* changeUserRelationships(userId, batches, child).pipe(
					Effect.provideService(
						LifecycleExecution,
						withLifecycleDispatch({
							...execution,
							after: () => Effect.succeed([warning]),
							executePolicy: () => Effect.die("Unexpected policy"),
						}),
					),
				);
				expect(result).toEqual([
					{ created: 1, updated: 1, deleted: 0, warnings: [warning, warning, warning] },
				]);
				expect(
					yield* changeUserRelationships(userId, batches, child).pipe(
						Effect.provideService(
							LifecycleExecution,
							withLifecycleDispatch({ ...execution, after: () => Effect.succeed([warning]) }),
						),
					),
				).toEqual([{ created: 0, updated: 0, deleted: 0, warnings: [warning, warning, warning] }]);
				const changes = yield* db
					.select()
					.from(tables.automationTrigger)
					.where(eq(tables.automationTrigger.category, "change"));
				expect(changes.map(({ operation }) => operation).sort()).toEqual([
					"batch",
					"batch",
					"create",
					"create",
					"update",
				]);
				expect(changes.every(({ payload }) => payload?.resource === "relationship")).toBe(true);
				const hostRequests = (yield* db
					.select()
					.from(tables.automationTrigger)
					.where(eq(tables.automationTrigger.category, "request"))).filter(
					({ executionId }) => executionId === "host",
				);
				expect(
					hostRequests.map(({ depth, source, parentRunId, parentTriggerId, rootExecutionId }) => ({
						depth,
						source,
						parentRunId,
						parentTriggerId,
						rootExecutionId,
					})),
				).toEqual(
					Array.from({ length: 2 }, () => ({
						depth: 1,
						source: "automation",
						parentRunId: "parent-run",
						parentTriggerId: "parent-trigger",
						rootExecutionId: "root-execution",
					})),
				);
				expect(
					changes
						.filter(({ operation, executionId }) => executionId === "host" && operation !== "batch")
						.map(
							({ depth, source, occurredAt, parentRunId, parentTriggerId, rootExecutionId }) => ({
								depth,
								source,
								parentRunId,
								rootExecutionId,
								occurredAt: occurredAt.toISOString(),
								parentIsOwnRequest: hostRequests.some(({ id }) => id === parentTriggerId),
							}),
						),
				).toEqual(
					Array.from({ length: 2 }, () => ({
						depth: 1,
						source: "automation",
						parentIsOwnRequest: true,
						parentRunId: "parent-run",
						occurredAt: child.occurredAt,
						rootExecutionId: "root-execution",
					})),
				);
			}),
		),
	);

	it.effect(
		"retains request history on policy rejection, invalid transforms, and planning limits",
		() =>
			withRelationshipDatabase(() =>
				Effect.gen(function* () {
					const service = yield* RelationshipsService;
					const planner = yield* LifecyclePlanner;
					const db = yield* Database;
					for (const mode of ["reject", "invalid", "limit"] as const) {
						const execution = yield* LifecycleExecution;
						const exit = yield* Effect.exit(
							service.create(baseInput, command(mode)).pipe(
								Effect.provideService(
									LifecyclePlanner,
									withLifecycleBatchPlanning({
										plan: (input) =>
											planner
												.plan(input)
												.pipe(
													Effect.map((plan) => ({
														...plan,
														policies: [{ position: 1, runId: AutomationRunId.make(mode) }],
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
													})),
												),
									}),
								),
								Effect.provideService(
									LifecycleExecution,
									withLifecycleDispatch({
										...execution,
										after: () => Effect.die("A rejected write cannot dispatch"),
										executePolicy: ({ payload }) => {
											assert(payload.resource === "relationship" && payload.operation === "create");
											return Effect.succeed(
												mode === "reject"
													? { reason: "Rejected", action: "reject" as const }
													: {
															action: "transform" as const,
															payload: {
																...payload,
																draft: { ...payload.draft, properties: { rank: "invalid" } },
															},
														},
											);
										},
									}),
								),
							),
						);
						switch (mode) {
							case "reject":
								assertExitFails(
									exit,
									new RelationshipBadRequest({
										reason: { code: "policy-rejected", runId: AutomationRunId.make(mode) },
									}),
								);
								break;
							case "limit":
								assertExitFails(
									exit,
									new RelationshipBadRequest({ reason: { code: "automation-limit-reached" } }),
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
					expect(yield* db.select().from(tables.relationship)).toEqual([]);
					expect(
						(yield* db.select().from(tables.automationTrigger)).map(({ category }) => category),
					).toEqual(["request", "request", "request"]);
				}),
			),
	);

	it.effect(
		"uses immutable row-specific population batches and preserves reconciliation counts",
		() =>
			withRelationshipDatabase(() =>
				Effect.gen(function* () {
					const service = yield* RelationshipsService;
					const db = yield* Database;
					const population = {
						rootPreviouslyPopulated: true,
						scopeEntity: {
							name: "Source",
							id: sourceEntityId,
							entitySchemaSlug: EntitySchemaSlug.make("fixture"),
						},
						batch: {
							afterCount: 99,
							isLeader: true,
							beforeCount: 99,
							createdCount: 99,
							updatedCount: 99,
							deletedCount: 99,
							id: "population-batch",
						},
					};
					const group = {
						relationshipSchemaSlug,
						selector: { type: "self" as const },
						relationships: [
							{ sourceEntityId, properties: { rank: 1 }, targetEntityId: sourceEntityId },
							{ targetEntityId, properties: { rank: 2 }, sourceEntityId: targetEntityId },
						],
					};
					expect(
						yield* service.reconcileGlobal([group], { ...command("population"), population }),
					).toEqual([{ created: 2, updated: 0, deleted: 0, upserted: 2, warnings: [] }]);
					const changes = (yield* db.select().from(tables.automationTrigger)).filter(
						({ category, operation }) => category === "change" && operation !== "batch",
					);
					expect(
						changes.map(({ payload }) =>
							payload && "population" in payload ? payload.population?.batch : null,
						),
					).toEqual([
						{
							afterCount: 2,
							beforeCount: 0,
							isLeader: true,
							createdCount: 2,
							updatedCount: 0,
							deletedCount: 0,
							id: "population-batch",
						},
						{
							afterCount: 2,
							beforeCount: 0,
							createdCount: 2,
							updatedCount: 0,
							deletedCount: 0,
							isLeader: false,
							id: "population-batch",
						},
					]);
					expect(population.batch.createdCount).toBe(99);
					expect(
						yield* service.reconcileGlobal(
							[
								{
									...group,
									relationships: [
										{ sourceEntityId, properties: { rank: 3 }, targetEntityId: sourceEntityId },
									],
								},
							],
							command("reconcile"),
						),
					).toEqual([{ created: 0, updated: 1, deleted: 1, upserted: 1, warnings: [] }]);
				}),
			),
	);

	it.effect("requires an active transaction and rejects unprepared reconciliation policies", () =>
		withRelationshipDatabase(() =>
			Effect.gen(function* () {
				const db = yield* Database;
				const planner = yield* LifecyclePlanner;
				const service = yield* RelationshipsService;
				const policyService = yield* RelationshipsService.make.pipe(
					Effect.provideService(
						LifecyclePlanner,
						withLifecycleBatchPlanning({
							plan: (input) =>
								planner
									.plan(input)
									.pipe(
										Effect.map((plan) => ({
											...plan,
											policies: [{ position: 1, runId: AutomationRunId.make("policy") }],
										})),
									),
						}),
					),
				);
				const groups = [
					{
						relationshipSchemaSlug,
						relationships: [{ sourceEntityId, targetEntityId, properties: { rank: 1 } }],
						selector: {
							type: "anchored" as const,
							direction: "outgoing" as const,
							anchorEntityId: sourceEntityId,
						},
					},
				];
				expect(
					yield* service
						.persistPlannedReconciliation(groups, command("outside"), { scope: "global" })
						.pipe(Effect.flip),
				).toMatchObject({ code: "active-transaction-required" });
				const error = yield* db
					.transaction((tx) =>
						policyService
							.persistPlannedReconciliation(groups, command("policy"), { scope: "global" })
							.pipe(Effect.provideService(Database, tx)),
					)
					.pipe(Effect.flip);
				expect(error).toMatchObject({ code: "before-policy-requires-owner" });
				expect(yield* db.select().from(tables.relationship)).toEqual([]);
				expect(yield* db.select().from(tables.automationTrigger)).toEqual([]);
			}),
		),
	);

	it.effect(
		"keeps provider entities, relationships, triggers, and runs in one caller transaction",
		() =>
			withRelationshipDatabase((observer) =>
				Effect.gen(function* () {
					const db = yield* Database;
					const entities = yield* EntitiesService;
					const relationships = yield* RelationshipsService;
					const providerId = SandboxProviderId.make("group-provider");
					const groupRelationshipSchemaSlug = RelationshipSchemaSlug.make("group-link");
					const fixture = revisionPackage("group-lifecycle", "v1", "group-fixture");
					const automation = fixture.manifest.scripts.find(
						(script) => script.kind === "automation",
					);
					assert(automation?.kind === "automation");
					yield* db
						.insert(tables.user)
						.values({
							id: "owner",
							preferences: {},
							name: "Plugin owner",
							email: "plugin-owner@example.test",
						});
					yield* installRevisionPackage({
						...fixture,
						manifest: {
							...fixture.manifest,
							relationshipSchemas: fixture.manifest.relationshipSchemas.map((schema) => ({
								...schema,
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
										{ resource: "entity", operation: "create", entitySchemaSlug: "group-fixture" },
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
					yield* db
						.insert(tables.plugin)
						.values({
							slug: "group",
							scope: "system",
							status: "disabled",
							id: "group-provider-plugin",
						});
					yield* db
						.insert(tables.sandboxProvider)
						.values({
							id: providerId,
							name: "Group provider",
							slug: "group-provider",
							pluginId: "group-provider-plugin",
							information: { source: "fixture" },
							rootEntitySchemaSlug: "group-fixture",
						});

					const persistGroup = (id: string, rollback: boolean) =>
						db.transaction((tx) =>
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
									entitySchemaSlug: EntitySchemaSlug.make("group-fixture"),
								});
								const relationshipWork = yield* relationships.persistPlannedReconciliation(
									[
										{
											relationshipSchemaSlug: groupRelationshipSchemaSlug,
											selector: {
												type: "anchored",
												direction: "outgoing",
												anchorEntityId: sourceEntityId,
											},
											relationships: [
												{
													sourceEntityId,
													properties: { rank: 1 },
													targetEntityId: entityWork.result.entity.id,
												},
											],
										},
									],
									command(`${id}-relationship`),
									{ scope: "global" },
								);
								expect(yield* tx.select().from(tables.relationship)).toHaveLength(1);
								expect(yield* tx.select().from(tables.automationTrigger)).toHaveLength(6);
								expect(yield* tx.select().from(tables.automationRun)).toHaveLength(2);
								const invisible = yield* Effect.tryPromise(() =>
									observer.query(
										"select (select count(*)::int from relationship) as relationships, (select count(*)::int from automation_trigger) as triggers, (select count(*)::int from automation_run) as runs",
									),
								).pipe(Effect.mapError(() => new DbError({ message: "Observer failed" })));
								expect(invisible.rows).toEqual([{ runs: 0, triggers: 0, relationships: 0 }]);
								if (rollback) {
									return yield* new DbError({ message: "Rollback provider group" });
								}
								return { entityPlans: entityWork.plans, relationshipPlans: relationshipWork.plans };
							}).pipe(Effect.provideService(Database, tx)),
						);

					expect(yield* persistGroup("rollback", true).pipe(Effect.flip)).toMatchObject({
						message: "Rollback provider group",
					});
					expect(yield* db.select().from(tables.relationship)).toEqual([]);
					expect(yield* db.select().from(tables.automationTrigger)).toEqual([]);
					expect(yield* db.select().from(tables.automationRun)).toEqual([]);
					expect((yield* db.select().from(tables.entity)).map(({ id }) => id).sort()).toEqual(
						[sourceEntityId, targetEntityId].sort(),
					);

					const work = yield* persistGroup("commit", false);
					const visible = yield* Effect.tryPromise(() =>
						observer.query(
							"select (select count(*)::int from entity) as entities, (select count(*)::int from relationship) as relationships, (select count(*)::int from automation_trigger) as triggers, (select count(*)::int from automation_run) as runs",
						),
					).pipe(Effect.mapError(() => new DbError({ message: "Observer failed" })));
					expect(visible.rows).toEqual([{ runs: 2, entities: 3, triggers: 6, relationships: 1 }]);
					expect([...work.entityPlans, ...work.relationshipPlans]).toHaveLength(4);
				}),
			),
	);

	it.effect("reconciles private user relationships atomically without crossing owners", () =>
		withRelationshipDatabase(() =>
			Effect.gen(function* () {
				const db = yield* Database;
				const repository = yield* RelationshipsRepository;
				const relationships = yield* RelationshipsService;
				const otherUserId = UserId.make("other-relationship-owner");
				const foreignEntityId = EntityId.make("foreign-user-entity");
				const privateSchemaSlug = RelationshipSchemaSlug.make("private-reconciliation-link");
				yield* db
					.insert(tables.user)
					.values({
						id: otherUserId,
						preferences: {},
						name: "Other owner",
						email: "other-relationship@example.test",
					});
				yield* db
					.insert(tables.entity)
					.values({
						properties: {},
						userId: otherUserId,
						id: foreignEntityId,
						name: "Foreign entity",
						entitySchemaSlug: "fixture",
					});
				const fixture = revisionPackage("private-reconciliation", "v1", "fixture");
				const automation = fixture.manifest.scripts.find((script) => script.kind === "automation");
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
				const group = {
					relationshipSchemaSlug: privateSchemaSlug,
					relationships: [{ sourceEntityId, targetEntityId, properties: {} }],
					selector: {
						type: "anchored" as const,
						direction: "outgoing" as const,
						anchorEntityId: sourceEntityId,
					},
				};
				yield* repository.createRelationship({
					scope: "user",
					properties: {},
					sourceEntityId,
					targetEntityId,
					userId: otherUserId,
					relationshipSchemaSlug: privateSchemaSlug,
					relationshipSchemaPluginId: installed.pluginId,
				});

				const rollback = yield* db
					.transaction((tx) =>
						Effect.gen(function* () {
							yield* relationships.persistPlannedReconciliation(
								[group],
								command("private-rollback"),
								{ userId, scope: "user" },
							);
							expect(yield* tx.select().from(tables.automationTrigger)).toHaveLength(3);
							expect(yield* tx.select().from(tables.automationRun)).toHaveLength(1);
							return yield* new DbError({ message: "Rollback private reconciliation" });
						}).pipe(Effect.provideService(Database, tx)),
					)
					.pipe(Effect.flip);
				expect(rollback).toMatchObject({ message: "Rollback private reconciliation" });
				expect(yield* db.select().from(tables.automationTrigger)).toEqual([]);
				expect(yield* db.select().from(tables.automationRun)).toEqual([]);
				expect(
					(yield* db.select().from(tables.relationship)).map(
						({ userId: relationshipUserId }) => relationshipUserId,
					),
				).toEqual([otherUserId]);

				const inaccessible = yield* db
					.transaction((tx) =>
						relationships
							.persistPlannedReconciliation(
								[
									{
										...group,
										relationships: [
											{ sourceEntityId, properties: {}, targetEntityId: foreignEntityId },
										],
									},
								],
								command("private-foreign-entity"),
								{ userId, scope: "user" },
							)
							.pipe(Effect.provideService(Database, tx)),
					)
					.pipe(Effect.flip);
				expect(inaccessible).toMatchObject({ reason: { code: "entity-not-found" } });

				const work = yield* db.transaction((tx) =>
					relationships
						.persistPlannedReconciliation([group], command("private-commit"), {
							userId,
							scope: "user",
						})
						.pipe(Effect.provideService(Database, tx)),
				);
				expect(work.result).toEqual([{ created: 1, updated: 0, deleted: 0, upserted: 1 }]);
				expect(work.plans.map(({ trigger }) => trigger.kind.operation)).toEqual([
					"create",
					"batch",
				]);
				expect(
					(yield* db.select().from(tables.automationTrigger)).map(({ scopeUserId }) => scopeUserId),
				).toEqual([userId, userId, userId]);
				expect(
					(yield* db.select().from(tables.automationRun)).map(
						({ executionUserId }) => executionUserId,
					),
				).toEqual([userId]);
				const foreignOwner = yield* db
					.transaction((tx) =>
						relationships
							.persistPlannedReconciliation([group], command("private-other-owner"), {
								scope: "user",
								userId: otherUserId,
							})
							.pipe(Effect.provideService(Database, tx)),
					)
					.pipe(Effect.flip);
				expect(foreignOwner).toMatchObject({ reason: { code: "relationship-schema-not-found" } });

				expect(
					yield* db.transaction((tx) =>
						relationships
							.persistPlannedReconciliation(
								[{ ...group, relationships: [] }],
								command("private-delete"),
								{ userId, scope: "user" },
							)
							.pipe(Effect.provideService(Database, tx)),
					),
				).toMatchObject({ result: [{ created: 0, updated: 0, deleted: 1, upserted: 0 }] });
				expect(
					(yield* db.select().from(tables.relationship)).map(
						({ userId: relationshipUserId }) => relationshipUserId,
					),
				).toEqual([otherUserId]);
			}),
		),
	);

	it.effect("keeps prepared user relationship changes in the caller transaction", () =>
		withRelationshipDatabase(() =>
			Effect.gen(function* () {
				const db = yield* Database;
				const client = yield* PgClient.PgClient;
				const service = yield* RelationshipsService;
				const repository = yield* RelationshipsRepository;
				const planner = yield* LifecyclePlanner;
				const execution = yield* LifecycleExecution;

				yield* repository.createRelationship(baseInput);
				const stale = yield* service.prepareUserDelete(baseInput, command("prepared-stale"));
				assert(stale);
				yield* repository.updateRelationship({ ...baseInput, properties: { rank: 9 } });
				expect(
					yield* db
						.transaction((tx) =>
							service.persistPreparedUserDelete(stale).pipe(Effect.provideService(Database, tx)),
						)
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
				const creation = yield* service.prepareUserCreate(createInput, command("prepared-create"));
				assert(deletion);
				assert(creation);
				expect(yield* service.persistPreparedUserCreate(creation).pipe(Effect.flip)).toMatchObject({
					code: "active-transaction-required",
				});
				expect(
					yield* db
						.transaction((tx) =>
							Effect.gen(function* () {
								yield* service.persistPreparedUserDelete(deletion);
								yield* service.persistPreparedUserCreate(creation);
								const changes = (yield* tx.select().from(tables.automationTrigger)).filter(
									({ category }) => category === "change",
								);
								expect(changes).toHaveLength(2);
								return yield* new DbError({ message: "Rollback prepared relationships" });
							}).pipe(Effect.provideService(Database, tx)),
						)
						.pipe(Effect.flip),
				).toMatchObject({ message: "Rollback prepared relationships" });
				expect(yield* repository.findRelationship(deletionInput)).not.toBeNull();
				expect(yield* repository.findRelationship(createInput)).toBeNull();
				expect(
					(yield* db.select().from(tables.automationTrigger)).filter(
						({ category }) => category === "change",
					),
				).toEqual([]);

				const work = yield* db.transaction((tx) =>
					service.persistPreparedUserCreate(creation).pipe(Effect.provideService(Database, tx)),
				);
				expect(work.plans).toHaveLength(1);

				const rejectedInput = { ...baseInput, targetEntityId, sourceEntityId: targetEntityId };
				yield* repository.createRelationship(rejectedInput);
				const rejectingService = yield* RelationshipsService.make.pipe(
					Effect.provideService(
						LifecyclePlanner,
						withLifecycleBatchPlanning({
							plan: (input) =>
								planner
									.plan(input)
									.pipe(
										Effect.map((plan) => ({
											...plan,
											policies: [
												{ position: 1, runId: AutomationRunId.make("reject-relationship") },
											],
										})),
									),
						}),
					),
					Effect.provideService(
						LifecycleExecution,
						withLifecycleDispatch({
							...execution,
							executePolicy: () =>
								Effect.gen(function* () {
									expect(
										Option.isNone(yield* Effect.serviceOption(client.transactionService)),
									).toBe(true);
									return { reason: "Rejected", action: "reject" as const };
								}),
						}),
					),
				);
				const rejected = yield* rejectingService
					.prepareUserDelete(rejectedInput, command("prepared-rejected"))
					.pipe(Effect.flip);
				expect(rejected).toMatchObject({ reason: { code: "policy-rejected" } });
				expect(yield* repository.findRelationship(rejectedInput)).not.toBeNull();
			}),
		),
	);
});
