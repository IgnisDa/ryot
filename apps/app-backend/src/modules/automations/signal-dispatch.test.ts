import { expect, it } from "@effect/vitest";
import { AutomationRuleId, SignalId, SignalSchemaId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { dbRunnerLayer, makeWorkflowEngine } from "#lib/test-support/effect";

import { AutomationsRepository } from "./repository";
import { AutomationsService } from "./service";
import { dispatchSignalSubscriptions, emitAndDispatchSignal } from "./signal-dispatch";

const now = "2026-07-14T00:00:00.000Z";
const signalId = SignalId.make("signal-1");

const makeDispatch = (ruleId: string, automationDepth: number) => ({
	automationDepth,
	actorUserId: null,
	signalId: "signal-1",
	origin: "automation",
	subjectEntityId: null,
	correlationId: "corr-1",
	signalSchemaName: "Signal",
	signalSchemaSlug: "signal",
	properties: { foo: "bar" },
	createdAt: new Date(now),
	occurredAt: new Date(now),
	userId: UserId.make("user-1"),
	signalSchemaId: "signal-schema-1",
	ruleId: AutomationRuleId.make(ruleId),
});

const emitInput = {
	id: signalId,
	trusted: true,
	properties: {},
	automationDepth: 0,
	correlationId: "corr-1",
	occurredAt: new Date(now),
	signalSchemaId: SignalSchemaId.make("signal-schema-1"),
	origin: { kind: "automation" as const, executionId: "exec-1" },
	principal: { kind: "user" as const, userId: UserId.make("user-1") },
};

type Captured = { executionId: string; payload: unknown };

const makeEngine = (captured: Captured[]) =>
	makeWorkflowEngine({
		execute: (_workflow, options) => {
			captured.push({ executionId: options.executionId, payload: options.payload });
			return Effect.succeed(options.executionId);
		},
	});

const repositoryLayer = (
	listSignalDispatches: () => Effect.Effect<ReadonlyArray<ReturnType<typeof makeDispatch>>>,
) =>
	Layer.succeed(
		AutomationsRepository,
		Object.assign(Object.create(null), { listSignalDispatches }),
	);

const serviceLayer = (
	emitSignal: () => Effect.Effect<{ signal: { id: SignalId }; duplicate: boolean }>,
) => Layer.succeed(AutomationsService, Object.assign(Object.create(null), { emitSignal }));

it.effect("dispatches one subscription child per dispatch with deterministic ids", () => {
	const captured: Captured[] = [];
	const layer = Layer.mergeAll(
		dbRunnerLayer,
		repositoryLayer(() => Effect.succeed([makeDispatch("rule-a", 3), makeDispatch("rule-b", 3)])),
	);

	return Effect.gen(function* () {
		const result = yield* dispatchSignalSubscriptions(makeEngine(captured), signalId);

		expect(result).toEqual({ count: 2 });
		expect(captured.map((entry) => entry.executionId)).toEqual([
			"signal-subscription-signal-1-rule-a",
			"signal-subscription-signal-1-rule-b",
		]);
		expect(captured[0]?.payload).toMatchObject({
			ruleId: "rule-a",
			automation: {
				ruleId: "rule-a",
				automationDepth: 4,
				operation: "signal",
				occurrenceId: "signal-1",
			},
		});
	}).pipe(Effect.provide(layer));
});

it.effect("emitAndDispatchSignal emits and dispatches a newly created signal", () => {
	let emitCalls = 0;
	let listCalls = 0;
	const captured: Captured[] = [];
	const layer = Layer.mergeAll(
		dbRunnerLayer,
		repositoryLayer(() => {
			listCalls += 1;
			return Effect.succeed([makeDispatch("rule-a", 0)]);
		}),
		serviceLayer(() => {
			emitCalls += 1;
			return Effect.succeed({ signal: { id: signalId }, duplicate: false });
		}),
	);

	return Effect.gen(function* () {
		const emitted = yield* emitAndDispatchSignal(makeEngine(captured), emitInput);

		expect(emitted.duplicate).toBe(false);
		expect(emitCalls).toBe(1);
		expect(listCalls).toBe(1);
		expect(captured).toHaveLength(1);
		expect(captured[0]?.executionId).toBe("signal-subscription-signal-1-rule-a");
	}).pipe(Effect.provide(layer));
});

it.effect("emitAndDispatchSignal re-dispatches idempotently on a duplicate signal", () => {
	// Crash recovery: the signal row already committed on a prior attempt (emitSignal returns a
	// duplicate) but its subscription children may never have been issued. Dispatch must still run,
	// and its deterministic `signal-subscription-<signalId>-<ruleId>` ids let the engine dedup it.
	let emitCalls = 0;
	let listCalls = 0;
	const captured: Captured[] = [];
	const layer = Layer.mergeAll(
		dbRunnerLayer,
		repositoryLayer(() => {
			listCalls += 1;
			return Effect.succeed([makeDispatch("rule-a", 0)]);
		}),
		serviceLayer(() => {
			emitCalls += 1;
			return Effect.succeed({ signal: { id: signalId }, duplicate: true });
		}),
	);

	return Effect.gen(function* () {
		const emitted = yield* emitAndDispatchSignal(makeEngine(captured), emitInput);

		expect(emitted.duplicate).toBe(true);
		expect(emitCalls).toBe(1);
		expect(listCalls).toBe(1);
		expect(captured).toHaveLength(1);
		expect(captured[0]?.executionId).toBe("signal-subscription-signal-1-rule-a");
	}).pipe(Effect.provide(layer));
});
