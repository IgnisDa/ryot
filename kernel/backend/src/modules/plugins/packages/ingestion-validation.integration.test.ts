import { expect } from "bun:test";

import { BunServices } from "@effect/platform-bun";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { fixtureManifest } from "@ryot-app/contract/testing";
import { kernelDefinitionSource } from "@ryot-app/definitions/kernel-definitions";
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
import {
	DEFINITION_SET_WORKER_LIMITS,
	DefinitionSetValidator,
	makeDefinitionSetValidator,
} from "./definition-set-validator";
import { PluginIngestionRetirement } from "./ingestion-retirement";
import { PluginIngestionService } from "./ingestion-service";
import { PluginRepository } from "./repository";
import { PluginRevisionActivation } from "./revision-activation";
import { SystemPlugins } from "./system";

const expiredValidator = Layer.effect(
	DefinitionSetValidator,
	makeDefinitionSetValidator({ ...DEFINITION_SET_WORKER_LIMITS, timeoutMs: 1 }).pipe(Effect.orDie),
).pipe(Layer.provide(BunServices.layer));

const ingestionLayer = PluginIngestionService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			expiredValidator,
			Layer.mock(DefinitionRepository)({
				readKernelSource: Effect.succeed(kernelDefinitionSource()),
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

layer(ingestionLayer, { excludeTestServices: true })((test) => {
	test.effect(
		"fails a system install whose validation worker times out without persisting it",
		() =>
			Effect.gen(function* () {
				const ingestion = yield* PluginIngestionService;
				const repository = yield* PluginRepository;
				const session = yield* DatabaseSession;
				const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());

				const exit = yield* Effect.exit(ingestion.installPlugin(source));

				assert(Exit.isFailure(exit));
				expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "CompilerWorkerUnavailable" });
				expect(yield* repository.listActiveSystemPlugins()).toEqual([]);
				expect(
					yield* session.run((db) => db.select({ id: tables.plugin.id }).from(tables.plugin)),
				).toEqual([]);
				expect(
					yield* session.run((db) =>
						db.select({ id: tables.pluginRevision.id }).from(tables.pluginRevision),
					),
				).toEqual([]);
			}),
		testTimeout,
	);
});
