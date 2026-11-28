import { expect } from "bun:test";

import { BunServices } from "@effect/platform-bun";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { fixtureManifest } from "@ryot-app/contract/testing";
import { pluginBackendCompilerPlatformLayer } from "@ryot-app/plugin-backend-compiler/platform";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Cause, Effect, Exit, Layer } from "effect";

import { DefinitionRepository } from "#modules/definitions/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { PluginCatalogInvalidator } from "../catalog/events";
import { PluginInstallationRepository } from "../installations/repository";
import { loadPluginSource } from "../source.test-support";
import { fixturePackageRoot } from "../test-support";
import { PluginIngestionRetirement } from "./ingestion-retirement";
import { PluginIngestionService } from "./ingestion-service";
import { normalizePluginPackage, normalizePluginSource } from "./pipeline";
import { PluginRepository } from "./repository";
import { PluginRevisionActivation } from "./revision-activation";
import { SystemPlugins } from "./system";
import {
	makePluginValidationWorker,
	PLUGIN_VALIDATION_WORKER_LIMITS,
	PluginValidationWorker,
} from "./validation-worker";
import { heavyDefinitionBaseline } from "./validation-worker.test-support";

const ingestionLayer = (timeoutMs: number) =>
	PluginIngestionService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.effect(
					PluginValidationWorker,
					makePluginValidationWorker({ ...PLUGIN_VALIDATION_WORKER_LIMITS, timeoutMs }).pipe(
						Effect.orDie,
					),
				).pipe(Layer.provide(BunServices.layer)),
				Layer.mock(DefinitionRepository)({
					readKernelSource: Effect.sync(heavyDefinitionBaseline),
				}),
				Layer.succeed(SystemPlugins, { sources: [], packageIds: new Set<PluginPackageId>() }),
				Layer.succeed(PluginRevisionActivation, { activated: () => Effect.void }),
				Layer.succeed(PluginIngestionRetirement, { retire: () => Effect.void }),
				Layer.succeed(PluginCatalogInvalidator, { all: Effect.void, user: () => Effect.void }),
			),
		),
		Layer.provideMerge(Layer.merge(PluginRepository.layer, PluginInstallationRepository.layer)),
		Layer.provideMerge(
			Layer.merge(
				isolatedDatabaseLayer("plugin_ingestion_validation"),
				pluginBackendCompilerPlatformLayer,
			),
		),
	);

const expectNoPlugins = Effect.gen(function* () {
	const repository = yield* PluginRepository;
	const session = yield* DatabaseSession;
	expect(yield* repository.listActiveSystemPlugins()).toEqual([]);
	expect(
		yield* session.run((db) => db.select({ id: tables.plugin.id }).from(tables.plugin)),
	).toEqual([]);
	expect(
		yield* session.run((db) =>
			db.select({ id: tables.pluginRevision.id }).from(tables.pluginRevision),
		),
	).toEqual([]);
});

const expectWorkerUnavailable = (exit: Exit.Exit<unknown, unknown>) => {
	assert(Exit.isFailure(exit));
	expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "CompilerWorkerUnavailable" });
};

layer(ingestionLayer(1), { excludeTestServices: true })((test) => {
	test.effect(
		"fails a system install whose source check outlasts the worker time limit",
		() =>
			Effect.gen(function* () {
				const ingestion = yield* PluginIngestionService;
				const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());

				expectWorkerUnavailable(yield* Effect.exit(ingestion.installPlugin(source)));
				yield* expectNoPlugins;
			}),
		testTimeout,
	);
});

layer(ingestionLayer(500), { excludeTestServices: true })((test) => {
	test.effect(
		"rolls back a persisted system package whose definition set outlasts the worker time limit",
		() =>
			Effect.gen(function* () {
				const ingestion = yield* PluginIngestionService;
				const repository = yield* PluginRepository;
				const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());
				const normalized = normalizePluginPackage(yield* normalizePluginSource(source));

				const exit = yield* Effect.exit(
					ingestion.validateActiveSystemPlugins(
						repository.persist(normalized, { ownerId: null, scope: "system" }),
					),
				);

				expectWorkerUnavailable(exit);
				yield* expectNoPlugins;
			}),
		testTimeout,
	);
});
