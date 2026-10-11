import { assert, expect, layer } from "@effect/vitest";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	PluginId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Context, Effect, Exit, Layer, Option, Queue, Ref } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";
import { describe } from "vitest";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { DefinitionRepository } from "#modules/definitions/repository";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { ClientArtifactsRepository } from "#modules/pages/bundles/repository";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { PluginConfigEncryptionKey } from "#modules/plugins/configuration/encryption-key";
import { PluginConfigRevisions } from "#modules/plugins/configuration/revisions";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { ScriptExecutionServiceLive } from "#modules/scripts/layer";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";
import { makeAppConfigLayer, makeWorkflowEngine } from "#testing/effect";

import { ProviderImportAdmission } from "./admission";
import { admissionDatabaseLayer, alice, bob } from "./admission.test-support";
import { EntityImportWorkflow } from "./entity-import-workflow";

const listedEntity = {
	name: "Dune",
	properties: {},
	providerId: null,
	populatedAt: null,
	externalId: "ext-1",
	id: EntityId.make("entity-1"),
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	entitySchemaSlug: EntitySchemaSlug.make("item"),
	entitySchemaPluginId: PluginId.make("fixture-result-owner"),
};

/** Records starts and interrupts; a started workflow stays suspended until the test settles it. */
class FakeImportWorkflows extends Context.Service<
	FakeImportWorkflows,
	{
		readonly started: Effect.Effect<ReadonlyArray<string>>;
		readonly interrupted: Effect.Effect<ReadonlyArray<string>>;
		readonly nextStarted: Effect.Effect<string>;
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
		const startEvents = yield* Queue.unbounded<string>();
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
						Effect.andThen(Queue.offer(startEvents, options.executionId)),
					),
			}),
		).pipe(
			Context.add(FakeImportWorkflows, {
				settle: setResult,
				started: Ref.get(started),
				interrupted: Ref.get(interrupted),
				nextStarted: Queue.take(startEvents),
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

const catalogueDependencies = Layer.mergeAll(
	ClientArtifactsRepository.layer,
	DefinitionRepository.layer,
	PluginConfigEncryptionKey.layer,
	PluginConfigRevisions.layer,
	PluginInstallationRepository.layer,
);
const pluginsLayer = PluginRepository.layer.pipe(Layer.provide(catalogueDependencies));
const catalogueLayer = Layer.mergeAll(
	catalogueDependencies,
	pluginsLayer,
	PluginRuntimeResolver.layer.pipe(Layer.provide(Layer.merge(catalogueDependencies, pluginsLayer))),
).pipe(Layer.provideMerge(admissionDatabaseLayer));

class AdmissionProviders extends Context.Service<
	AdmissionProviders,
	ReadonlyMap<
		UserId,
		NonNullable<
			Effect.Success<ReturnType<PluginRuntimeResolver["Service"]["findProviderAvailableToUser"]>>
		>
	>
>()("test/AdmissionProviders") {}
const fixturesLayer = Layer.effect(
	AdmissionProviders,
	Effect.gen(function* () {
		const runtime = yield* PluginRuntimeResolver;
		const source = revisionPackage("admission", "v1", "item");
		const entries = yield* Effect.forEach([alice, bob], (userId) =>
			Effect.gen(function* () {
				const installed = yield* installRevisionPackage(source, userId);
				const provider = yield* runtime.findProviderAvailableToUserByReference(userId, {
					slug: "admission-provider",
					owner: definitionOwner(installed.pluginId),
				});
				assert(provider);
				return [userId, provider] as const;
			}),
		);
		return new Map(entries);
	}),
).pipe(Layer.provideMerge(catalogueLayer));

const admissionLayer = ProviderImportAdmission.layer.pipe(
	Layer.provide(Layer.merge(ScriptExecutionServiceLive, DomainWriteChecksLive)),
	Layer.provide(makeAppConfigLayer()),
	Layer.provideMerge(recordingEngineLayer),
	Layer.provideMerge(WorkflowExecutionNotifications.layer),
	Layer.provideMerge(fixturesLayer),
);

const submit = (executionId: string, userId: UserId) =>
	Effect.gen(function* () {
		const admission = yield* ProviderImportAdmission;
		const provider = (yield* AdmissionProviders).get(userId);
		assert(provider);
		return yield* admission.submit({
			userId,
			payload: {
				executionId,
				externalId: executionId,
				providerId: provider.id,
				entityScope: { userId, type: "user" },
				pluginId: PluginId.make(provider.pluginId),
				entitySchemaSlug: EntitySchemaSlug.make("item"),
				command: {
					...rootLifecycleCommand({
						source: "api",
						lane: "interactive",
						itemIdentity: executionId,
						initiator: { id: userId, kind: "user" },
						executionId: AutomationExecutionId.make(executionId),
						occurredAt: IsoUtcString.make("2026-01-01T00:00:00.000Z"),
						accountGeneration: { userId, token: "test-account-generation" },
					}),
					writeContext: null,
				},
			},
		});
	});

const reconcile = Effect.flatMap(ProviderImportAdmission, (admission) => admission.reconcile);

const status = (id: string, userId: UserId) =>
	Effect.flatMap(ProviderImportAdmission, (admission) => admission.status({ id, userId }));

describe("provider import admission", () => {
	layer(admissionLayer)((test) => {
		test.effect("completion wakes admission before the recovery interval advances", () =>
			Effect.gen(function* () {
				const admission = yield* ProviderImportAdmission;
				const workflows = yield* FakeImportWorkflows;
				const notifications = yield* WorkflowExecutionNotifications;
				yield* submit("wake-a1", alice);
				yield* submit("wake-a2", alice);
				yield* submit("wake-a3", alice);
				yield* Effect.forkChild(admission.run);
				expect(new Set([yield* workflows.nextStarted, yield* workflows.nextStarted])).toEqual(
					new Set(["wake-a1", "wake-a2"]),
				);
				expect(yield* status("wake-a3", alice)).toBe("queued");
				yield* workflows.settle(
					"wake-a1",
					new Workflow.Complete({ exit: Exit.succeed(listedEntity) }),
				);
				yield* notifications.publish({
					executionId: "wake-a1",
					workflowName: EntityImportWorkflow._tag,
				});
				expect(yield* workflows.nextStarted).toBe("wake-a3");
				expect(yield* status("wake-a1", alice)).toBeNull();
				expect(yield* status("wake-a3", alice)).toBe("running");
			}),
		);
	});

	layer(admissionLayer)((test) => {
		test.effect("publishes admission only after its running state commits", () =>
			Effect.gen(function* () {
				const notifications = yield* WorkflowExecutionNotifications;
				const hint = yield* notifications.listen({
					executionId: "admission-hint",
					workflowName: EntityImportWorkflow._tag,
				});
				yield* submit("admission-hint", alice);
				yield* reconcile;
				yield* hint;
				expect(yield* status("admission-hint", alice)).toBe("running");
			}),
		);
	});
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
