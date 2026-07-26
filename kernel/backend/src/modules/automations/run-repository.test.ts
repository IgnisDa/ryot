import { expect, it } from "@effect/vitest";
import {
	AutomationRun,
	AutomationTrigger,
	DEFAULT_AUTOMATION_RETRY_POLICY,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { and, eq } from "drizzle-orm";
import { DateTime, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { assert, describe } from "vitest";

import { lifecycleRunId, lifecycleTriggerId } from "#lib/domain/lifecycle";
import { user } from "#lib/infrastructure/db/schema/tables/auth";
import {
	automationRun,
	automationRunAttempt,
} from "#lib/infrastructure/db/schema/tables/automations";
import { sandboxScript } from "#lib/infrastructure/db/schema/tables/core";
import { Database } from "#lib/infrastructure/db/service";
import { PluginConfigRevisions } from "#modules/plugins/config-revisions";
import {
	installRevisionPackage,
	revisionPackage,
	withRevisionDatabase,
} from "#modules/plugins/revision.test-support";

import { AutomationAttemptRepository } from "./attempt-repository";
import { triggerFixture } from "./lifecycle.test-support";
import { AutomationRunRepository } from "./run-repository";
import { AutomationTriggerRepository } from "./trigger-repository";

describe("AutomationRunRepository", () => {
	it.effect(
		"closes only unstarted policies in the abandoned trigger without changing attempts or replay timestamps",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const repo = yield* AutomationRunRepository;
					const attempts = yield* AutomationAttemptRepository;
					const triggers = yield* AutomationTriggerRepository;
					const db = yield* Database;
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
							},
						},
					});
					const trigger = yield* triggers.insert(request);
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
							metadata: { kind: "automation" },
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
					const pending = yield* repo.insertQueued(base);
					const second = yield* repo.insertQueued(
						yield* Schema.decodeEffect(AutomationRun)({
							...base,
							id: "unstarted-b",
							hookSlug: "second",
						}),
					);
					const active = yield* repo.insertQueued(
						yield* Schema.decodeEffect(AutomationRun)({
							...base,
							id: "active",
							hookSlug: "active",
						}),
					);
					const terminal = yield* repo.insertQueued(
						yield* Schema.decodeEffect(AutomationRun)({
							...base,
							id: "terminal",
							hookSlug: "terminal",
						}),
					);
					const after = yield* repo.insertQueued(
						yield* Schema.decodeEffect(AutomationRun)({
							...base,
							id: "after",
							stage: "after",
							hookSlug: "after",
							delivery: "required",
							retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
						}),
					);
					const unrelated = yield* repo.insertQueued({
						...base,
						triggerId: other.id,
						id: lifecycleRunId({ ...base, triggerId: other.id }),
					});
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
				}).pipe(
					Effect.provide(
						Layer.mergeAll(
							AutomationRunRepository.layer,
							AutomationAttemptRepository.layer,
							AutomationTriggerRepository.layer,
						),
					),
				),
			),
	);
	it.effect(
		"pins kernel runs, verifies immutable replay after completion and selects only due queued after runs",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const repo = yield* AutomationRunRepository;
					const triggers = yield* AutomationTriggerRepository;
					const db = yield* Database;
					const trigger = yield* triggers.insert(triggerFixture());
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
								capabilities: [],
								kind: "automation",
								slug: "kernel.notify",
								requiredPluginConfigKeys: [],
								requiredSystemConfigKeys: [],
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
					expect(yield* repo.insertQueued(pinned)).toEqual(pinned);
					expect(yield* repo.insertQueued(pinned)).toEqual(pinned);
					expect(yield* repo.listByTrigger(trigger.id)).toEqual([pinned]);
					expect(yield* repo.listQueuedCandidates({ now, limit: 1 })).toEqual([pinned]);
					expect(
						yield* repo.listQueuedCandidates({
							limit: 1,
							now: DateTime.toDate(DateTime.makeUnsafe(0)),
						}),
					).toEqual([]);
					yield* db
						.update(automationRun)
						.set({
							nextAttemptAt: DateTime.toDate(DateTime.makeUnsafe("2026-09-16T00:00:00.000Z")),
						})
						.where(eq(automationRun.id, pinned.id));
					expect(yield* repo.listQueuedCandidates({ now, limit: 10 })).toEqual([]);
					yield* db
						.update(automationRun)
						.set({ startedAt: now, attemptCount: 1, finishedAt: now, status: "succeeded" })
						.where(eq(automationRun.id, pinned.id));
					expect(yield* repo.insertQueued(pinned)).toMatchObject({
						attemptCount: 1,
						status: "succeeded",
					});
					expect(
						yield* repo.insertQueued({ ...pinned, scriptContentHash: "changed" }).pipe(Effect.flip),
					).toMatchObject({ _tag: "DbError" });
					expect(yield* repo.listQueuedCandidates({ now, limit: 10 })).toEqual([]);
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
					expect(yield* repo.insertQueued(pluginRun)).toEqual(pluginRun);
					const disabledUserRun = yield* Schema.decodeEffect(AutomationRun)({
						...pluginRun,
						id: "disabled-user-run",
						executionUserId: "owner",
					});
					expect(yield* repo.insertQueued(disabledUserRun)).toEqual(disabledUserRun);
					expect(
						yield* repo.insertQueued({ ...pluginRun, hookName: "Changed" }).pipe(Effect.flip),
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
					yield* repo.insertQueued(policy);
					expect(yield* repo.listQueuedCandidates({ now, limit: 10 })).toEqual([
						disabledUserRun,
						pluginRun,
					]);
				}).pipe(
					Effect.provide(
						Layer.mergeAll(AutomationRunRepository.layer, AutomationTriggerRepository.layer),
					),
				),
			),
	);
});
