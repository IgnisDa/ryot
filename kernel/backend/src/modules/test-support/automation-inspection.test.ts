import { expect, it } from "@effect/vitest";
import { AutomationTrigger } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationHookSlug,
	AutomationRunId,
	AutomationTriggerId,
	EntityId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";
import { describe } from "vitest";

import {
	automationRun,
	automationRunAttempt,
} from "#lib/infrastructure/db/schema/tables/automations";
import { Database } from "#lib/infrastructure/db/service";
import { AutomationHistoryRepository } from "#modules/automations/history-repository";
import { triggerFixture } from "#modules/automations/lifecycle.test-support";
import { AutomationRunRepository } from "#modules/automations/run-repository";
import { AutomationTriggerRepository } from "#modules/automations/trigger-repository";
import { withRevisionDatabase } from "#modules/plugins/revision.test-support";

import { makeTestSupportAutomationInspection } from "./service";

const repositories = Layer.mergeAll(
	AutomationHistoryRepository.layer,
	AutomationRunRepository.layer,
	AutomationTriggerRepository.layer,
);
const queuedAt = new Date("2026-09-15T00:00:01.000Z");
const finishedAt = new Date("2026-09-15T00:00:02.000Z");
const artifactsExpireAt = new Date("2026-10-15T00:00:00.000Z");

describe("test-support automation inspection", () => {
	it.effect("filters triggers, recipients, pinned runs, and attempts", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const db = yield* Database;
				const triggers = yield* AutomationTriggerRepository;
				const inspection = yield* makeTestSupportAutomationInspection;
				const trigger = triggerFixture("inspection-trigger");
				if (trigger.payload === null) {
					return yield* Effect.die("Trigger fixture must retain its payload");
				}
				const sourceEntityId = EntityId.make("source-entity");
				const entityTrigger = yield* Schema.decodeEffect(AutomationTrigger)({
					...trigger,
					id: "entity-trigger",
					kind: { category: "change", resource: "entity", operation: "create" },
					causation: {
						...trigger.causation,
						executionId: "entity-command",
						rootExecutionId: "entity-command",
					},
					payload: {
						category: "change",
						resource: "entity",
						operation: "create",
						after: {
							name: "Source",
							properties: {},
							externalId: null,
							providerId: null,
							populatedAt: null,
							id: sourceEntityId,
							entitySchemaSlug: "fixture-entity",
							createdAt: "2026-09-15T00:00:00.000Z",
							updatedAt: "2026-09-15T00:00:00.000Z",
						},
					},
				});
				yield* triggers.insert(trigger);
				yield* triggers.insert(entityTrigger);
				yield* triggers.insertRecipients(trigger.id, [UserId.make("owner")]);

				const runId = AutomationRunId.make("inspection-run");
				yield* db
					.insert(automationRun)
					.values({
						queuedAt,
						id: runId,
						finishedAt,
						stage: "after",
						pluginId: null,
						attemptCount: 1,
						status: "failed",
						delivery: "async",
						artifactsExpireAt,
						hookName: "Notify",
						triggerId: trigger.id,
						sandboxScriptId: null,
						pluginRevisionId: null,
						executionUserId: "owner",
						hookSlug: "fixture.notify",
						scriptSlug: "notification",
						pluginConfigRevisionId: null,
						scriptContentHash: "content-hash",
						retryPolicy: {
							maxAttempts: 2,
							maxDelayMs: 10_000,
							initialDelayMs: 1_000,
							externalIdempotency: "none",
						},
					});
				yield* db
					.insert(automationRunAttempt)
					.values({
						runId,
						finishedAt,
						retryable: false,
						status: "failed",
						attemptNumber: 1,
						startedAt: queuedAt,
						returnedValue: null,
						id: "inspection-attempt",
						failureKind: "business-failure",
						workflowExecutionId: "inspection-execution",
						error: { message: "failed", code: "fixture-failure" },
					});

				expect(
					yield* inspection.listAutomationTriggers({
						payload: trigger.payload,
						rootExecutionId: trigger.causation.rootExecutionId,
						triggerId: AutomationTriggerId.make("inspection-trigger"),
					}),
				).toEqual([trigger]);
				expect(
					yield* inspection.listAutomationTriggerRecipients({
						triggerId: trigger.id,
						userId: UserId.make("owner"),
					}),
				).toEqual([{ triggerId: trigger.id, userId: UserId.make("owner") }]);
				const listedRuns = yield* inspection.listAutomationRuns({
					status: "failed",
					executionUserId: UserId.make("owner"),
					rootExecutionId: trigger.causation.rootExecutionId,
					hookSlug: AutomationHookSlug.make("fixture.notify"),
				});
				expect(listedRuns.map(({ id }) => id)).toEqual([runId]);
				expect(
					(yield* inspection.listAutomationRunAttempts({ runId, status: "failed" })).map(
						({ id }) => id,
					),
				).toEqual(["inspection-attempt"]);
				expect(
					yield* inspection.listAutomationTriggers({
						sourceRecord: { id: sourceEntityId, resource: "entity" },
					}),
				).toEqual([entityTrigger]);
				return undefined;
			}).pipe(Effect.provide(repositories)),
		),
	);
});
