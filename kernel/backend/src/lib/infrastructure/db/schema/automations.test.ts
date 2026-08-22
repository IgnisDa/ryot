import { expect, it } from "@effect/vitest";
import { DEFAULT_AUTOMATION_RETRY_POLICY } from "@ryot-app/contract/modules/automations/lifecycle";
import { SignalSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { assert, describe } from "vitest";

import { Database } from "#lib/infrastructure/db/service";
import {
	installRevisionPackage,
	revisionPackage,
	withRevisionDatabase,
} from "#modules/plugins/revision.test-support";

import * as tables from "./tables/combined";

const time = new Date("2026-09-15T00:00:00Z");
const trigger = {
	depth: 0,
	id: "signal",
	source: "api",
	payload: null,
	occurredAt: time,
	operation: "emit",
	category: "signal",
	payloadPrunedAt: time,
	resourceKind: "signal",
	executionId: "command",
	initiatorKind: "system",
	rootExecutionId: "command",
} satisfies typeof tables.automationTrigger.$inferInsert;

const seedRun = Effect.fn(function* () {
	const db = yield* Database;
	const installed = yield* installRevisionPackage(revisionPackage("notes"), UserId.make("owner"));
	const [script] = yield* db
		.select()
		.from(tables.sandboxScript)
		.where(eq(tables.sandboxScript.pluginRevisionId, installed.revisionId));
	assert(script && installed.installation.activeConfigRevisionId);
	yield* db.insert(tables.automationTrigger).values(trigger);
	return {
		id: "run",
		stage: "after",
		delivery: "async",
		hookName: "Notify",
		triggerId: trigger.id,
		scriptSlug: script.slug,
		artifactsExpireAt: time,
		hookSlug: "notes.notify",
		sandboxScriptId: script.id,
		pluginId: installed.pluginId,
		scriptContentHash: script.contentHash,
		pluginRevisionId: installed.revisionId,
		retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
		pluginConfigRevisionId: installed.installation.activeConfigRevisionId,
	} satisfies typeof tables.automationRun.$inferInsert;
});

describe("automation database constraints", () => {
	it.effect(
		"rejects mismatched trigger kinds, unmarked pruning, and incomplete automation causation",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const db = yield* Database;
					const invalid: Array<typeof tables.automationTrigger.$inferInsert> = [
						{ ...trigger, category: "request" },
						{ ...trigger, operation: "create" },
						{ ...trigger, payloadPrunedAt: null },
						{ ...trigger, depth: 1, source: "automation", parentTriggerId: "parent" },
						{ ...trigger, initiatorId: null, initiatorKind: "user" },
						{
							...trigger,
							payloadPrunedAt: null,
							resourceKind: "entity",
							payload: {
								properties: {},
								operation: "emit",
								actorUserId: null,
								category: "signal",
								resource: "signal",
								signalSchemaPluginId: null,
								signalSchemaSlug: SignalSchemaSlug.make("notes.signal"),
							},
						},
					];
					for (const row of invalid) {
						expect(
							Result.isFailure(
								yield* Effect.result(
									db.transaction((tx) => tx.insert(tables.automationTrigger).values(row)),
								),
							),
						).toBe(true);
					}
					yield* db
						.insert(tables.automationTrigger)
						.values({
							...trigger,
							depth: 1,
							source: "automation",
							parentRunId: "pruned-parent-run",
							parentTriggerId: "pruned-parent-trigger",
						});
					expect((yield* db.select().from(tables.automationTrigger)).length).toBe(1);
				}),
			),
	);

	it.effect(
		"enforces complete package pins, exact ownership, policy restrictions, and null-recipient uniqueness",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const db = yield* Database;
					const run = yield* seedRun();
					const other = yield* installRevisionPackage(
						revisionPackage("other"),
						UserId.make("recipient"),
					);
					const [otherScript] = yield* db
						.select()
						.from(tables.sandboxScript)
						.where(eq(tables.sandboxScript.pluginRevisionId, other.revisionId));
					assert(otherScript && other.installation.activeConfigRevisionId);
					const invalid: Array<typeof tables.automationRun.$inferInsert> = [
						{ ...run, pluginId: null },
						{ ...run, pluginId: other.pluginId },
						{ ...run, pluginConfigRevisionId: other.installation.activeConfigRevisionId },
						{ ...run, sandboxScriptId: otherScript.id },
						{ ...run, status: "queued", sandboxScriptId: null },
						{ ...run, stage: "before", delivery: "policy" },
						{ ...run, stage: "before", attemptCount: 2, retryPolicy: null, delivery: "policy" },
						{ ...run, stage: "before", retryPolicy: null, delivery: "policy", nextAttemptAt: time },
					];
					for (const row of invalid) {
						expect(
							Result.isFailure(
								yield* Effect.result(
									db.transaction((tx) => tx.insert(tables.automationRun).values(row)),
								),
							),
						).toBe(true);
					}
					yield* db.insert(tables.automationRun).values(run);
					expect(
						Result.isFailure(
							yield* Effect.result(
								db.transaction((tx) =>
									tx.insert(tables.automationRun).values({ ...run, id: "duplicate" }),
								),
							),
						),
					).toBe(true);
					yield* db
						.insert(tables.automationRun)
						.values({ ...run, id: "recipient-run", executionUserId: "owner" });
					expect((yield* db.select().from(tables.automationRun)).length).toBe(2);
				}),
			),
	);

	it.effect(
		"serializes attempts and cascades recipient-owned history without deleting a shared trigger",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const db = yield* Database;
					const run = yield* seedRun();
					yield* db.insert(tables.automationRun).values({ ...run, executionUserId: "owner" });
					yield* db.insert(tables.automationTriggerRecipient).values([
						{ userId: "owner", triggerId: trigger.id },
						{ userId: "recipient", triggerId: trigger.id },
					]);
					const attempt = {
						id: "attempt",
						runId: run.id,
						startedAt: time,
						attemptNumber: 1,
						retryable: false,
						status: "running",
						workflowExecutionId: "attempt-workflow",
					} satisfies typeof tables.automationRunAttempt.$inferInsert;
					yield* db.insert(tables.automationRunAttempt).values(attempt);
					expect(
						Result.isFailure(
							yield* Effect.result(
								db.transaction((tx) =>
									tx
										.insert(tables.automationRunAttempt)
										.values({
											...attempt,
											id: "parallel",
											attemptNumber: 2,
											workflowExecutionId: "parallel-workflow",
										}),
								),
							),
						),
					).toBe(true);
					yield* db
						.update(tables.automationRunAttempt)
						.set({ status: "failed", finishedAt: time })
						.where(eq(tables.automationRunAttempt.id, attempt.id));
					for (const row of [
						{ ...attempt, id: "duplicate-number", workflowExecutionId: "other-workflow" },
						{ ...attempt, attemptNumber: 2, id: "duplicate-workflow" },
						{
							...attempt,
							attemptNumber: 2,
							id: "unfinished-terminal",
							status: "succeeded" as const,
							workflowExecutionId: "next-workflow",
						},
					]) {
						expect(
							Result.isFailure(
								yield* Effect.result(
									db.transaction((tx) => tx.insert(tables.automationRunAttempt).values(row)),
								),
							),
						).toBe(true);
					}
					yield* db
						.insert(tables.automationRunAttempt)
						.values({
							...attempt,
							id: "second",
							attemptNumber: 2,
							workflowExecutionId: "next-workflow",
						});
					yield* db.delete(tables.user).where(eq(tables.user.id, "owner"));
					expect(yield* db.select().from(tables.automationRunAttempt)).toEqual([]);
					expect(yield* db.select().from(tables.automationRun)).toEqual([]);
					expect((yield* db.select().from(tables.automationTrigger)).map(({ id }) => id)).toEqual([
						trigger.id,
					]);
					expect(yield* db.select().from(tables.automationTriggerRecipient)).toEqual([
						{ userId: "recipient", triggerId: trigger.id },
					]);
				}),
			),
	);
});
