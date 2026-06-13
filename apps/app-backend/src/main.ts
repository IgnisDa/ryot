import { BunFileSystem, BunRuntime, BunContext } from "@effect/platform-bun";
import { Effect, Layer } from "effect";

import { AppLive } from "./app/layers";
import { generateConfigDocs } from "./lib/infrastructure/config/docs";
import { AppConfig, appConfigMeta } from "./lib/infrastructure/config/service";
import { LegacyBootstrapMigrateDrop, MigrationsComplete } from "./lib/infrastructure/db/migrate";
import { DbRunnerLive, DbService, TransactionRunnerLive } from "./lib/infrastructure/db/service";
import { PackageCacheManager } from "./lib/infrastructure/sandbox-runtime/runtime";
import { SeedService } from "./modules/builtins/seed";
import { EntitiesRepository } from "./modules/entities/repository";
import { EntitiesService } from "./modules/entities/service";
import { ProviderConfig } from "./modules/query-engine/provider-config";
import { QueryEngineService } from "./modules/query-engine/service";

const MigrationQueryEngineLive = QueryEngineService.Default.pipe(
	Layer.provide(ProviderConfig.Default),
	Layer.provide(DbRunnerLive),
	Layer.provide(TransactionRunnerLive),
);
const MigrationBootstrapServicesLive = EntitiesService.Default.pipe(
	Layer.provide(MigrationQueryEngineLive),
	Layer.provide(EntitiesRepository.Default),
	Layer.provide(DbRunnerLive),
);

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
	const MigrationOnlyLive = MigrationsComplete.Default.pipe(
		Layer.flatMap(() =>
			SeedService.Default.pipe(Layer.flatMap(() => LegacyBootstrapMigrateDrop.Default)),
		),
		Layer.provide(MigrationBootstrapServicesLive),
		Layer.provide(TransactionRunnerLive),
		Layer.provide(DbService.Default),
		Layer.provide(BunContext.layer),
		Layer.provide(AppConfig.Default),
	);

	await Effect.runPromise(Effect.scoped(Layer.build(MigrationOnlyLive)));
	process.exit(0);
}

if (Bun.env["POPULATE_SANDBOX_CACHE_ONLY"] === "true") {
	const SandboxCacheOnlyLive = PackageCacheManager.Default.pipe(
		Layer.provide(BunContext.layer),
		Layer.provide(AppConfig.Default),
	);

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
