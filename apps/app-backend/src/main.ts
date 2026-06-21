import { BunFileSystem, BunRuntime, BunContext } from "@effect/platform-bun";
import { Effect, Layer } from "effect";

import { AppLive } from "./app/layers";
import { generateConfigDocs } from "./lib/infrastructure/config/docs";
import { AppConfig, appConfigMeta } from "./lib/infrastructure/config/service";
import { LegacyBootstrapMigrateDrop, MigrationsComplete } from "./lib/infrastructure/db/migrate";
import { DbService, TransactionRunnerLive } from "./lib/infrastructure/db/service";
import { PackageCacheManager } from "./lib/infrastructure/sandbox-runtime/runtime";
import { SeedService } from "./modules/builtins/seed";

let shutdownTimer: ReturnType<typeof setTimeout> | undefined;

const onShutdownSignal = () => {
	if (shutdownTimer !== undefined) {
		return;
	}
	shutdownTimer = setTimeout(() => process.exit(1), 30_000);
};

process.on("SIGINT", onShutdownSignal);
process.on("SIGTERM", onShutdownSignal);

if (Bun.env.RUN_LEGACY_BOOTSTRAP_ONLY === "true") {
	const MigrationOnlyLive = MigrationsComplete.Default.pipe(
		Layer.flatMap(() =>
			SeedService.Default.pipe(Layer.flatMap(() => LegacyBootstrapMigrateDrop.Default)),
		),
		Layer.provide(TransactionRunnerLive),
		Layer.provide(DbService.Default),
		Layer.provide(BunContext.layer),
		Layer.provide(AppConfig.Default),
	);

	await Effect.runPromise(Effect.scoped(Layer.build(MigrationOnlyLive)));
	process.exit(0);
}

if (Bun.env.POPULATE_SANDBOX_CACHE_ONLY === "true") {
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
