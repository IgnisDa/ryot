import { expect, it } from "@effect/vitest";
import { DEFAULT_AUTOMATION_RETRY_POLICY } from "@ryot-app/contract/modules/automations/lifecycle";
import { SignalSchemaSlug } from "@ryot-app/contract/schema/brands";
import { asc, eq } from "drizzle-orm";
import { Effect, Layer, Ref } from "effect";
import { describe } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database } from "#lib/infrastructure/db/service";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { withRevisionDatabase } from "#modules/plugins/revision.test-support";
import { ScriptGarbageCollector } from "#modules/plugins/script-garbage-collector";

import { AutomationAttemptRepository } from "./attempt-repository";
import { AutomationRetention } from "./retention";
import { AutomationRunRepository } from "./run-repository";
import { AutomationTriggerRepository } from "./trigger-repository";

const now = new Date("2026-09-16T00:00:00.000Z");
const old = new Date("2026-08-01T00:00:00.000Z");
const recent = new Date("2026-09-01T00:00:00.000Z");
const expired = new Date("2026-08-08T00:00:00.000Z");
const retryableUntil = new Date("2026-09-20T00:00:00.000Z");

const payload = {
	properties: {},
	actorUserId: null,
	operation: "emit" as const,
	signalSchemaPluginId: null,
	category: "signal" as const,
	resource: "signal" as const,
	signalSchemaSlug: SignalSchemaSlug.make("fixture.signal"),
};

const run = (input: {
	id: string;
	status: "queued" | "running" | "failed" | "succeeded";
	queuedAt: Date;
	triggerId: string;
	artifactsExpireAt: Date;
}) => ({
	...input,
	hookSlug: input.id,
	hookName: input.id,
	historyPayload: payload,
	stage: "after" as const,
	scriptContentHash: "hash",
	delivery: "async" as const,
	scriptSlug: "kernel.fixture",
	sandboxScriptId: "kernel-script",
	retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
	attemptCount: input.status === "running" ? 1 : 0,
	startedAt: input.status === "running" ? input.queuedAt : null,
});

