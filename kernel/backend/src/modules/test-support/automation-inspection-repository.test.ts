import { expect, layer } from "@effect/vitest";
import {
	AutomationTriggerPayload,
	DEFAULT_AUTOMATION_RETRY_POLICY,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationHookSlug,
	AutomationRunId,
	AutomationTriggerId,
	EntityId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import {
	automationRun,
	automationRunAttempt,
	automationTrigger,
	automationTriggerRecipient,
} from "#schema/tables/automations";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { AutomationInspectionRepository } from "./automation-inspection-repository";

const now = new Date("2026-10-01T00:00:00.000Z");
const owner = UserId.make("owner");
const triggerId = AutomationTriggerId.make("signal");
const runId = AutomationRunId.make("run");
const entityId = EntityId.make("entity");

const seed = Effect.gen(function* () {
	const signal = yield* Schema.decodeEffect(AutomationTriggerPayload)({
		operation: "emit",
		actorUserId: owner,
		category: "signal",
		resource: "signal",
		properties: { value: 1 },
		signalSchemaPluginId: null,
		signalSchemaSlug: "fixture.signal",
	});
	const entity = {
		id: "entity",
		name: "Entity",
		properties: {},
		externalId: null,
		providerId: null,
		populatedAt: null,
		entitySchemaPluginId: null,
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
		entitySchemaSlug: "fixture.entity",
	};
	const change = yield* Schema.decodeEffect(AutomationTriggerPayload)({
		before: entity,
		category: "change",
		resource: "entity",
		operation: "delete",
	});
	const imported = yield* Schema.decodeEffect(AutomationTriggerPayload)({
		userId: owner,
		entityId: "entity",
		category: "change",
		operation: "complete",
		externalId: "external",
		providerId: "provider",
		entitySchemaPluginId: null,
		entitySchemaSlug: "fixture.entity",
		resource: "provider-entity-import",
	});
	yield* (yield* DatabaseSession).run((db) =>
		Effect.gen(function* () {
			yield* db.insert(user).values([
				{ id: owner, name: "Owner", email: "owner@example.test" },
				{ id: "other", name: "Other", email: "other@example.test" },
			]);
			const inputs = [
				{ id: triggerId, payload: signal, rootExecutionId: "primary" },
				{ id: "deleted", payload: change, rootExecutionId: "primary" },
				{ id: "imported", payload: imported, rootExecutionId: "primary" },
				...Array.from({ length: 102 }, (_, index) => ({
					rootExecutionId: "pages",
					payload: { ...signal, actorUserId: null },
					id: `page-${String(index).padStart(3, "0")}`,
				})),
			];
			yield* db
				.insert(automationTrigger)
				.values(
					inputs.map((input) => ({
						depth: 0,
						id: input.id,
						createdAt: now,
						occurredAt: now,
						executionId: input.id,
						payload: input.payload,
						source: "api" as const,
						lane: "interactive" as const,
						initiatorKind: "system" as const,
						category: input.payload.category,
						operation: input.payload.operation,
						resourceKind: input.payload.resource,
						rootExecutionId: input.rootExecutionId,
					})),
				);
			yield* db.insert(automationRun).values(
				[
					{ id: runId, executionUserId: owner, status: "failed" as const },
					{ id: "system-run", executionUserId: null, status: "succeeded" as const },
				].map((input) => ({
					triggerId,
					id: input.id,
					queuedAt: now,
					attemptCount: 1,
					hookName: "Hook",
					status: input.status,
					stage: "after" as const,
					hookSlug: "fixture.hook",
					scriptContentHash: "hash",
					delivery: "async" as const,
					scriptSlug: "fixture.script",
					executionUserId: input.executionUserId,
					retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
					artifactsExpireAt: new Date("2026-10-15T00:00:00.000Z"),
				})),
			);
			yield* db
				.insert(automationRunAttempt)
				.values({
					runId,
					id: "attempt",
					startedAt: now,
					finishedAt: now,
					attemptNumber: 1,
					retryable: false,
					status: "failed",
					workflowExecutionId: "workflow",
					logs: [{ level: "info", message: "raw" }],
					historyLogs: [{ level: "info", message: "redacted" }],
				});
			yield* db.insert(automationTriggerRecipient).values([
				{ triggerId, userId: owner },
				{ triggerId, userId: "other" },
			]);
		}),
	);
	return signal;
});

const inspectionLayer = AutomationInspectionRepository.layer.pipe(
	Layer.provideMerge(isolatedDatabaseLayer("automation_inspection_test")),
);

layer(inspectionLayer)((test) => {
	test.effect("filters retained trigger evidence and pages beyond 100 records", () =>
		Effect.gen(function* () {
			const signal = yield* seed;
			const repository = yield* AutomationInspectionRepository;
			expect((yield* repository.listTriggers({ triggerId })).map(({ id }) => id)).toEqual([
				"signal",
			]);
			expect((yield* repository.listTriggers({ actorUserId: owner })).map(({ id }) => id)).toEqual([
				"signal",
			]);
			expect((yield* repository.listTriggers({ payload: signal })).map(({ id }) => id)).toEqual([
				"signal",
			]);
			expect(
				(yield* repository.listTriggers({
					sourceRecord: { id: entityId, resource: "entity" },
				})).map(({ id }) => id),
			).toEqual(["deleted"]);
			expect(
				(yield* repository.listTriggers({
					sourceRecord: { id: entityId, resource: "provider-entity-import" },
				})).map(({ id }) => id),
			).toEqual(["imported"]);
			expect(
				yield* repository.listTriggers({
					sourceRecord: { resource: "entity", id: EntityId.make("absent") },
				}),
			).toEqual([]);
			const first = yield* repository.listTriggers({ actorUserId: null, rootExecutionId: "pages" });
			const second = yield* repository.listTriggers({
				offset: 100,
				actorUserId: null,
				rootExecutionId: "pages",
			});
			expect(first).toHaveLength(100);
			expect(second.map(({ id }) => id)).toEqual(["page-001", "page-000"]);
			expect(new Set([...first, ...second].map(({ id }) => id)).size).toBe(102);
		}),
	);
});

layer(inspectionLayer)((test) => {
	test.effect("returns filtered run pins, raw attempts and recipients for execution tests", () =>
		Effect.gen(function* () {
			yield* seed;
			const repository = yield* AutomationInspectionRepository;
			expect(
				(yield* repository.listRuns({
					triggerId,
					status: "failed",
					executionUserId: owner,
					hookSlug: AutomationHookSlug.make("fixture.hook"),
				})).map(({ id }) => id),
			).toEqual(["run"]);
			expect(
				(yield* repository.listRuns({ triggerId, executionUserId: null })).map(({ id }) => id),
			).toEqual(["system-run"]);
			expect(yield* repository.listRuns({ triggerId, status: "skipped" })).toEqual([]);
			expect(yield* repository.listAttempts({ runId, status: "failed" })).toMatchObject([
				{ id: "attempt", startedAt: now.toISOString(), logs: [{ level: "info", message: "raw" }] },
			]);
			expect(yield* repository.listAttempts({ runId, status: "succeeded" })).toEqual([]);
			expect(yield* repository.listRecipients({ triggerId })).toEqual([
				{ triggerId, userId: "other" },
				{ triggerId, userId: owner },
			]);
			expect(yield* repository.listRecipients({ triggerId, userId: owner })).toEqual([
				{ triggerId, userId: owner },
			]);
		}),
	);
});
