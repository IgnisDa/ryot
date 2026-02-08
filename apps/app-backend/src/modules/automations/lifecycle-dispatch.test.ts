import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { DbError } from "@ryot/contract/errors";
import {
	AutomationRuleId,
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Either, Layer, Schema } from "effect";

import { makeWorkflowActivityEngine } from "#lib/test-utils/effect";
import {
	LifecycleDispatch,
	type LifecycleDispatchInput,
} from "#modules/entities/lifecycle-dispatch";

import { LifecycleDispatchLive } from "./lifecycle-dispatch";
import type { AutomationRuleTarget, StoredAutomationRule } from "./repository";
import { AutomationsService } from "./service";
import { SubscriptionExecutionWorkflow } from "./subscription-execution-workflow";

const userId = UserId.make("user-1");
const scriptId = SandboxScriptId.make("script-1");
const eventSchemaSlug = EventSchemaSlug.make("finished");
const entitySchemaSlug = EntitySchemaSlug.make("book");

const rule = (id: string, owner: UserId | null): StoredAutomationRule => ({
	userId: owner,
	position: null,
	metadata: null,
	isActive: true,
	name: `Rule ${id}`,
	operation: "create",
	kind: "subscription",
	isBuiltin: owner === null,
	sandboxScriptId: scriptId,
	id: AutomationRuleId.make(id),
	createdAt: "2026-07-20T10:00:00.000Z",
	updatedAt: "2026-07-20T10:00:00.000Z",
	target: { id: entitySchemaSlug, kind: "entity_schema" },
});

const entitySnapshot = {
	name: "Dune",
	entitySchemaSlug: "book",
	properties: { year: 1965 },
	id: EntityId.make("entity-1"),
};

const entityInput: LifecycleDispatchInput = {
	rowUserId: userId,
	recordId: "entity-1",
	origin: { kind: "api" },
	occurrenceId: "occ_entity-1",
	occurredAt: "2026-07-20T10:00:00.000Z",
	source: { kind: "entity", after: entitySnapshot },
};

const executionEngine = (
	instance: WorkflowInstance["Type"],
	capture: (payload: unknown) => Effect.Effect<void, DbError>,
) =>
	makeWorkflowActivityEngine(instance, {
		execute: (_workflow, options) => capture(options.payload),
	});

