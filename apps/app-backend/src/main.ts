import { BunFileSystem, BunRuntime, BunContext } from "@effect/platform-bun";
import { Effect, Layer } from "effect";

import { AppLive } from "./app/layers";
import { generateConfigDocs } from "./lib/infrastructure/config/docs";
import { AppConfig, appConfigMeta } from "./lib/infrastructure/config/service";
import { LegacyBootstrapMigrateDrop, MigrationsComplete } from "./lib/infrastructure/db/migrate";
import { DbRunnerLive, DbService, TransactionRunnerLive } from "./lib/infrastructure/db/service";
import { PackageCacheManager } from "./lib/infrastructure/sandbox-runtime/runtime";
import { AutomationsRepository } from "./modules/automations/repository";
import { AutomationsService } from "./modules/automations/service";
import { SeedService } from "./modules/builtins/seed";
import { LifecycleDispatchNoop } from "./modules/entities/lifecycle-dispatch";
import { EntitiesRepository } from "./modules/entities/repository";
import { EntitiesService } from "./modules/entities/service";
import { EntitySchemasRepository } from "./modules/entity-schemas/repository";
import { QueryEngineService } from "./modules/query-engine/service";
import { RelationshipSchemasRepository } from "./modules/relationship-schemas/repository";
import { SavedViewsRepository } from "./modules/saved-views/repository";
import { SavedViewsService } from "./modules/saved-views/service";
import { SignalSchemasService } from "./modules/signals/service";
import { SignalSchemasRepository } from "./modules/signals/signal-schemas-repository";
import { TrackersRepository } from "./modules/trackers/repository";
import { TrackersService } from "./modules/trackers/service";

let shutdownTimer: ReturnType<typeof setTimeout> | undefined;

const onShutdownSignal = () => {
	if (shutdownTimer !== undefined) {
		return;
	}
	shutdownTimer = setTimeout(() => process.exit(1), 30_000);
};

process.on("SIGINT", onShutdownSignal);
process.on("SIGTERM", onShutdownSignal);

if (Bun.env["RUN_MIGRATION_ONLY"] === "true") {
	const MigrationQueryEngineLive = QueryEngineService.Default;
	const MigrationBootstrapRepositoriesLive = Layer.mergeAll(
		AutomationsRepository.Default,
		EntitiesRepository.Default,
		EntitySchemasRepository.Default,
		SavedViewsRepository.Default,
		RelationshipSchemasRepository.Default,
		SignalSchemasRepository.Default,
		TrackersRepository.Default,
	);
	const MigrationBootstrapServicesLive = Layer.provideMerge(
		Layer.mergeAll(
			AutomationsService.Default,
			EntitiesService.Default,
			SavedViewsService.Default,
			SignalSchemasService.Default,
			TrackersService.Default,
		),
		Layer.mergeAll(
			LifecycleDispatchNoop,
			MigrationQueryEngineLive,
			MigrationBootstrapRepositoriesLive,
		),
	);
	const MigrationOnlyLive = MigrationsComplete.Default.pipe(
		Layer.flatMap(() =>
			SeedService.Default.pipe(Layer.flatMap(() => LegacyBootstrapMigrateDrop.Default)),
		),
		Layer.provide(MigrationBootstrapServicesLive),
		Layer.provide(DbRunnerLive),
		Layer.provide(TransactionRunnerLive),
		Layer.provide(DbService.Default),
		Layer.provide(BunContext.layer),
		Layer.provide(AppConfig.Default),
	);

	await Effect.runPromise(Effect.scoped(Layer.build(MigrationOnlyLive)));
	process.exit(0);
}

if (Bun.env["POPULATE_SANDBOX_CACHE_ONLY"] === "true") {
	const SandboxCacheOnlyLive = PackageCacheManager.Default.pipe(Layer.provide(BunContext.layer));

	await Effect.runPromise(Effect.scoped(Layer.build(SandboxCacheOnlyLive)));
	process.exit(0);
}

if (Bun.env.NODE_ENV !== "production") {
	await Effect.runPromise(
		generateConfigDocs(
			[appConfigMeta],
			Bun.fileURLToPath(
				new URL("../../../apps/docs/src/includes/app-backend-config-schema.md", import.meta.url),
			),
		).pipe(Effect.provide(BunFileSystem.layer)),
	);
}

BunRuntime.runMain(Layer.launch(AppLive));
