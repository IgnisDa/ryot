import { expect, layer } from "@effect/vitest";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Context, Effect, Exit, Layer, Ref } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { makeWorkflowEngine } from "#lib/test-utils/effect";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";
import { EntityPopulationTrigger } from "#modules/entities/population-trigger";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { EntityPopulationTriggerLive } from "./population-trigger-live";

const userId = UserId.make("user-1");
const command = rootLifecycleCommand({
	source: "api",
	itemIdentity: "populate-entity-1",
	initiator: { id: userId, kind: "user" },
	occurredAt: IsoUtcString.make("2026-09-16T00:00:00.000Z"),
	executionId: AutomationExecutionId.make("populate-entity-1"),
	accountGeneration: { userId, token: "test-account-generation" },
});

type ExecuteOptions = Parameters<WorkflowEngine["Service"]["execute"]>[1];

class FakePopulationEnqueues extends Context.Service<
	FakePopulationEnqueues,
	{ readonly executions: Effect.Effect<ReadonlyArray<ExecuteOptions>> }
>()("test/FakePopulationEnqueues") {}

const triggerLayer = (
	resolver: Layer.Layer<PluginRuntimeResolver>,
	enqueue: (options: ExecuteOptions) => Effect.Effect<unknown> = () => Effect.void,
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const executions = yield* Ref.make<ReadonlyArray<ExecuteOptions>>([]);
			const engine = makeWorkflowEngine({
				execute: (_workflow, options) =>
					Ref.update(executions, (all) => [...all, options]).pipe(Effect.andThen(enqueue(options))),
			});
			return EntityPopulationTriggerLive.pipe(
				Layer.provide(
					Layer.mergeAll(
						mutationAdmissionTestLayer,
						resolver,
						Layer.succeed(WorkflowEngine, engine),
					),
				),
				Layer.merge(Layer.succeed(FakePopulationEnqueues, { executions: Ref.get(executions) })),
			);
		}),
	);

const executions = Effect.flatMap(FakePopulationEnqueues, (fake) => fake.executions);

layer(triggerLayer(Layer.mock(PluginRuntimeResolver)({}), () => Effect.die("enqueue failed")))(
	(test) => {
		test.effect("keeps the deterministic ID and exposes enqueue failure", () =>
			Effect.gen(function* () {
				const trigger = yield* EntityPopulationTrigger;
				const exit = yield* Effect.exit(
					trigger.request({
						command,
						userId: null,
						externalId: "record-1",
						entityId: EntityId.make("entity-1"),
						providerId: SandboxProviderId.make("provider-1"),
						entitySchemaSlug: EntitySchemaSlug.make("record"),
					}),
				);

				expect((yield* executions).map(({ executionId }) => executionId)).toEqual([
					"populate-entity-1-test-account-generation",
				]);
				expect(Exit.isFailure(exit)).toBe(true);
			}),
		);
	},
);

layer(
	triggerLayer(
		Layer.mock(PluginRuntimeResolver)({ findProviderAvailableToUser: () => Effect.succeed(null) }),
	),
)((test) => {
	test.effect("does not enqueue user population for a disabled system provider", () =>
		Effect.gen(function* () {
			const trigger = yield* EntityPopulationTrigger;
			yield* trigger.request({
				userId,
				command,
				externalId: "record-1",
				entityId: EntityId.make("entity-1"),
				providerId: SandboxProviderId.make("provider-1"),
				entitySchemaSlug: EntitySchemaSlug.make("record"),
			});
			expect(yield* executions).toEqual([]);
		}),
	);
});

const availableProvider = {
	name: "Provider",
	pluginId: "plugin-id",
	slug: "provider.slug",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	information: { source: "provider" },
	providerId: SandboxProviderId.make("provider-1"),
	rootEntitySchemaSlug: EntitySchemaSlug.make("record"),
};

const providerScopeLayer = (pluginScope: "system" | "user") =>
	triggerLayer(
		Layer.mock(PluginRuntimeResolver)({
			findProviderAvailableToUser: () =>
				Effect.succeed({ ...availableProvider, pluginScope, id: availableProvider.providerId }),
		}),
	);

layer(providerScopeLayer("system"))((test) => {
	test.effect("keeps user-triggered system provider entities global", () =>
		Effect.gen(function* () {
			const trigger = yield* EntityPopulationTrigger;
			yield* trigger.request({
				userId,
				command,
				externalId: "record-1",
				entityId: EntityId.make("entity-1"),
				providerId: SandboxProviderId.make("provider-1"),
				entitySchemaSlug: EntitySchemaSlug.make("record"),
			});
			const [execution] = yield* executions;
			expect(execution?.payload).toMatchObject({
				entityScope: { type: "global", userId: "user-1" },
			});
		}),
	);
});

layer(providerScopeLayer("user"))((test) => {
	test.effect("keeps user-triggered private provider entities user-owned", () =>
		Effect.gen(function* () {
			const trigger = yield* EntityPopulationTrigger;
			yield* trigger.request({
				userId,
				command,
				externalId: "record-1",
				entityId: EntityId.make("entity-1"),
				providerId: SandboxProviderId.make("provider-1"),
				entitySchemaSlug: EntitySchemaSlug.make("record"),
			});
			const [execution] = yield* executions;
			expect(execution?.payload).toMatchObject({ entityScope: { type: "user", userId: "user-1" } });
		}),
	);
});