describe("AutomationRetention", () => {
	it.effect(
		"prunes expired artifacts and history without touching active or retryable references",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const db = yield* Database;
					yield* db
						.insert(tables.sandboxScript)
						.values({
							name: "Kernel",
							source: "source",
							id: "kernel-script",
							contentHash: "hash",
							compiledCode: "code",
							slug: "kernel.fixture",
							metadata: { kind: "automation" },
						});
					yield* db
						.insert(tables.automationTrigger)
						.values(
							["shared", "queued", "running", "retryable", "orphan"].map((id) => ({
								id,
								payload,
								depth: 0,
								createdAt: old,
								occurredAt: old,
								source: "api" as const,
								operation: "emit" as const,
								category: "signal" as const,
								executionId: `execution-${id}`,
								resourceKind: "signal" as const,
								initiatorKind: "system" as const,
								rootExecutionId: `execution-${id}`,
							})),
						);
					yield* db.insert(tables.automationTriggerRecipient).values([
						{ userId: "owner", triggerId: "shared" },
						{ userId: "recipient", triggerId: "shared" },
						{ userId: "owner", triggerId: "orphan" },
					]);
					yield* db
						.insert(tables.automationRun)
						.values([
							run({
								id: "old-run",
								queuedAt: old,
								status: "succeeded",
								triggerId: "shared",
								artifactsExpireAt: expired,
							}),
							run({
								id: "recent-run",
								queuedAt: recent,
								status: "succeeded",
								triggerId: "shared",
								artifactsExpireAt: expired,
							}),
							run({
								queuedAt: old,
								id: "queued-run",
								status: "queued",
								triggerId: "queued",
								artifactsExpireAt: expired,
							}),
							run({
								queuedAt: old,
								status: "failed",
								id: "retryable-run",
								triggerId: "retryable",
								artifactsExpireAt: retryableUntil,
							}),
							run({
								queuedAt: old,
								id: "running-run",
								status: "running",
								triggerId: "running",
								artifactsExpireAt: expired,
							}),
						]);
					yield* db.insert(tables.automationRunAttempt).values([
						{
							startedAt: old,
							retryable: false,
							attemptNumber: 1,
							status: "running",
							runId: "running-run",
							id: "running-attempt",
							workflowExecutionId: "running-workflow",
						},
						{
							logs: [],
							startedAt: old,
							historyLogs: [],
							finishedAt: old,
							retryable: false,
							attemptNumber: 1,
							status: "succeeded",
							runId: "recent-run",
							id: "recent-attempt",
							returnedValue: { retained: false },
							workflowExecutionId: "recent-workflow",
						},
						{
							logs: [],
							startedAt: old,
							historyLogs: [],
							finishedAt: old,
							retryable: true,
							status: "failed",
							attemptNumber: 1,
							runId: "retryable-run",
							id: "retryable-attempt",
							failureKind: "sandbox-timeout",
							workflowExecutionId: "retryable-workflow",
							error: { code: "retry", message: "retry" },
						},
					]);

					const collections = yield* Ref.make<ReadonlyArray<{ now: Date; limit: number }>>([]);
					const collector = Layer.succeed(ScriptGarbageCollector, {
						collect: (input) =>
							(input ? Ref.update(collections, (values) => [...values, input]) : Effect.void).pipe(
								Effect.as({ removedCount: 0, candidateCount: 0 }),
							),
					});
					const retentionLayer = AutomationRetention.layer.pipe(
						Layer.provide(
							Layer.mergeAll(
								collector,
								makeAppConfigLayer(),
								AutomationRunRepository.layer,
								AutomationAttemptRepository.layer,
								AutomationTriggerRepository.layer,
							),
						),
					);
					const results = yield* Effect.gen(function* () {
						const retention = yield* AutomationRetention;
						return [yield* retention.runBatch(now, 1), yield* retention.runBatch(now, 1)] as const;
					}).pipe(Effect.provide(retentionLayer));

					expect(results).toEqual([
						{
							deletedRuns: 1,
							prunedAttempts: 1,
							prunedTriggers: 1,
							deletedTriggers: 1,
							clearedScriptPins: 1,
							garbageCollection: { removedCount: 0, candidateCount: 0 },
						},
						{
							deletedRuns: 0,
							prunedAttempts: 0,
							prunedTriggers: 1,
							deletedTriggers: 0,
							clearedScriptPins: 1,
							garbageCollection: { removedCount: 0, candidateCount: 0 },
						},
					]);
					expect(yield* Ref.get(collections)).toEqual([
						{ now, limit: 1 },
						{ now, limit: 1 },
					]);
					expect(
						(yield* db
							.select()
							.from(tables.automationRun)
							.orderBy(asc(tables.automationRun.id))).map(
							({ id, historyPayload, sandboxScriptId }) => ({
								id,
								historyPayload,
								sandboxScriptId,
							}),
						),
					).toEqual([
						{ id: "queued-run", historyPayload: payload, sandboxScriptId: "kernel-script" },
						{ id: "recent-run", historyPayload: null, sandboxScriptId: null },
						{ id: "retryable-run", historyPayload: payload, sandboxScriptId: "kernel-script" },
						{ id: "running-run", historyPayload: payload, sandboxScriptId: "kernel-script" },
					]);
					expect(yield* db.select().from(tables.automationTriggerRecipient)).toEqual([
						{ userId: "owner", triggerId: "shared" },
						{ userId: "recipient", triggerId: "shared" },
					]);
					const [recentAttempt] = yield* db
						.select()
						.from(tables.automationRunAttempt)
						.where(eq(tables.automationRunAttempt.id, "recent-attempt"));
					expect(recentAttempt).toMatchObject({
						logs: null,
						error: null,
						historyLogs: null,
						historyError: null,
						returnedValue: null,
						artifactsPrunedAt: now,
					});
					const [retryableAttempt] = yield* db
						.select()
						.from(tables.automationRunAttempt)
						.where(eq(tables.automationRunAttempt.id, "retryable-attempt"));
					expect(retryableAttempt).toMatchObject({
						logs: [],
						historyLogs: [],
						artifactsPrunedAt: null,
						error: { code: "retry", message: "retry" },
					});
					const triggers = yield* db
						.select()
						.from(tables.automationTrigger)
						.orderBy(asc(tables.automationTrigger.id));
					expect(triggers.map(({ id, payloadPrunedAt }) => ({ id, payloadPrunedAt }))).toEqual([
						{ id: "queued", payloadPrunedAt: null },
						{ id: "retryable", payloadPrunedAt: null },
						{ id: "running", payloadPrunedAt: null },
						{ id: "shared", payloadPrunedAt: now },
					]);
				}),
			),
	);
});
