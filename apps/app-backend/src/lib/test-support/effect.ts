import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer } from "effect";

import { CurrentDb, DbRunner, TransactionRunner } from "#lib/db";

const provideEmptyDb = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.provideService(effect, CurrentDb, Object.create(null));

export const dbRunnerLayer = Layer.succeed(DbRunner, provideEmptyDb);

export const transactionLayer = Layer.succeed(TransactionRunner, provideEmptyDb);

export function makeMock<T>(defaults: object, overrides?: Partial<T>): T;
export function makeMock(defaults: object, overrides?: object): Record<string, unknown>;
export function makeMock(defaults: object, overrides: object = {}) {
	return Object.assign(Object.create(null), defaults, overrides);
}

type WorkflowEngineOverrides = Omit<Partial<WorkflowEngine["Type"]>, "execute"> & {
	execute?: (...args: Parameters<WorkflowEngine["Type"]["execute"]>) => Effect.Effect<unknown>;
};

export const makeWorkflowEngine = (
	overrides: WorkflowEngineOverrides = {},
): WorkflowEngine["Type"] =>
	Object.assign(Object.create(null), {
		poll: () => Effect.die("unused"),
		resume: () => Effect.die("unused"),
		execute: () => Effect.die("unused"),
		register: () => Effect.die("unused"),
		interrupt: () => Effect.die("unused"),
		deferredDone: () => Effect.die("unused"),
		scheduleClock: () => Effect.die("unused"),
		deferredResult: () => Effect.die("unused"),
		activityExecute: () => Effect.die("unused"),
		...overrides,
	});

export const makeWorkflowActivityEngine = (instance: WorkflowInstance["Type"]) => {
	let engine: WorkflowEngine["Type"];

	engine = makeWorkflowEngine({
		activityExecute: (activity) =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(
					activity.execute.pipe(
						Effect.provideService(WorkflowEngine, engine),
						Effect.provideService(WorkflowInstance, instance),
					),
				);

				return new Workflow.Complete({ exit });
			}),
	});

	return engine;
};
