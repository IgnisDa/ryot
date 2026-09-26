import { expect, layer } from "@effect/vitest";
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
import { Cause, DateTime, Effect, Exit } from "effect";
import { assert, describe } from "vitest";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import {
	AutomationPolicyExecutionError,
	LifecycleExecution,
} from "#lib/domain/lifecycle-execution";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { assertExitFails } from "#lib/test-utils/assertions";
import { AutomationAttemptRepository } from "#modules/automations/attempt-repository";
import {
	withLifecycleBatchPlanning,
	withLifecycleDispatch,
} from "#modules/automations/lifecycle.test-support";
import { EntitiesService } from "#modules/entities/service";
import { installRevisionPackage, revisionPackage } from "#modules/plugins/revision.test-support";

import {
	baseInput,
	command,
	propertiesSchema,
	relationshipSchemaSlug,
	sourceEntityId,
	targetEntityId,
	userId,
	relationshipDatabaseLayer,
	RelationshipFixture,
	relationshipsServiceWith,
} from "./lifecycle.test-support";
import { RelationshipsRepository } from "./repository";
import { RelationshipsService } from "./service";

const installPolicyFixture = Effect.fn(function* (owner: UserId | null = userId) {
	const fixture = revisionPackage(
		"relationship-policy-scope",
		"v1",
		owner === null ? "global-policy-entity" : "fixture",
	);
	const script = fixture.scripts.find(({ metadata }) => metadata.kind === "automation");
	const schema = fixture.manifest.relationshipSchemas[0];
	assert(script?.metadata.kind === "automation" && schema);
	const policy = {
		...script,
		slug: "relationship-policy-scope.policy",
		contentHash: "relationship-policy-scope-hash",
		metadata: {
			...script.metadata,
			capabilities: [],
			automationType: "policy" as const,
			slug: "relationship-policy-scope.policy",
			inputProjection: { relationship: { properties: ["rank"] } },
		},
	};
	const installed = yield* installRevisionPackage(
		{
			...fixture,
			scripts: [...fixture.scripts, policy],
			manifest: {
				...fixture.manifest,
				scripts: [
					...fixture.manifest.scripts,
					{ ...policy.metadata, entry: "backend/policy.sandbox.ts" },
				],
				relationshipSchemas: [
					{
						...schema,
						propertiesSchema,
						sourceEntitySchemaSlug: null,
						targetEntitySchemaSlug: null,
					},
				],
				hooks: [
					...fixture.manifest.hooks,
					...(["create", "update", "delete"] as const).map((operation) => ({
						scriptSlug: policy.slug,
						stage: "before" as const,
						slug: `policy-${operation}`,
						name: `Policy ${operation}`,
						targets: [
							{ operation, resource: "relationship" as const, relationshipSchemaSlug: schema.slug },
						],
					})),
				],
			},
		},
		owner,
	);
	return {
		...baseInput,
		relationshipSchemaPluginId: installed.pluginId,
		relationshipSchemaSlug: RelationshipSchemaSlug.make(schema.slug),
	};
});

