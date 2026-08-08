import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type { AutomationOccurrence } from "@ryot-app/contract/modules/automations/schemas";
import {
	AutomationOccurrenceId,
	AutomationRuleId,
	SandboxScriptId,
	SignalId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Result, Layer, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { databaseLayer, makeWorkflowActivityEngine } from "#lib/test-utils/effect";
import type { ResolvedAutomationRule } from "#modules/plugins/runtime-resolver";
import { SignalDispatch } from "#modules/signals/dispatch";

import { AutomationsService } from "./service";
import { SignalDispatchLive } from "./signal-dispatch";
import { SubscriptionExecutionWorkflow } from "./subscription-execution-workflow";

const userId = UserId.make("user-1");
const otherUserId = UserId.make("user-2");
const signalSchemaSlug = SignalSchemaSlug.make("signal-schema-1");
const scriptId = SandboxScriptId.make("script-1");

const rule = (id: string, owner: UserId | null): ResolvedAutomationRule => ({
	userId: owner,
	position: null,
	metadata: null,
	isActive: true,
	name: `Rule ${id}`,
	operation: "signal",
	kind: "subscription",
	isBuiltin: owner === null,
	sandboxScriptId: scriptId,
	id: AutomationRuleId.make(id),
	target: { id: signalSchemaSlug, kind: "signal_schema" },
});

const signal = {
	actorUserId: null,
	origin: { kind: "api" },
	id: SignalId.make("signal-1"),
	properties: { message: "trace" },
	occurredAt: "2026-07-20T10:00:00.000Z",
	recipientUserIds: [userId, otherUserId],
	signalSchemaSlug: SignalSchemaSlug.make("review.created"),
} as const;

it.effect("matches shared signals once per global rule and recipient-owned rule", () => {
	const globalRule = rule("global", null);
	const firstUserRule = rule("user-1", userId);
	const secondUserRule = rule("user-2", otherUserId);
	const resolvedScopes: Array<UserId | null> = [];
	const occurrences: AutomationOccurrence[] = [];
	const executions: Array<{
		occurrenceId: AutomationOccurrenceId;
		rowUserId: UserId | null;
		ruleId: AutomationRuleId;
	}> = [];
	const instance = WorkflowInstance.initial(SubscriptionExecutionWorkflow, "dispatch-test");
	const engine = makeWorkflowActivityEngine(instance, {
		execute: (_workflow, options) => {
			const payload = Schema.decodeUnknownSync(
				Schema.Struct({
					ruleId: AutomationRuleId,
					rowUserId: Schema.NullOr(UserId),
					occurrenceId: AutomationOccurrenceId,
				}),
			)(options.payload);
			executions.push(payload);
			return Effect.void;
		},
	});
	const automations = Layer.mock(AutomationsService, {
		recordOccurrence: (occurrence) =>
			Effect.sync(() => {
				occurrences.push(occurrence);
				return occurrence;
			}),
		resolveActive: ({ rowUserId }) => {
			resolvedScopes.push(rowUserId);
			if (rowUserId === null) {
				return Effect.succeed([globalRule]);
			}
			return Effect.succeed([globalRule, rowUserId === userId ? firstUserRule : secondUserRule]);
		},
	});
	const layer = Layer.provideMerge(
		SignalDispatchLive,
		Layer.mergeAll(databaseLayer, automations, Layer.succeed(WorkflowEngine, engine)),
	);

	return Effect.gen(function* () {
		const dispatch = yield* SignalDispatch;
		yield* dispatch.dispatch(signal);
		expect(resolvedScopes).toEqual([null, userId, otherUserId]);
		expect(executions).toEqual([
			{
				rowUserId: null,
				ruleId: globalRule.id,
				occurrenceId: AutomationOccurrenceId.make("signal-1"),
			},
			{
				rowUserId: userId,
				ruleId: firstUserRule.id,
				occurrenceId: AutomationOccurrenceId.make("signal-1"),
			},
			{
				rowUserId: otherUserId,
				ruleId: secondUserRule.id,
				occurrenceId: AutomationOccurrenceId.make("signal-1"),
			},
		]);
		expect(occurrences).toEqual([
			{
				userId: null,
				recordId: null,
				population: null,
				signalId: signal.id,
				operation: "signal",
				sourceKind: "signal",
				origin: { kind: "api" },
				occurredAt: "2026-07-20T10:00:00.000Z",
				id: AutomationOccurrenceId.make("signal-1"),
				source: {
					kind: "signal",
					signal: {
						id: signal.id,
						origin: { kind: "api" },
						properties: { message: "trace" },
						occurredAt: "2026-07-20T10:00:00.000Z",
						signalSchemaSlug: SignalSchemaSlug.make("review.created"),
					},
				},
			},
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("attempts every sibling workflow when one enqueue fails", () => {
	const firstRule = rule("first", userId);
	const secondRule = rule("second", userId);
	const attempted: AutomationRuleId[] = [];
	const instance = WorkflowInstance.initial(SubscriptionExecutionWorkflow, "isolation-test");
	const engine = makeWorkflowActivityEngine(instance, {
		execute: (_workflow, options) => {
			const payload = Schema.decodeUnknownSync(Schema.Struct({ ruleId: AutomationRuleId }))(
				options.payload,
			);
			attempted.push(payload.ruleId);
			return payload.ruleId === firstRule.id
				? Effect.fail(new DbError({ message: "enqueue failed" }))
				: Effect.void;
		},
	});
	const automations = Layer.mock(AutomationsService, {
		recordOccurrence: (occurrence) => Effect.succeed(occurrence),
		resolveActive: () => Effect.succeed([firstRule, secondRule]),
	});
	const layer = Layer.provideMerge(
		SignalDispatchLive,
		Layer.mergeAll(databaseLayer, automations, Layer.succeed(WorkflowEngine, engine)),
	);

	return Effect.gen(function* () {
		const dispatch = yield* SignalDispatch;
		const result = yield* Effect.result(
			dispatch.dispatch({ ...signal, actorUserId: userId, recipientUserIds: [userId] }),
		);
		expect(attempted).toEqual([firstRule.id, secondRule.id]);
		expect(Result.isFailure(result)).toBe(true);
	}).pipe(Effect.provide(layer));
});
