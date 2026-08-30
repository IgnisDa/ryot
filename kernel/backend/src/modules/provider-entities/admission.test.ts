import { expect, layer } from "@effect/vitest";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Context, Effect, Exit, Layer, Option, Ref } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";
import { describe } from "vitest";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-utils/effect";

import { ProviderImportAdmission } from "./admission";
import { admissionDatabaseLayer, alice, bob } from "./admission.test-support";

const listedEntity = {
	name: "Dune",
	properties: {},
	providerId: null,
	populatedAt: null,
	externalId: "ext-1",
	id: EntityId.make("entity-1"),
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	entitySchemaSlug: EntitySchemaSlug.make("book"),
};

/** Records starts and interrupts; a started workflow stays suspended until the test settles it. */
class FakeImportWorkflows extends Context.Service<
	FakeImportWorkflows,
	{
		readonly started: Effect.Effect<ReadonlyArray<string>>;
		readonly interrupted: Effect.Effect<ReadonlyArray<string>>;
		readonly settle: (
			executionId: string,
			result: Workflow.Result<unknown, unknown>,
		) => Effect.Effect<void>;
		readonly forget: (executionId: string) => Effect.Effect<void>;
	}
>()("test/FakeImportWorkflows") {}

const recordingEngineLayer = Layer.effectContext(
	Effect.gen(function* () {
		const started = yield* Ref.make<ReadonlyArray<string>>([]);
		const interrupted = yield* Ref.make<ReadonlyArray<string>>([]);
		const results = yield* Ref.make<ReadonlyMap<string, Workflow.Result<unknown, unknown>>>(
			new Map(),
		);
		const setResult = (executionId: string, result: Workflow.Result<unknown, unknown>) =>
			Ref.update(results, (current) => new Map(current).set(executionId, result));
		return Context.make(
			WorkflowEngine,
			makeWorkflowEngine({
				interrupt: (_workflow, executionId) =>
					Ref.update(interrupted, (all) => [...all, executionId]),
				poll: (_workflow, executionId) =>
					Ref.get(results).pipe(
						Effect.map((current) => Option.fromUndefinedOr(current.get(executionId))),
					),
				execute: (_workflow, options) =>
					Ref.update(started, (all) => [...all, options.executionId]).pipe(
						Effect.andThen(setResult(options.executionId, new Workflow.Suspended())),
					),
			}),
		).pipe(
			Context.add(FakeImportWorkflows, {
				settle: setResult,
				started: Ref.get(started),
				interrupted: Ref.get(interrupted),
				forget: (executionId) =>
					Ref.update(results, (current) => {
						const next = new Map(current);
						next.delete(executionId);
						return next;
					}),
			}),
		);
	}),
);

const admissionLayer = ProviderImportAdmission.layer.pipe(
	Layer.provide(makeAppConfigLayer()),
	Layer.provideMerge(recordingEngineLayer),
	Layer.provideMerge(admissionDatabaseLayer),
);

const submit = (executionId: string, userId: UserId) =>
	Effect.flatMap(ProviderImportAdmission, (admission) =>
		admission.submit({
			userId,
			payload: {
				executionId,
				externalId: executionId,
				entityScope: { userId, type: "user" },
				providerId: SandboxProviderId.make("provider"),
				entitySchemaSlug: EntitySchemaSlug.make("book"),
				command: rootLifecycleCommand({
					source: "api",
					itemIdentity: executionId,
					initiator: { id: userId, kind: "user" },
					executionId: AutomationExecutionId.make(executionId),
					occurredAt: IsoUtcString.make("2026-01-01T00:00:00.000Z"),
				}),
			},
		}),
	);

const reconcile = Effect.flatMap(ProviderImportAdmission, (admission) => admission.reconcile);

const status = (id: string, userId: UserId) =>
	Effect.flatMap(ProviderImportAdmission, (admission) => admission.status({ id, userId }));

describe("provider import admission", () => {
	layer(admissionLayer)((test) => {
		test.effect("starts admitted imports and admits the next one when a slot frees", () =>
			Effect.gen(function* () {
				const workflows = yield* FakeImportWorkflows;
				yield* submit("a1", alice);
				yield* submit("a2", alice);
				yield* submit("a3", alice);

				yield* reconcile;
				expect(yield* workflows.started).toEqual(["a1", "a2"]);
				expect(yield* status("a3", alice)).toBe("queued");

				yield* workflows.settle("a1", new Workflow.Complete({ exit: Exit.succeed(listedEntity) }));
				yield* reconcile;
				expect(yield* workflows.started).toEqual(["a1", "a2", "a3"]);
				expect(yield* status("a1", alice)).toBeNull();
				expect(yield* status("a3", alice)).toBe("running");
			}),
		);
	});

	layer(admissionLayer)((test) => {
		test.effect("restarts an admitted import whose workflow never started", () =>
			Effect.gen(function* () {
				const workflows = yield* FakeImportWorkflows;
				yield* submit("a1", alice);
				yield* reconcile;
				// A restart between admission and the workflow start loses the start.
				yield* workflows.forget("a1");

				yield* reconcile;
				expect(yield* workflows.started).toEqual(["a1", "a1"]);
				expect(yield* status("a1", alice)).toBe("running");
			}),
		);
	});

	layer(admissionLayer)((test) => {
		test.effect("releases the slot of an import that failed", () =>
			Effect.gen(function* () {
				const workflows = yield* FakeImportWorkflows;
				yield* submit("a1", alice);
				yield* submit("a2", alice);
				yield* submit("b1", bob);
				yield* reconcile;
				expect(yield* workflows.started).toEqual(["a1", "b1"]);

				yield* workflows.settle(
					"a1",
					new Workflow.Complete({ exit: Exit.fail("provider failed") }),
				);
				yield* reconcile;
				expect(yield* workflows.started).toEqual(["a1", "b1", "a2"]);
			}),
		);
	});

	layer(admissionLayer)((test) => {
		test.effect("removes a queued import on cancel and interrupts an admitted one", () =>
			Effect.gen(function* () {
				const workflows = yield* FakeImportWorkflows;
				const admission = yield* ProviderImportAdmission;
				yield* submit("a1", alice);
				yield* submit("a2", alice);
				yield* submit("a3", alice);
				yield* reconcile;

				yield* admission.cancel({ id: "a3", userId: alice });
				expect(yield* status("a3", alice)).toBeNull();
				expect(yield* workflows.interrupted).toEqual([]);

				yield* admission.cancel({ id: "a1", userId: alice });
				expect(yield* workflows.interrupted).toEqual(["a1"]);
			}),
		);
	});
});
