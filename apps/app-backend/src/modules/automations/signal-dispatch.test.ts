import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { DbError } from "@ryot/contract/errors";
import {
	AutomationRuleId,
	SandboxScriptId,
	SignalId,
	SignalSchemaId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Either, Layer, Schema } from "effect";

import { makeWorkflowActivityEngine } from "#lib/test-utils/effect";
import { SignalDispatch } from "#modules/signals/dispatch";

import type { StoredAutomationRule } from "./repository";
import { AutomationsService } from "./service";
import { SignalDispatchLive } from "./signal-dispatch";
import { SubscriptionExecutionWorkflow } from "./subscription-execution-workflow";

const userId = UserId.make("user-1");
const otherUserId = UserId.make("user-2");
const signalSchemaId = SignalSchemaId.make("signal-schema-1");
const scriptId = SandboxScriptId.make("script-1");

const rule = (id: string, owner: UserId | null): StoredAutomationRule => ({
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
	createdAt: "2026-07-20T10:00:00.000Z",
	updatedAt: "2026-07-20T10:00:00.000Z",
	target: { id: signalSchemaId, kind: "signal_schema" },
});

const signal = {
	signalSchemaId,
	actorUserId: null,
	origin: { kind: "api" },
	id: SignalId.make("signal-1"),
	properties: { message: "trace" },
	occurredAt: "2026-07-20T10:00:00.000Z",
	recipientUserIds: [userId, otherUserId],
	signalSchemaSlug: "automation.test-tracer",
} as const;

it.effect("matches shared signals once per global rule and recipient-owned rule", () => {
	const globalRule = rule("global", null);
	const firstUserRule = rule("user-1", userId);
	const secondUserRule = rule("user-2", otherUserId);
	const resolvedScopes: Array<UserId | null> = [];
	const executions: Array<{ rowUserId: UserId | null; ruleId: AutomationRuleId }> = [];
	const instance = WorkflowInstance.initial(SubscriptionExecutionWorkflow, "dispatch-test");
	const engine = makeWorkflowActivityEngine(instance, {
		execute: (_workflow, options) => {
			const payload = Schema.decodeUnknownSync(
				Schema.Struct({ rowUserId: Schema.NullOr(UserId), ruleId: AutomationRuleId }),
			)(options.payload);
			executions.push({ rowUserId: payload.rowUserId, ruleId: payload.ruleId });
			return Effect.void;
		},
	});
	const automations = Layer.mock(AutomationsService, {
		_tag: "AutomationsService",
		resolveActive: ({ rowUserId }) => {
			resolvedScopes.push(rowUserId);
			if (rowUserId === null) {
				return Effect.succeed([globalRule]);
			}
			return Effect.succeed([globalRule, rowUserId === userId ? firstUserRule : secondUserRule]);
		},
	});
	const layer = Layer.provide(
		SignalDispatchLive,
		Layer.mergeAll(automations, Layer.succeed(WorkflowEngine, engine)),
	);

	return Effect.gen(function* () {
		const dispatch = yield* SignalDispatch;
		yield* dispatch.dispatch(signal);
		expect(resolvedScopes).toEqual([null, userId, otherUserId]);
		expect(executions).toEqual([
			{ rowUserId: null, ruleId: globalRule.id },
			{ rowUserId: userId, ruleId: firstUserRule.id },
			{ rowUserId: otherUserId, ruleId: secondUserRule.id },
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
		_tag: "AutomationsService",
		resolveActive: () => Effect.succeed([firstRule, secondRule]),
	});
	const layer = Layer.provide(
		SignalDispatchLive,
		Layer.mergeAll(automations, Layer.succeed(WorkflowEngine, engine)),
	);

	return Effect.gen(function* () {
		const dispatch = yield* SignalDispatch;
		const result = yield* Effect.either(
			dispatch.dispatch({ ...signal, actorUserId: userId, recipientUserIds: [userId] }),
		);
		expect(attempted).toEqual([firstRule.id, secondRule.id]);
		expect(Either.isLeft(result)).toBe(true);
	}).pipe(Effect.provide(layer));
});
