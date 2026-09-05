import { expect, it } from "@effect/vitest";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Effect, Exit, Layer, Option } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";
import { describe } from "vitest";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-utils/effect";

import { ProviderImportAdmission } from "./admission";
import { ProviderImportAdmissionRepository } from "./admission-repository";
import { alice, bob, withAdmissionDatabase } from "./admission.test-support";

type Workflows = {
	readonly started: string[];
	readonly interrupted: string[];
	readonly results: Map<string, Workflow.Result<unknown, unknown>>;
};

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
const recordingEngine = (workflows: Workflows) =>
	makeWorkflowEngine({
		poll: (_workflow, executionId) =>
			Effect.succeed(Option.fromUndefinedOr(workflows.results.get(executionId))),
		interrupt: (_workflow, executionId) =>
			Effect.sync(() => {
				workflows.interrupted.push(executionId);
			}),
		execute: (_workflow, options) =>
			Effect.sync(() => {
				workflows.started.push(options.executionId);
				workflows.results.set(options.executionId, new Workflow.Suspended());
			}),
	});

const withAdmission = <E>(
	test: (
		workflows: Workflows,
	) => Effect.Effect<void, E, ProviderImportAdmission | ProviderImportAdmissionRepository>,
) => {
	const workflows: Workflows = { started: [], interrupted: [], results: new Map() };
	return withAdmissionDatabase(
		test(workflows).pipe(
			Effect.provide(
				ProviderImportAdmission.layer.pipe(
					Layer.provideMerge(ProviderImportAdmissionRepository.layer),
					Layer.provide(makeAppConfigLayer()),
					Layer.provide(Layer.succeed(WorkflowEngine, recordingEngine(workflows))),
				),
			),
		),
	);
};

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
	it.effect("starts admitted imports and admits the next one when a slot frees", () =>
		withAdmission((workflows) =>
			Effect.gen(function* () {
				yield* submit("a1", alice);
				yield* submit("a2", alice);
				yield* submit("a3", alice);

				yield* reconcile;
				expect(workflows.started).toEqual(["a1", "a2"]);
				expect(yield* status("a3", alice)).toBe("queued");

				workflows.results.set("a1", new Workflow.Complete({ exit: Exit.succeed(listedEntity) }));
				yield* reconcile;
				expect(workflows.started).toEqual(["a1", "a2", "a3"]);
				expect(yield* status("a1", alice)).toBeNull();
				expect(yield* status("a3", alice)).toBe("running");
			}),
		),
	);

	it.effect("restarts an admitted import whose workflow never started", () =>
		withAdmission((workflows) =>
			Effect.gen(function* () {
				yield* submit("a1", alice);
				yield* reconcile;
				// A restart between admission and the workflow start loses the start.
				workflows.results.delete("a1");

				yield* reconcile;
				expect(workflows.started).toEqual(["a1", "a1"]);
				expect(yield* status("a1", alice)).toBe("running");
			}),
		),
	);

	it.effect("releases the slot of an import that failed", () =>
		withAdmission((workflows) =>
			Effect.gen(function* () {
				yield* submit("a1", alice);
				yield* submit("a2", alice);
				yield* submit("b1", bob);
				yield* reconcile;
				expect(workflows.started).toEqual(["a1", "b1"]);

				workflows.results.set("a1", new Workflow.Complete({ exit: Exit.fail("provider failed") }));
				yield* reconcile;
				expect(workflows.started).toEqual(["a1", "b1", "a2"]);
			}),
		),
	);

	it.effect("removes a queued import on cancel and interrupts an admitted one", () =>
		withAdmission((workflows) =>
			Effect.gen(function* () {
				const admission = yield* ProviderImportAdmission;
				yield* submit("a1", alice);
				yield* submit("a2", alice);
				yield* submit("a3", alice);
				yield* reconcile;

				yield* admission.cancel({ id: "a3", userId: alice });
				expect(yield* status("a3", alice)).toBeNull();
				expect(workflows.interrupted).toEqual([]);

				yield* admission.cancel({ id: "a1", userId: alice });
				expect(workflows.interrupted).toEqual(["a1"]);
			}),
		),
	);
});
