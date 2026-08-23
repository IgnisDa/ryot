import { expect, layer } from "@effect/vitest";
import { ImportRunId, IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { ProKeyService } from "#lib/infrastructure/pro-key";
import { databaseLayer, makeWorkflowEngine, type MockOverrides } from "#lib/test-utils/effect";
import { ImportsService } from "#modules/imports/service";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { IntegrationsRepository } from "./repository";
import { IntegrationsService } from "./service";

const userId = UserId.make("user-1");
const importRunId = ImportRunId.make("run-1");
const integrationId = IntegrationId.make("integration-1");
const mockRepository = Layer.mock(IntegrationsRepository);
const mockProKey = Layer.mock(ProKeyService)({ isValidated: Effect.succeed(false) });

class FakeAutoDisableClaims extends Context.Service<
	FakeAutoDisableClaims,
	{ readonly calls: Effect.Effect<ReadonlyArray<string>> }
>()("test/FakeAutoDisableClaims") {}

const makeLayer = (
	repository: (
		record: (call: string) => Effect.Effect<void>,
	) => MockOverrides<typeof mockRepository>,
) =>
	IntegrationsService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				mockProKey,
				IntegrationProviderCatalog.layer.pipe(Layer.provide(databaseLayer)),
				Layer.mock(PluginRuntimeResolver)({}),
				Layer.mock(ImportsService, {}),
				Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				Layer.unwrap(
					Effect.gen(function* () {
						const calls = yield* Ref.make<ReadonlyArray<string>>([]);
						return Layer.merge(
							Layer.succeed(FakeAutoDisableClaims, { calls: Ref.get(calls) }),
							mockRepository(repository((call) => Ref.update(calls, (all) => [...all, call]))),
						);
					}),
				),
			),
		),
	);

layer(
	makeLayer(() => ({
		hasAutoDisableClaim: () => Effect.succeed(true),
		insertAutoDisableClaim: () => Effect.die("retry inserted the claim again"),
		disableForUserIfEnabled: () => Effect.die("retry attempted the transition again"),
	})),
)((test) => {
	test.effect("recognizes a committed auto-disable claim when its activity retries", () =>
		Effect.gen(function* () {
			const service = yield* IntegrationsService;
			expect(yield* service.disableIfEnabled(userId, integrationId, importRunId)).toBe(true);
		}),
	);
});

layer(
	makeLayer((record) => ({
		hasAutoDisableClaim: () => Effect.succeed(false),
		disableForUserIfEnabled: () => record("disable").pipe(Effect.as(true)),
		insertAutoDisableClaim: (input) => record(`claim:${input.importRunId}:${input.integrationId}`),
	})),
)((test) => {
	test.effect("persists the winning transition claim atomically", () =>
		Effect.gen(function* () {
			const service = yield* IntegrationsService;
			expect(yield* service.disableIfEnabled(userId, integrationId, importRunId)).toBe(true);
			expect(yield* (yield* FakeAutoDisableClaims).calls).toEqual([
				"disable",
				"claim:run-1:integration-1",
			]);
		}),
	);
});

layer(
	makeLayer((record) => ({
		disableForUserIfEnabled: () => Effect.succeed(false),
		hasAutoDisableClaim: () => record("check").pipe(Effect.as(false)),
		insertAutoDisableClaim: () => Effect.die("losing run inserted a claim"),
	})),
)((test) => {
	test.effect("does not claim a transition won by another run", () =>
		Effect.gen(function* () {
			const service = yield* IntegrationsService;
			expect(yield* service.disableIfEnabled(userId, integrationId, importRunId)).toBe(false);
			expect(yield* (yield* FakeAutoDisableClaims).calls).toEqual(["check", "check"]);
		}),
	);
});