it.effect("resolves create rules for the source target and enqueues one execution per rule", () => {
	const globalRule = rule("global", null);
	const userRule = rule("user", userId);
	const resolved: Array<{ target: AutomationRuleTarget; operation: string }> = [];
	const executions: Array<Record<string, unknown>> = [];
	const instance = WorkflowInstance.initial(SubscriptionExecutionWorkflow, "lifecycle-test");
	const engine = executionEngine(instance, (payload) => {
		executions.push(
			Schema.decodeUnknownSync(
				Schema.Struct({
					ruleId: Schema.String,
					operation: Schema.String,
					sourceKind: Schema.String,
					occurrenceId: Schema.String,
					recordId: Schema.optional(Schema.String),
				}),
			)(payload),
		);
		return Effect.void;
	});
	const automations = Layer.mock(AutomationsService, {
		_tag: "AutomationsService",
		resolveActive: ({ target, operation }) => {
			resolved.push({ target, operation });
			return Effect.succeed([globalRule, userRule]);
		},
	});
	const layer = Layer.provide(
		LifecycleDispatchLive,
		Layer.mergeAll(automations, Layer.succeed(WorkflowEngine, engine)),
	);

	return Effect.gen(function* () {
		const dispatch = yield* LifecycleDispatch;
		yield* dispatch.dispatch(entityInput);
		expect(resolved).toEqual([
			{ operation: "create", target: { id: entitySchemaSlug, kind: "entity_schema" } },
		]);
		expect(executions).toEqual([
			{
				operation: "create",
				sourceKind: "entity",
				recordId: "entity-1",
				ruleId: globalRule.id,
				occurrenceId: "occ_entity-1",
			},
			{
				operation: "create",
				ruleId: userRule.id,
				sourceKind: "entity",
				recordId: "entity-1",
				occurrenceId: "occ_entity-1",
			},
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("derives the rule target from each lifecycle source kind", () => {
	const resolvedTargets: AutomationRuleTarget[] = [];
	const instance = WorkflowInstance.initial(SubscriptionExecutionWorkflow, "target-test");
	const engine = executionEngine(instance, () => Effect.void);
	const automations = Layer.mock(AutomationsService, {
		_tag: "AutomationsService",
		resolveActive: ({ target }) => {
			resolvedTargets.push(target);
			return Effect.succeed([]);
		},
	});
	const layer = Layer.provide(
		LifecycleDispatchLive,
		Layer.mergeAll(automations, Layer.succeed(WorkflowEngine, engine)),
	);

	return Effect.gen(function* () {
		const dispatch = yield* LifecycleDispatch;
		yield* dispatch.dispatch(entityInput);
		yield* dispatch.dispatch({
			rowUserId: userId,
			recordId: "event-1",
			origin: { kind: "api" },
			occurrenceId: "occ_event-1",
			occurredAt: "2026-07-20T10:00:00.000Z",
			source: {
				kind: "event",
				after: {
					properties: {},
					eventSchemaSlug: "finished",
					id: EventId.make("event-1"),
					occurredAt: "2026-07-20T10:00:00.000Z",
					subject: { id: EntityId.make("entity-1"), name: "Dune", entitySchemaSlug: "book" },
				},
			},
		});
		expect(resolvedTargets).toEqual([
			{ id: entitySchemaSlug, kind: "entity_schema" },
			{ id: eventSchemaSlug, kind: "event_schema" },
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("forwards update snapshots and trusted population context", () => {
	const executions: unknown[] = [];
	const resolved: Array<{ target: AutomationRuleTarget; operation: string }> = [];
	const updateRule = { ...rule("media-update", null), operation: "update" as const };
	const instance = WorkflowInstance.initial(SubscriptionExecutionWorkflow, "update-test");
	const engine = executionEngine(instance, (payload) => {
		executions.push(payload);
		return Effect.void;
	});
	const automations = Layer.mock(AutomationsService, {
		_tag: "AutomationsService",
		resolveActive: ({ target, operation }) => {
			resolved.push({ target, operation });
			return Effect.succeed([updateRule]);
		},
	});
	const layer = Layer.provide(
		LifecycleDispatchLive,
		Layer.mergeAll(automations, Layer.succeed(WorkflowEngine, engine)),
	);

	return Effect.gen(function* () {
		const svc = yield* LifecycleDispatch;
		yield* svc.dispatch({
			...entityInput,
			operation: "update",
			source: {
				kind: "entity",
				after: entitySnapshot,
				before: { ...entitySnapshot, name: "Old Dune" },
			},
			population: {
				rootPreviouslyPopulated: true,
				scopeEntity: {
					name: "Severance",
					entitySchemaSlug: "show",
					id: EntityId.make("show-1"),
				},
			},
		});
		expect(resolved).toEqual([
			{ operation: "update", target: { id: entitySchemaSlug, kind: "entity_schema" } },
		]);
		expect(executions).toMatchObject([
			{
				operation: "update",
				source: { kind: "entity", after: { name: "Dune" }, before: { name: "Old Dune" } },
				population: {
					rootPreviouslyPopulated: true,
					scopeEntity: { id: "show-1", name: "Severance" },
				},
			},
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("attempts every sibling workflow and fails when one enqueue fails", () => {
	const firstRule = rule("first", userId);
	const secondRule = rule("second", userId);
	const attempted: string[] = [];
	const instance = WorkflowInstance.initial(SubscriptionExecutionWorkflow, "isolation-test");
	const engine = executionEngine(instance, (payload) => {
		const { ruleId } = Schema.decodeUnknownSync(Schema.Struct({ ruleId: Schema.String }))(payload);
		attempted.push(ruleId);
		return ruleId === firstRule.id
			? Effect.fail(new DbError({ message: "enqueue failed" }))
			: Effect.void;
	});
	const automations = Layer.mock(AutomationsService, {
		_tag: "AutomationsService",
		resolveActive: () => Effect.succeed([firstRule, secondRule]),
	});
	const layer = Layer.provide(
		LifecycleDispatchLive,
		Layer.mergeAll(automations, Layer.succeed(WorkflowEngine, engine)),
	);

	return Effect.gen(function* () {
		const dispatch = yield* LifecycleDispatch;
		const result = yield* Effect.either(dispatch.dispatch(entityInput));
		expect(attempted).toEqual([firstRule.id, secondRule.id]);
		expect(Either.isLeft(result)).toBe(true);
	}).pipe(Effect.provide(layer));
});
