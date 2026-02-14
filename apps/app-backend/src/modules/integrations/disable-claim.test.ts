import { expect, it } from "@effect/vitest";
import { ImportRunId, IntegrationId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { dbRunnerLayer, makeWorkflowEngine, transactionLayer } from "#lib/test-utils/effect";
import { ImportsService } from "#modules/imports/service";
import { IntegrationProviderCatalogLive } from "#modules/plugins/integration-provider-catalog";

import { IntegrationsRepository } from "./repository";
import { IntegrationsService } from "./service";

const userId = UserId.make("user-1");
const importRunId = ImportRunId.make("run-1");
const integrationId = IntegrationId.make("integration-1");
const mockRepository = Layer.mock(IntegrationsRepository);

const makeLayer = (repository: Layer.Layer<IntegrationsRepository>) =>
	IntegrationsService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				repository,
				IntegrationProviderCatalogLive,
				Layer.mock(ImportsService, {}),
				Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
			),
		),
	);

it.effect("recognizes a committed auto-disable claim when its activity retries", () => {
	const repository = mockRepository({
		hasAutoDisableClaim: () => Effect.succeed(true),
		insertAutoDisableClaim: () => Effect.die("retry inserted the claim again"),
		disableForUserIfEnabled: () => Effect.die("retry attempted the transition again"),
	});

	return Effect.gen(function* () {
		const service = yield* IntegrationsService;
		expect(yield* service.disableIfEnabled(userId, integrationId, importRunId)).toBe(true);
	}).pipe(Effect.provide(makeLayer(repository)));
});

it.effect("persists the winning transition claim atomically", () => {
	const calls: string[] = [];
	const repository = mockRepository({
		hasAutoDisableClaim: () => Effect.succeed(false),
		disableForUserIfEnabled: () => {
			calls.push("disable");
			return Effect.succeed(true);
		},
		insertAutoDisableClaim: (input) => {
			calls.push(`claim:${input.importRunId}:${input.integrationId}`);
			return Effect.void;
		},
	});

	return Effect.gen(function* () {
		const service = yield* IntegrationsService;
		expect(yield* service.disableIfEnabled(userId, integrationId, importRunId)).toBe(true);
		expect(calls).toEqual(["disable", "claim:run-1:integration-1"]);
	}).pipe(Effect.provide(makeLayer(repository)));
});

it.effect("does not claim a transition won by another run", () => {
	let checks = 0;
	const repository = mockRepository({
		disableForUserIfEnabled: () => Effect.succeed(false),
		insertAutoDisableClaim: () => Effect.die("losing run inserted a claim"),
		hasAutoDisableClaim: () => {
			checks += 1;
			return Effect.succeed(false);
		},
	});

	return Effect.gen(function* () {
		const service = yield* IntegrationsService;
		expect(yield* service.disableIfEnabled(userId, integrationId, importRunId)).toBe(false);
		expect(checks).toBe(2);
	}).pipe(Effect.provide(makeLayer(repository)));
});