describe("Relationships lifecycle owner", () => {
	layer(relationshipDatabaseLayer())((test) => {
		test.effect("uses the active relationship schema", () =>
			Effect.gen(function* () {
				const service = yield* RelationshipsService;
				expect(
					yield* service
						.create({ ...baseInput, properties: { rank: "invalid" } }, command("active-schema"))
						.pipe(Effect.flip),
				).toMatchObject({ reason: { code: "invalid-properties" } });
			}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
		test.effect("commits a no-hook relationship and receipt in the prepare transaction", () =>
			Effect.gen(function* () {
				const service = yield* RelationshipsService;
				const session = yield* DatabaseSession;
				const fast = yield* service.prepareCreate(baseInput, command("step-fast"));
				assert(fast._tag === "Committed");
				expect(fast.result.relationship?.wasInserted).toBe(true);
				expect(fast.dispatch).toEqual([]);
				expect(yield* session.run((db) => db.select().from(tables.relationship))).toHaveLength(1);
				expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual([]);
				expect(
					(yield* session.run((db) => db.select().from(tables.mutationReceipt))).filter(
						({ receiptType }) => receiptType === "item",
					),
				).toHaveLength(1);
			}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
		test.effect("rejects caller relationship schema provenance that differs from the catalog", () =>
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
		);
	});

	layer(relationshipDatabaseLayer({ omitSchemaBeforeWrite: true }))((test) => {
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
		);
	});

	layer(relationshipDatabaseLayer({ activateSchemaOnWrite: true }))((test) => {
		test.effect("revalidates the relationship schema under the catalog lock before writing", () =>
			Effect.gen(function* () {
				const service = yield* RelationshipsService;
				const session = yield* DatabaseSession;
				expect(
					yield* service.createUser(userId, baseInput, command("schema-race")).pipe(Effect.flip),
				).toEqual(
					new RelationshipBadRequest({ reason: { code: "concurrent-relationship-change" } }),
				);
				expect(yield* session.run((db) => db.select().from(tables.relationship))).toEqual([]);
			}),
		);
	});

	layer(relationshipDatabaseLayer({ mutableRelationshipSchema: true }))((test) => {
		test.effect("replays a committed relationship after its schema is updated or disabled", () =>
			Effect.gen(function* () {
				const catalog = yield* RelationshipFixture;
				const service = yield* RelationshipsService;
				const session = yield* DatabaseSession;
				const lifecycle = command("schema-replay");
				const created = yield* service.create(baseInput, lifecycle);
				yield* catalog.updateRelationshipSchema;
				expect(yield* service.create(baseInput, lifecycle)).toEqual(created);
				yield* catalog.disableRelationshipSchema;
				expect(yield* service.create(baseInput, lifecycle)).toEqual(created);
				const [relationships, triggers] = yield* session.run((db) =>
					Effect.all([
						db.select().from(tables.relationship),
						db.select().from(tables.automationTrigger),
					]),
				);
				expect(relationships).toHaveLength(1);
				expect(triggers).toEqual([]);
			}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
		test.effect("replays no-hook merge, update, and delete by ID without automation history", () =>
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
				expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual([]);
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
							accountGeneration: "test-account-generation",
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
		);
	});
	layer(relationshipDatabaseLayer())((test) => {
		test.effect(
			"closes unstarted policies across the batch after rejection or execution failure",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
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
							capabilities: [],
							automationType: "policy" as const,
							slug: "relationship-policies.policy",
							inputProjection: { relationship: { properties: ["rank"] } },
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
							(yield* relationshipsServiceWith({
								execution: withLifecycleDispatch({
									...execution,
									after: () => Effect.die("A rejected batch cannot dispatch after runs"),
									skipQueuedPolicies: (input) =>
										Effect.gen(function* () {
											expect(!(yield* session.isTransactionActive)).toBe(true);
											cleanup.push(input.triggerId);
											yield* execution.skipQueuedPolicies(input);
										}),
									executePolicy: ({ runId }) =>
										Effect.gen(function* () {
											expect(!(yield* session.isTransactionActive)).toBe(true);
											invoked.push(runId);
											const now = DateTime.toDate(DateTime.makeUnsafe("2026-09-15T00:00:01.000Z"));
											yield* attempts
												.claimNextAttempt({ now, runId, attemptNumber: 1 })
												.pipe(Effect.orDie);
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
													.pipe(Effect.orDie);
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
												.pipe(Effect.orDie);
											return output;
										}),
								}),
							})).changeUser(
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
						const rows = (yield* session.run((db) =>
							db.select().from(tables.automationRun),
						)).filter(({ triggerId }) => cleanup.includes(triggerId));
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
						expect(yield* session.run((db) => db.select().from(tables.relationship))).toEqual([]);
					}
					expect(
						(yield* session.run((db) => db.select().from(tables.automationTrigger))).every(
							({ category }) => category === "request",
						),
					).toBe(true);
				}),
		);
	});
	layer(relationshipDatabaseLayer())((test) => {
		test.effect("rejects nested transaction entry before planning or source writes", () =>
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
		);
	});
	layer(relationshipDatabaseLayer())((test) => {
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
						{ ...input, sourceEntityId: targetEntityId, targetEntityId: sourceEntityId },
						{ ...limitedCommand, causation: { ...limitedCommand.causation, depth: 1 } },
					);
					const blocked = (yield* session.run((db) =>
						db.select().from(tables.automationTrigger),
					)).find(({ blockedReason }) => blockedReason !== null);
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
					const [limitedRelationships, limitedRuns] = yield* session.run((db) =>
						Effect.all([
							db.select().from(tables.relationship),
							db.select().from(tables.automationRun),
						]),
					);
					expect(limitedRelationships).toHaveLength(2);
					expect(limitedRuns).toHaveLength(2);
				}),
		);
	});
	layer(relationshipDatabaseLayer())((test) => {
		test.effect("replays create, update, delete, and no-op results without hook snapshots", () =>
			Effect.gen(function* () {
				const service = yield* RelationshipsService;
				const session = yield* DatabaseSession;
				const created = yield* service.create(baseInput, command("create"));
				assert(created.relationship);
				const [stored] = yield* session.run((db) => db.select().from(tables.relationship));
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
				expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual([]);
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
				expect(
					yield* service.create({ ...baseInput, properties: { rank: 2 } }, command("update")),
				).toEqual(updated);
				const deleted = yield* service.delete(baseInput, command("delete"));
				expect(yield* service.delete(baseInput, command("delete"))).toEqual(deleted);
				expect(yield* service.delete(baseInput, command("absent"))).toEqual({
					warnings: [],
					relationship: null,
				});
				const [relationships, triggers] = yield* session.run((db) =>
					Effect.all([
						db.select().from(tables.relationship),
						db.select().from(tables.automationTrigger),
					]),
				);
				expect(relationships).toEqual([]);
				expect(triggers).toEqual([]);
				expect(
					(yield* session.run((db) => db.select().from(tables.mutationReceipt))).some(
						({ receiptType }) => receiptType === "item",
					),
				).toBe(true);
			}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
		test.effect("rolls back the no-policy batch and receipts on planning failure", () =>
			Effect.gen(function* () {
				const planner = yield* LifecyclePlanner;
				const session = yield* DatabaseSession;
				let changes = 0;
				const exit = yield* Effect.exit(
					(yield* relationshipsServiceWith({
						planner: withLifecycleBatchPlanning({
							plan: (input) =>
								Effect.gen(function* () {
									const result = yield* planner.plan(input);
									if (input.trigger.kind.category === "change" && ++changes === 2) {
										return yield* new DbError({ message: "Injected planning failure" });
									}
									return result;
								}),
						}),
					})).changeUser(
						userId,
						[
							{
								deletes: [],
								creates: [
									baseInput,
									{ ...baseInput, sourceEntityId: targetEntityId, targetEntityId: sourceEntityId },
								],
							},
						],
						command("batch-failure"),
					),
				);
				assertExitFails(exit, new DbError({ message: "Injected planning failure" }));
				expect(yield* session.run((db) => db.select().from(tables.relationship))).toEqual([]);
				expect(
					(yield* session.run((db) => db.select().from(tables.automationTrigger))).map(
						({ category }) => category,
					),
				).toEqual([]);
			}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
		test.effect("does not dispatch no-hook writes and rejects a nested transaction", () =>
			Effect.gen(function* () {
				const service = yield* RelationshipsService;
				const session = yield* DatabaseSession;
				yield* service.create(baseInput, command("commit"));
				expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual([]);
				const nested = yield* Effect.exit(
					session.transaction(service.delete(baseInput, command("nested"))),
				);
				assertExitFails(
					nested,
					new DbError({
						message: "Relationship lifecycle mutations require a root transaction boundary",
					}),
				);
				expect(yield* session.run((db) => db.select().from(tables.relationship))).toHaveLength(1);
			}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
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
												{ position: 1, runId: AutomationRunId.make("first") },
												{ position: 2, runId: AutomationRunId.make("second") },
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
						[{ resource: "relationship", draft: { properties: { remove: [], set: { rank: 2 } } } }],
					]);
					expect(result.relationship).toMatchObject({
						sourceEntityId,
						targetEntityId,
						properties: { rank: 3 },
					});
				}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
		test.effect("detects writes made during policy execution without overwriting them", () =>
			Effect.gen(function* () {
				const repository = yield* RelationshipsRepository;
				const planner = yield* LifecyclePlanner;
				const execution = yield* LifecycleExecution;
				const policyInput = yield* installPolicyFixture();
				yield* repository.createRelationship({ ...policyInput, properties: { rank: 1 } });
				const exit = yield* Effect.exit(
					(yield* relationshipsServiceWith({
						execution: withLifecycleDispatch({
							...execution,
							after: () => Effect.succeed([]),
							executePolicy: () =>
								repository
									.updateRelationship({ ...policyInput, properties: { rank: 9 } })
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
											policies: [{ position: 1, runId: AutomationRunId.make("concurrent") }],
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
				expect((yield* repository.findRelationship(policyInput))?.properties).toEqual({ rank: 9 });
			}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
		test.effect("replays host-owned batch counts without dummy triggers", () =>
			Effect.gen(function* () {
				const service = yield* RelationshipsService;
				const session = yield* DatabaseSession;
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
				const result = yield* (yield* relationshipsServiceWith({
					execution: withLifecycleDispatch({
						...execution,
						after: () => Effect.succeed([warning]),
						executePolicy: () => Effect.die("Unexpected policy"),
					}),
				})).changeUser(userId, batches, child);
				expect(result).toEqual([{ created: 1, updated: 1, deleted: 0, warnings: [] }]);
				expect(
					yield* (yield* relationshipsServiceWith({
						execution: withLifecycleDispatch({
							...execution,
							after: () => Effect.succeed([warning]),
						}),
					})).changeUser(userId, batches, child),
				).toEqual(result);
				const changes = yield* session.run((db) =>
					db
						.select()
						.from(tables.automationTrigger)
						.where(eq(tables.automationTrigger.category, "change")),
				);
				expect(changes).toEqual([]);
				const receipts = yield* session.run((db) => db.select().from(tables.mutationReceipt));
				const hostReceipts = receipts.filter(
					({ receiptType, executionId }) => receiptType === "item" && executionId === "host",
				);
				expect(hostReceipts).toHaveLength(3);
				expect(
					hostReceipts.every(
						({ dispatch, rootExecutionId }) =>
							rootExecutionId === "root-execution" &&
							Array.isArray(dispatch) &&
							dispatch.length === 0,
					),
				).toBe(true);
			}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
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
												? { reason: "Rejected", action: "reject" as const }
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
												};
											}),
										),
								}),
							})).create(policyInput, command(mode)),
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
					expect(yield* session.run((db) => db.select().from(tables.relationship))).toEqual([]);
					expect(
						(yield* session.run((db) => db.select().from(tables.automationTrigger))).map(
							({ category }) => category,
						),
					).toEqual(["request", "request", "request"]);
				}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
		test.effect(
			"preserves reconciliation counts without retaining no-hook population batches",
			() =>
				Effect.gen(function* () {
					const service = yield* RelationshipsService;
					const session = yield* DatabaseSession;
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
					const changes = (yield* session.run((db) =>
						db.select().from(tables.automationTrigger),
					)).filter(({ category, operation }) => category === "change" && operation !== "batch");
					expect(changes).toEqual([]);
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
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
		test.effect(
			"requires an active transaction and rejects unprepared reconciliation policies",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const planner = yield* LifecyclePlanner;
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
					const policyService = yield* relationshipsServiceWith({
						planner: withLifecycleBatchPlanning({
							plan: (input) =>
								planner.plan(input).pipe(
									Effect.map((plan) => {
										assert(plan.trigger);
										return {
											...plan,
											policies: [{ position: 1, runId: AutomationRunId.make("policy") }],
										};
									}),
								),
						}),
					});
					const groups = [
						{
							relationshipSchemaSlug: globalPolicyInput.relationshipSchemaSlug,
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
					const error = yield* session
						.transaction(
							policyService.persistPlannedReconciliation(groups, command("policy"), {
								scope: "global",
							}),
						)
						.pipe(Effect.flip);
					expect(error).toMatchObject({ code: "before-policy-requires-owner" });
					const [relationships, triggers] = yield* session.run((db) =>
						Effect.all([
							db.select().from(tables.relationship),
							db.select().from(tables.automationTrigger),
						]),
					);
					expect(relationships).toEqual([]);
					expect(triggers).toEqual([]);
				}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
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
					yield* session.run((db) =>
						db
							.insert(tables.plugin)
							.values({ slug: "group", status: "disabled", id: "group-provider-plugin" }),
					);
					yield* session.run((db) =>
						db
							.insert(tables.sandboxProvider)
							.values({
								id: providerId,
								name: "Group provider",
								slug: "group-provider",
								pluginId: "group-provider-plugin",
								information: { source: "fixture" },
								rootEntitySchemaSlug: "group-fixture",
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
									expect(yield* tx.select().from(tables.automationTrigger)).toHaveLength(2);
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
					const [relationshipsAfterRollback, triggersAfterRollback, runsAfterRollback, entityRows] =
						yield* session.run((db) =>
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
					expect(entityRows.map(({ id }) => id).sort()).toEqual(
						[sourceEntityId, targetEntityId].sort(),
					);

					const work = yield* persistGroup("commit", false);
					const visible = yield* Effect.tryPromise(() =>
						observer.query(
							"select (select count(*)::int from entity) as entities, (select count(*)::int from relationship) as relationships, (select count(*)::int from automation_trigger) as triggers, (select count(*)::int from automation_run) as runs",
						),
					).pipe(Effect.mapError(() => new DbError({ message: "Observer failed" })));
					expect(visible.rows).toEqual([{ runs: 2, entities: 3, triggers: 2, relationships: 1 }]);
					expect([...work.entityDispatch, ...work.relationshipDispatch]).toHaveLength(2);
				}),
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
		test.effect("reconciles private user relationships atomically without crossing owners", () =>
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
							accountGeneration: "test-account-generation",
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
										{ sourceEntityId, properties: {}, targetEntityId: foreignEntityId },
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
				expect(foreignOwner).toMatchObject({ reason: { code: "relationship-schema-not-found" } });

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
		);
	});

	layer(relationshipDatabaseLayer())((test) => {
		test.effect("keeps prepared user relationship changes in the caller transaction", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const service = yield* RelationshipsService;
				const repository = yield* RelationshipsRepository;
				const planner = yield* LifecyclePlanner;
				const execution = yield* LifecycleExecution;

				yield* repository.createRelationship(baseInput);
				const stale = yield* service.prepareUserDelete(baseInput, command("prepared-stale"));
				assert(stale);
				yield* repository.updateRelationship({ ...baseInput, properties: { rank: 9 } });
				expect(
					yield* session.transaction(service.persistPreparedUserDelete(stale)).pipe(Effect.flip),
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

				const rejectedInput = {
					...(yield* installPolicyFixture()),
					targetEntityId,
					sourceEntityId: targetEntityId,
				};
				yield* repository.createRelationship(rejectedInput);
				const rejectingService = yield* relationshipsServiceWith({
					execution: withLifecycleDispatch({
						...execution,
						executePolicy: () =>
							Effect.gen(function* () {
								expect(!(yield* session.isTransactionActive)).toBe(true);
								return { reason: "Rejected", action: "reject" as const };
							}),
					}),
					planner: withLifecycleBatchPlanning({
						plan: (input) =>
							planner.plan(input).pipe(
								Effect.map((plan) => {
									assert(plan.trigger);
									return {
										...plan,
										policies: [{ position: 1, runId: AutomationRunId.make("reject-relationship") }],
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
		);
	});
});
