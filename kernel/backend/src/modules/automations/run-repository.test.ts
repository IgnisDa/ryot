import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationRun,
	AutomationSignalPayload,
	AutomationTrigger,
	AutomationTriggerPayload,
	DEFAULT_AUTOMATION_RETRY_POLICY,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { AutomationHookSlug, PluginId, UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { makeRecordingTracer } from "@ryot-app/testing/recording-tracer";
import { and, eq, getTableColumns } from "drizzle-orm";
import { DateTime, Duration, Effect, Layer, Schema, type Tracer } from "effect";
import { TestClock } from "effect/testing";
import { assert, describe, it as unit } from "vitest";

import { lifecycleRunId, lifecycleTriggerId } from "#modules/automations/lifecycle/planning";
import { PluginConfigRevisions } from "#modules/plugins/configuration/revisions";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { fixtureManifest } from "#modules/plugins/test-support";
import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import { automationRun, automationRunAttempt } from "#schema/tables/automations";
import { sandboxScript } from "#schema/tables/core";

import { AutomationAttemptRepository } from "./attempt-repository";
import { triggerFixture } from "./lifecycle.test-support";
import { AutomationRunRepository, redactAutomationHistoryPayload } from "./run-repository";
import { AutomationTriggerRepository } from "./trigger-repository";

const fixture = fixtureManifest();
const queueRun = Effect.fn(function* (
	repo: AutomationRunRepository["Service"],
	run: AutomationRun,
	triggerPayload: AutomationTriggerPayload,
) {
	const [stored] = yield* repo.insertQueued({ runs: [run], triggerPayload });
	assert(stored);
	return stored;
});
const signalManifest: PluginManifest = {
	...fixture,
	signalSchemas: fixture.signalSchemas.map((signal) => ({
		...signal,
		propertiesSchema: {
			fields: {
				public: { type: "string", label: "Public", description: "Public field" },
				password: { secret: true, type: "string", label: "Password", description: "Secret field" },
				nested: {
					type: "object",
					label: "Nested",
					description: "Nested object",
					properties: {
						visible: { type: "string", label: "Visible", description: "Visible field" },
						credential: {
							secret: true,
							type: "string",
							label: "Credential",
							description: "Secret credential",
						},
					},
				},
				items: {
					type: "array",
					label: "Items",
					description: "Array of objects",
					items: {
						label: "Item",
						type: "object",
						description: "Array item",
						properties: {
							label: { type: "string", label: "Label", description: "Public label" },
							private: {
								secret: true,
								type: "string",
								label: "Private",
								description: "Private field",
							},
						},
					},
				},
			},
		},
	})),
};

unit(
	"redacts secret fields from the retained revision, including nested objects and array items",
	() => {
		const payload = Schema.decodeSync(AutomationSignalPayload)({
			operation: "emit",
			category: "signal",
			resource: "signal",
			actorUserId: "owner",
			signalSchemaPluginId: "plugin-1",
			signalSchemaSlug: "fixture.signal",
			properties: {
				public: "visible",
				password: "hidden",
				items: [{ label: "ok", private: "hidden" }],
				nested: { visible: "ok", credential: "hidden" },
			},
		});
		expect(
			redactAutomationHistoryPayload(payload, signalManifest, payload.signalSchemaPluginId),
		).toEqual({
			...payload,
			properties: { public: "visible", items: [{ label: "ok" }], nested: { visible: "ok" } },
		});
		expect(redactAutomationHistoryPayload(payload, null, payload.signalSchemaPluginId)).toEqual({
			...payload,
			properties: {},
		});
		expect(redactAutomationHistoryPayload(payload, signalManifest, null)).toEqual({
			...payload,
			properties: {},
		});
		expect(payload.properties).toMatchObject({ password: "hidden" });
	},
);

unit("redacts mutation snapshots and parent population properties with their own schemas", () => {
	const pinned: PluginManifest = {
		...fixture,
		entitySchemas: fixture.entitySchemas.map((entity) =>
			Object.assign({}, entity, {
				propertiesSchema: {
					fields: {
						count: { type: "number", label: "Count", description: "Counter" },
						token: { secret: true, type: "string", label: "Token", description: "Secret token" },
					},
				} satisfies AppSchema,
			}),
		),
	};
	const snapshot = {
		id: "entity",
		name: "Item",
		externalId: null,
		providerId: null,
		populatedAt: null,
		entitySchemaPluginId: null,
		entitySchemaSlug: "fixture-entity",
		createdAt: "2026-09-15T00:00:00.000Z",
		updatedAt: "2026-09-15T00:00:00.000Z",
		properties: { count: 2, token: "hidden" },
	};
	const item = {
		after: snapshot,
		before: snapshot,
		category: "change",
		resource: "entity",
		operation: "update",
	} as const;
	const population = {
		rootPreviouslyPopulated: true,
		scopeEntity: {
			id: "entity",
			name: "Item",
			entitySchemaPluginId: null,
			entitySchemaSlug: "fixture-entity",
		},
		parentEntity: {
			name: "Parent",
			entitySchemaPluginId: null,
			entitySchemaSlug: "fixture-entity",
			properties: { count: 1, token: "hidden" },
		},
	};
	const payload = Schema.decodeSync(AutomationTriggerPayload)({ ...item, population });
	expect(redactAutomationHistoryPayload(payload, pinned, null)).toMatchObject({
		after: { properties: { count: 2 } },
		before: { properties: { count: 2 } },
		population: { parentEntity: { properties: { count: 1 } } },
	});
	expect(JSON.stringify(redactAutomationHistoryPayload(payload, pinned, null))).not.toContain(
		"hidden",
	);
	const batch = Schema.decodeSync(AutomationTriggerPayload)({
		category: "change",
		resource: "entity",
		operation: "batch",
		items: [{ ...item, population }],
	});
	expect(redactAutomationHistoryPayload(batch, pinned, null)).toMatchObject({
		items: [
			{
				after: { properties: { count: 2 } },
				before: { properties: { count: 2 } },
				population: { parentEntity: { properties: { count: 1 } } },
			},
		],
	});
	expect(JSON.stringify(redactAutomationHistoryPayload(batch, pinned, null))).not.toContain(
		"hidden",
	);
});

describe("AutomationRunRepository", () => {
	layer(
		Layer.mergeAll(AutomationRunRepository.layer, AutomationTriggerRepository.layer).pipe(
			Layer.provideMerge(revisionDatabaseLayer),
		),
	)((test) => {
		test.effect(
			"chunks large accepted plans at the parameter boundary and rolls every chunk back on a late replay conflict",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const repo = yield* AutomationRunRepository;
					const triggers = yield* AutomationTriggerRepository;
					const source = revisionPackage();
					const [hook] = source.manifest.hooks;
					assert(hook);
					const hooks = [
						hook,
						...[1, 2, 3].map((index) => Object.assign({}, hook, { slug: `fixture.bulk-${index}` })),
					];
					const installed = yield* installRevisionPackage({
						...source,
						manifest: { ...source.manifest, hooks },
					});
					const config = yield* (yield* PluginConfigRevisions).create({
						properties: {},
						ownerUserId: null,
						scope: "environment",
						pluginInstallationId: null,
						pluginRevisionId: installed.revisionId,
					});
					const recipients = Array.from({ length: 1000 }, (_, index) =>
						UserId.make(`bulk-recipient-${index}`),
					);
					yield* session.run((db) =>
						db
							.insert(user)
							.values(recipients.map((id) => ({ id, name: id, email: `${id}@example.test` }))),
					);
					const scripts = yield* session.run((db) =>
						db
							.select()
							.from(sandboxScript)
							.where(eq(sandboxScript.pluginRevisionId, installed.revisionId)),
					);
					const script = scripts.find(({ slug }) => slug === hook.scriptSlug);
					assert(script);
					const base = yield* Schema.decodeEffect(AutomationRun)({
						stage: "after",
						id: "bulk-base",
						attemptCount: 0,
						startedAt: null,
						status: "queued",
						finishedAt: null,
						skipReason: null,
						delivery: "async",
						hookName: hook.name,
						nextAttemptAt: null,
						hookSlug: hook.slug,
						executionUserId: null,
						scriptSlug: script.slug,
						sandboxScriptId: script.id,
						pluginId: installed.pluginId,
						triggerId: "bulk-base-trigger",
						pluginConfigRevisionId: config,
						queuedAt: "2026-09-15T00:00:00.000Z",
						scriptContentHash: script.contentHash,
						pluginRevisionId: installed.revisionId,
						retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
						artifactsExpireAt: "2026-10-15T00:00:00.000Z",
					});
					const runsFor = (trigger: AutomationTrigger, count: number) =>
						hooks
							.flatMap(({ slug, name }) =>
								recipients.map((executionUserId) => {
									const identity = {
										executionUserId,
										triggerId: trigger.id,
										pluginId: base.pluginId,
										hookSlug: AutomationHookSlug.make(slug),
									};
									return Object.assign({}, base, identity, {
										hookName: name,
										id: lifecycleRunId(identity),
									});
								}),
							)
							.slice(0, count)
							.toReversed();
					const boundary = Math.floor(32_767 / Object.keys(getTableColumns(automationRun)).length);
					for (const { count, expectedInserts } of [
						{ count: boundary, expectedInserts: 1 },
						{ expectedInserts: 2, count: boundary + 1 },
						{ count: 4000, expectedInserts: 3 },
					]) {
						const trigger = yield* triggers.insert(
							triggerFixture(`bulk-${count}`, PluginId.make(installed.pluginId)),
						);
						assert(trigger.payload);
						const runs = runsFor(trigger, count);
						const spans: Tracer.Span[] = [];
						expect(
							yield* session
								.transaction(repo.insertQueued({ runs, triggerPayload: trigger.payload }))
								.pipe(Effect.withTracer(makeRecordingTracer(spans))),
						).toEqual(runs);
						const statements = spans.flatMap((span) => {
							const text = span.attributes.get("db.query.text");
							return typeof text === "string" ? [text] : [];
						});
						const inserts = statements.filter((text) =>
							text.startsWith('insert into "automation_run"'),
						);
						expect(inserts).toHaveLength(expectedInserts);
						for (const statement of inserts) {
							const parameters = [...statement.matchAll(/\$(\d+)/g)].map((match) =>
								Number(match[1]),
							);
							expect(Math.max(...parameters)).toBeLessThanOrEqual(32_767);
						}
						expect(
							statements.filter((text) => text.includes('from "plugin_revision"')),
						).toHaveLength(1);
						expect(
							statements.filter((text) => text.includes('from "automation_run"')),
						).toHaveLength(1);
					}
					const trigger = yield* triggers.insert(
						triggerFixture("bulk-conflict", PluginId.make(installed.pluginId)),
					);
					const triggerPayload = trigger.payload;
					assert(triggerPayload);
					const runs = runsFor(trigger, 4000);
					const first = runs[0];
					const last = runs.at(-1);
					assert(first && last);
					yield* session.transaction(repo.insertQueued({ triggerPayload, runs: [first, last] }));
					const before = yield* repo.listByTrigger(trigger.id);
					const spans: Tracer.Span[] = [];
					const failed = yield* session
						.transaction(
							Effect.gen(function* () {
								yield* session.run((db) =>
									db.update(user).set({ name: "must roll back" }).where(eq(user.id, "owner")),
								);
								return yield* repo.insertQueued({
									triggerPayload,
									runs: runs.map((run) =>
										run.id === last.id
											? Object.assign({}, run, { hookName: "Conflicting hook" })
											: run,
									),
								});
							}),
						)
						.pipe(Effect.withTracer(makeRecordingTracer(spans)), Effect.exit);
					assertExitFails(
						failed,
						new DbError({ message: `Automation run identity conflict: ${last.id}` }),
					);
					const statements = spans.flatMap((span) => {
						const text = span.attributes.get("db.query.text");
						return typeof text === "string" ? [text] : [];
					});
					expect(
						statements.filter((text) => text.startsWith('insert into "automation_run"')),
					).toHaveLength(3);
					expect(statements.filter((text) => text.includes('from "automation_run"'))).toHaveLength(
						1,
					);
					expect(yield* repo.listByTrigger(trigger.id)).toEqual(before);
					expect(
						yield* session.run((db) =>
							db.select({ name: user.name }).from(user).where(eq(user.id, "owner")),
						),
					).toEqual([{ name: "Owner" }]);
				}),
		);
	});
	layer(
		Layer.mergeAll(
			AutomationRunRepository.layer,
			AutomationAttemptRepository.layer,
			AutomationTriggerRepository.layer,
		).pipe(Layer.provideMerge(revisionDatabaseLayer)),
	)((test) => {
		test.effect(
			"closes only unstarted policies in the abandoned trigger without changing attempts or replay timestamps",
			() =>
				Effect.gen(function* () {
					const repo = yield* AutomationRunRepository;
					const attempts = yield* AutomationAttemptRepository;
					const triggers = yield* AutomationTriggerRepository;
					yield* (yield* DatabaseSession).run((db) =>
						Effect.gen(function* () {
							const request = yield* Schema.decodeEffect(AutomationTrigger)({
								...triggerFixture("abandoned"),
								createdAt: "1970-01-01T00:00:00.000Z",
								occurredAt: "1970-01-01T00:00:00.000Z",
								kind: { resource: "entity", operation: "create", category: "request" },
								payload: {
									resource: "entity",
									category: "request",
									operation: "create",
									draft: {
										name: "Draft",
										properties: {},
										providerId: null,
										externalId: null,
										populatedAt: null,
										entitySchemaSlug: "record",
										entitySchemaPluginId: null,
									},
								},
							});
							const trigger = yield* triggers.insert(request);
							const payload = trigger.payload;
							assert(payload);
							const other = yield* triggers.insert({ ...request, id: triggerFixture("other").id });
							yield* db
								.insert(sandboxScript)
								.values({
									name: "Policy",
									slug: "policy",
									source: "source",
									id: "policy-script",
									contentHash: "hash",
									compiledCode: "code",
									metadata: { kind: "automation", runtimeImports: [] },
								});
							const base = yield* Schema.decodeEffect(AutomationRun)({
								pluginId: null,
								stage: "before",
								startedAt: null,
								attemptCount: 0,
								finishedAt: null,
								skipReason: null,
								status: "queued",
								retryPolicy: null,
								id: "unstarted-a",
								delivery: "policy",
								hookSlug: "policy",
								hookName: "Policy",
								nextAttemptAt: null,
								scriptSlug: "policy",
								triggerId: trigger.id,
								executionUserId: null,
								pluginRevisionId: null,
								scriptContentHash: "hash",
								queuedAt: trigger.createdAt,
								pluginConfigRevisionId: null,
								sandboxScriptId: "policy-script",
								artifactsExpireAt: "2026-10-15T00:00:00.000Z",
							});
							const pending = yield* queueRun(repo, base, payload);
							const second = yield* queueRun(
								repo,
								yield* Schema.decodeEffect(AutomationRun)({
									...base,
									id: "unstarted-b",
									hookSlug: "second",
								}),
								payload,
							);
							const active = yield* queueRun(
								repo,
								yield* Schema.decodeEffect(AutomationRun)({
									...base,
									id: "active",
									hookSlug: "active",
								}),
								payload,
							);
							const terminal = yield* queueRun(
								repo,
								yield* Schema.decodeEffect(AutomationRun)({
									...base,
									id: "terminal",
									hookSlug: "terminal",
								}),
								payload,
							);
							const after = yield* queueRun(
								repo,
								yield* Schema.decodeEffect(AutomationRun)({
									...base,
									id: "after",
									stage: "after",
									hookSlug: "after",
									delivery: "required",
									retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
								}),
								payload,
							);
							const unrelated = yield* queueRun(
								repo,
								{
									...base,
									triggerId: other.id,
									id: lifecycleRunId({ ...base, triggerId: other.id }),
								},
								payload,
							);
							const now = DateTime.toDate(DateTime.makeUnsafe(trigger.createdAt));
							yield* attempts.claimNextAttempt({ now, attemptNumber: 1, runId: active.id });
							yield* attempts.claimNextAttempt({ now, attemptNumber: 1, runId: terminal.id });
							yield* attempts.finalizeAttempt(
								{
									logs: [],
									error: null,
									timing: null,
									attemptNumber: 1,
									failureKind: null,
									runId: terminal.id,
									status: "succeeded",
									returnedValue: { action: "reject", reason: "Stopped" },
								},
								now,
							);
							const activeBefore = yield* repo.findById(active.id);
							const terminalBefore = yield* repo.findById(terminal.id);
							const attemptsBefore = yield* db
								.select()
								.from(automationRunAttempt)
								.orderBy(automationRunAttempt.id);
							const finishedAt = "1970-01-01T00:00:01.000Z";
							yield* TestClock.adjust("1 second");
							yield* repo.skipQueuedPolicies({ triggerId: trigger.id });
							expect(yield* repo.findById(pending.id)).toEqual({
								...pending,
								finishedAt,
								status: "skipped",
								skipReason: { code: "policy-chain-stopped" },
							});
							expect(yield* repo.findById(second.id)).toEqual({
								...second,
								finishedAt,
								status: "skipped",
								skipReason: { code: "policy-chain-stopped" },
							});
							expect(yield* repo.findById(active.id)).toEqual(activeBefore);
							expect(yield* repo.findById(terminal.id)).toEqual(terminalBefore);
							expect(yield* repo.findById(after.id)).toEqual(after);
							expect(yield* repo.findById(unrelated.id)).toEqual(unrelated);
							expect(
								yield* db.select().from(automationRunAttempt).orderBy(automationRunAttempt.id),
							).toEqual(attemptsBefore);
							yield* TestClock.adjust("1 minute");
							yield* repo.skipQueuedPolicies({ triggerId: trigger.id });
							expect(yield* repo.findById(pending.id)).toEqual({
								...pending,
								finishedAt,
								status: "skipped",
								skipReason: { code: "policy-chain-stopped" },
							});
							expect(
								yield* db.select().from(automationRunAttempt).orderBy(automationRunAttempt.id),
							).toEqual(attemptsBefore);
						}),
					);
				}),
		);
	});
	layer(
		Layer.mergeAll(AutomationRunRepository.layer, AutomationTriggerRepository.layer).pipe(
			Layer.provideMerge(revisionDatabaseLayer),
		),
	)((test) => {
		test.effect(
			"pins kernel runs, verifies immutable replay after completion and selects only due queued after runs",
			() =>
				Effect.gen(function* () {
					const repo = yield* AutomationRunRepository;
					const triggers = yield* AutomationTriggerRepository;
					yield* (yield* DatabaseSession).run((db) =>
						Effect.gen(function* () {
							const trigger = yield* triggers.insert(triggerFixture());
							const payload = trigger.payload;
							assert(payload);
							yield* db
								.insert(sandboxScript)
								.values({
									name: "Notify",
									source: "source",
									id: "kernel-script",
									contentHash: "hash",
									compiledCode: "code",
									slug: "kernel.notify",
									metadata: {
										name: "Notify",
										...emptySandboxExecutionMetadata,
										kind: "automation",
										slug: "kernel.notify",
									},
								});
							const now = DateTime.toDate(DateTime.makeUnsafe(trigger.createdAt));
							const run = yield* Schema.decodeEffect(AutomationRun)({
								id: "run",
								pluginId: null,
								stage: "after",
								attemptCount: 0,
								startedAt: null,
								status: "queued",
								finishedAt: null,
								skipReason: null,
								delivery: "async",
								hookName: "Notify",
								nextAttemptAt: null,
								triggerId: trigger.id,
								executionUserId: null,
								pluginRevisionId: null,
								hookSlug: "kernel.notify",
								scriptContentHash: "hash",
								scriptSlug: "kernel.notify",
								queuedAt: trigger.createdAt,
								pluginConfigRevisionId: null,
								sandboxScriptId: "kernel-script",
								retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
								artifactsExpireAt: "2026-10-15T00:00:00.000Z",
							});
							const pinned = { ...run, id: lifecycleRunId(run) };
							expect(yield* queueRun(repo, pinned, payload)).toEqual(pinned);
							expect(yield* queueRun(repo, pinned, payload)).toEqual(pinned);
							expect(yield* repo.listByTrigger(trigger.id)).toEqual([pinned]);
							expect(
								yield* repo.listQueuedCandidates({ now, limit: 1, initialQueuedBefore: now }),
							).toEqual([pinned]);
							expect(
								yield* repo.listQueuedCandidates({
									limit: 1,
									now: DateTime.toDate(DateTime.makeUnsafe(0)),
									initialQueuedBefore: DateTime.toDate(DateTime.makeUnsafe(0)),
								}),
							).toEqual([]);
							const beforeQueued = DateTime.toDate(
								DateTime.subtractDuration(
									DateTime.makeUnsafe(trigger.createdAt),
									Duration.millis(1),
								),
							);
							expect(
								yield* repo.listQueuedCandidates({
									now,
									limit: 1,
									initialQueuedBefore: beforeQueued,
								}),
							).toEqual([]);
							yield* db
								.update(automationRun)
								.set({ attemptCount: 1 })
								.where(eq(automationRun.id, pinned.id));
							expect(
								yield* repo.listQueuedCandidates({
									now,
									limit: 1,
									initialQueuedBefore: beforeQueued,
								}),
							).toEqual([{ ...pinned, attemptCount: 1 }]);
							yield* db
								.update(automationRun)
								.set({ attemptCount: 0 })
								.where(eq(automationRun.id, pinned.id));
							yield* db
								.update(automationRun)
								.set({
									nextAttemptAt: DateTime.toDate(DateTime.makeUnsafe("2026-09-16T00:00:00.000Z")),
								})
								.where(eq(automationRun.id, pinned.id));
							expect(
								yield* repo.listQueuedCandidates({ now, limit: 10, initialQueuedBefore: now }),
							).toEqual([]);
							yield* db
								.update(automationRun)
								.set({
									startedAt: now,
									attemptCount: 1,
									finishedAt: now,
									status: "succeeded",
									nextAttemptAt: null,
								})
								.where(eq(automationRun.id, pinned.id));
							expect(yield* queueRun(repo, pinned, payload)).toMatchObject({
								attemptCount: 1,
								status: "succeeded",
							});
							expect(
								yield* queueRun(repo, { ...pinned, scriptContentHash: "changed" }, payload).pipe(
									Effect.flip,
								),
							).toMatchObject({ _tag: "DbError" });
							expect(
								yield* repo.listQueuedCandidates({ now, limit: 10, initialQueuedBefore: now }),
							).toEqual([]);
							expect(yield* repo.findById(pinned.id)).toMatchObject({ status: "succeeded" });
							const identity = {
								kind: trigger.kind,
								itemIdentity: "item",
								discriminator: "first",
								executionId: trigger.causation.executionId,
							};
							expect(lifecycleTriggerId(identity)).toBe(lifecycleTriggerId({ ...identity }));
							expect(lifecycleTriggerId(identity)).not.toBe(
								lifecycleTriggerId({ ...identity, discriminator: "second" }),
							);
							expect(lifecycleRunId(run)).not.toBe(
								lifecycleRunId({ ...run, pluginId: PluginId.make("kernel") }),
							);
							expect(lifecycleRunId(run)).not.toBe(
								lifecycleRunId({ ...run, executionUserId: UserId.make("system") }),
							);
							const installed = yield* installRevisionPackage(revisionPackage());
							const configs = yield* PluginConfigRevisions;
							const config = yield* configs.create({
								ownerUserId: null,
								scope: "environment",
								pluginInstallationId: null,
								properties: { token: "test" },
								pluginRevisionId: installed.revisionId,
							});
							const [script] = yield* db
								.select()
								.from(sandboxScript)
								.where(
									and(
										eq(sandboxScript.pluginRevisionId, installed.revisionId),
										eq(sandboxScript.slug, "fixture.automation"),
									),
								);
							assert(script);
							const pluginRun = yield* Schema.decodeEffect(AutomationRun)({
								...run,
								id: "plugin-run",
								scriptSlug: script.slug,
								sandboxScriptId: script.id,
								pluginId: installed.pluginId,
								pluginConfigRevisionId: config,
								scriptContentHash: script.contentHash,
								pluginRevisionId: installed.revisionId,
							});
							expect(yield* queueRun(repo, pluginRun, payload)).toEqual(pluginRun);
							const disabledUserRun = yield* Schema.decodeEffect(AutomationRun)({
								...pluginRun,
								id: "disabled-user-run",
								executionUserId: "owner",
							});
							expect(yield* queueRun(repo, disabledUserRun, payload)).toEqual(disabledUserRun);
							const freshIdentity = { ...pluginRun, executionUserId: UserId.make("recipient") };
							const fresh = { ...freshIdentity, id: lifecycleRunId(freshIdentity) };
							const session = yield* DatabaseSession;
							const failed = yield* session
								.transaction(
									Effect.gen(function* () {
										yield* session.run((transaction) =>
											transaction
												.update(user)
												.set({ name: "must roll back" })
												.where(eq(user.id, "owner")),
										);
										return yield* repo.insertQueued({
											triggerPayload: payload,
											runs: [fresh, pluginRun, { ...disabledUserRun, hookName: "Conflict" }],
										});
									}),
								)
								.pipe(Effect.exit);
							assertExitFails(
								failed,
								new DbError({ message: `Automation run identity conflict: ${disabledUserRun.id}` }),
							);
							expect(yield* repo.findById(fresh.id)).toBeNull();
							expect(yield* repo.findById(pluginRun.id)).toEqual(pluginRun);
							expect(yield* repo.findById(disabledUserRun.id)).toEqual(disabledUserRun);
							expect(
								yield* db.select({ name: user.name }).from(user).where(eq(user.id, "owner")),
							).toEqual([{ name: "Owner" }]);
							const spans: Tracer.Span[] = [];
							expect(
								yield* session
									.transaction(
										repo.insertQueued({
											triggerPayload: payload,
											runs: [fresh, disabledUserRun, pluginRun],
										}),
									)
									.pipe(Effect.withTracer(makeRecordingTracer(spans))),
							).toEqual([fresh, disabledUserRun, pluginRun]);
							const statements = spans.flatMap((span) => {
								const text = span.attributes.get("db.query.text");
								return typeof text === "string" ? [text] : [];
							});
							expect(
								statements.filter((text) => text.includes('from "plugin_revision"')),
							).toHaveLength(1);
							expect(
								statements.filter((text) => text.startsWith('insert into "automation_run"')),
							).toHaveLength(1);
							expect(
								statements.filter((text) => text.includes('from "automation_run"')),
							).toHaveLength(1);
							expect(
								yield* repo.clearExpiredScriptPins({
									limit: 10,
									now: DateTime.toDate(DateTime.makeUnsafe("2026-10-16T00:00:00.000Z")),
								}),
							).toEqual([{ id: pinned.id }]);
							expect(
								yield* repo.insertQueued({ triggerPayload: payload, runs: [pinned, pluginRun] }),
							).toEqual([
								{
									...pinned,
									attemptCount: 1,
									status: "succeeded",
									nextAttemptAt: null,
									sandboxScriptId: null,
									startedAt: now.toISOString(),
									finishedAt: now.toISOString(),
								},
								pluginRun,
							]);
							expect(
								yield* queueRun(repo, { ...pluginRun, hookName: "Changed" }, payload).pipe(
									Effect.flip,
								),
							).toMatchObject({ _tag: "DbError" });
							yield* db.update(user).set({ disabledAt: now }).where(eq(user.id, "owner"));
							const policy = yield* Schema.decodeUnknownEffect(AutomationRun)({
								...run,
								stage: "before",
								id: "policy-run",
								retryPolicy: null,
								hookSlug: "policy",
								delivery: "policy",
							});
							yield* queueRun(repo, policy, payload);
							expect(
								yield* repo.listQueuedCandidates({ now, limit: 10, initialQueuedBefore: now }),
							).toEqual(
								[fresh, disabledUserRun, pluginRun].sort((a, b) => a.id.localeCompare(b.id)),
							);
						}),
					);
				}),
		);
	});
});
