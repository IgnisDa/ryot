import { it } from "@effect/vitest";
import { ImportRunId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import { expect as vitestExpect } from "vitest";

import type { MockOverrides } from "#lib/test-utils/effect";
import { dbRunnerLayer } from "#lib/test-utils/effect";
import { ImportsRepository } from "#modules/imports/repository";

import { IntegrationsService } from "./service";
import { makeIntegration, makeRun } from "./test-support";
import { finalizeIntegrationRun } from "./worker";

const mockImportsRepository = Layer.mock(ImportsRepository);
const mockIntegrationsService = Layer.mock(IntegrationsService);

const makeImportsRepository = (overrides: MockOverrides<typeof mockImportsRepository> = {}) =>
	mockImportsRepository({
		updateRun: () => Effect.void,
		getRunById: () => Effect.succeed(null),
		listRecentStatusesByIntegrationId: () => Effect.succeed([]),
		...overrides,
	});

const makeIntegrationsService = (overrides: MockOverrides<typeof mockIntegrationsService> = {}) =>
	mockIntegrationsService({
		update: () => Effect.succeed(makeIntegration()),
		disableIfEnabled: () => Effect.succeed(false),
		...overrides,
	});

const makeWorkerLayer = (input: {
	importsRepository?: Layer.Layer<ImportsRepository>;
	integrationsService?: Layer.Layer<IntegrationsService>;
}) =>
	Layer.mergeAll(
		dbRunnerLayer,
		input.importsRepository ?? makeImportsRepository(),
		input.integrationsService ?? makeIntegrationsService(),
	);

it.effect("updates lastFinishedAt after a completed integration run", () => {
	const updates: Array<Record<string, unknown>> = [];
	const layer = makeWorkerLayer({
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("completed")),
			listRecentStatusesByIntegrationId: () => Effect.succeed([]),
		}),
		integrationsService: makeIntegrationsService({
			update: (userId, integrationId, body) => {
				updates.push({ userId, integrationId, ...body });
				return Effect.succeed(makeIntegration());
			},
		}),
	});

	return Effect.gen(function* () {
		const wasDisabled = yield* finalizeIntegrationRun(makeIntegration(), ImportRunId.make("run_1"));

		vitestExpect(wasDisabled).toBe(false);
		vitestExpect(updates).toHaveLength(1);
		vitestExpect(updates[0]).toMatchObject({
			userId: "user_1",
			integrationId: "int_1",
			lastFinishedAt: vitestExpect.any(Date),
		});
	}).pipe(Effect.provide(layer));
});

it.effect("disables the integration after 5 consecutive failures", () => {
	const updates: Array<Record<string, unknown>> = [];
	const layer = makeWorkerLayer({
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("failed")),
			listRecentStatusesByIntegrationId: () =>
				Effect.succeed([
					{ status: "failed" as const },
					{ status: "failed" as const },
					{ status: "failed" as const },
					{ status: "failed" as const },
					{ status: "failed" as const },
				]),
		}),
		integrationsService: makeIntegrationsService({
			disableIfEnabled: (userId, integrationId, runId) => {
				updates.push({ userId, integrationId, runId, isDisabled: true });
				return Effect.succeed(true);
			},
		}),
	});

	return Effect.gen(function* () {
		const wasDisabled = yield* finalizeIntegrationRun(makeIntegration(), ImportRunId.make("run_1"));

		vitestExpect(wasDisabled).toBe(true);
		vitestExpect(updates).toEqual([
			{ userId: "user_1", runId: "run_1", isDisabled: true, integrationId: "int_1" },
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("does not claim a second disable transition after a concurrent run wins", () => {
	const layer = makeWorkerLayer({
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("failed")),
			listRecentStatusesByIntegrationId: () =>
				Effect.succeed(Array.from({ length: 5 }, () => ({ status: "failed" as const }))),
		}),
		integrationsService: makeIntegrationsService({
			disableIfEnabled: () => Effect.succeed(false),
		}),
	});

	return Effect.gen(function* () {
		const wasDisabled = yield* finalizeIntegrationRun(makeIntegration(), ImportRunId.make("run_1"));
		vitestExpect(wasDisabled).toBe(false);
	}).pipe(Effect.provide(layer));
});

it.effect("does not disable integrations when recent runs are not all failures", () => {
	const updates: Array<Record<string, unknown>> = [];
	const layer = makeWorkerLayer({
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("failed")),
			listRecentStatusesByIntegrationId: () =>
				Effect.succeed([
					{ status: "failed" as const },
					{ status: "failed" as const },
					{ status: "completed" as const },
					{ status: "failed" as const },
					{ status: "failed" as const },
				]),
		}),
		integrationsService: makeIntegrationsService({
			update: (userId, integrationId, body) => {
				updates.push({ userId, integrationId, ...body });
				return Effect.succeed(makeIntegration());
			},
		}),
	});

	return Effect.gen(function* () {
		const wasDisabled = yield* finalizeIntegrationRun(makeIntegration(), ImportRunId.make("run_1"));

		vitestExpect(wasDisabled).toBe(false);
		vitestExpect(updates).toEqual([]);
	}).pipe(Effect.provide(layer));
});
