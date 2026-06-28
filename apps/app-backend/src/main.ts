import { BunFileSystem, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";

import { AppLive, MigrationOnlyLive, SandboxCacheOnlyLive } from "./app/layers";
import { generateConfigDocs } from "./lib/infrastructure/config/docs";
import { appConfigMeta } from "./lib/infrastructure/config/service";

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
	await Effect.runPromise(Effect.scoped(Layer.build(MigrationOnlyLive)));
	process.exit(0);
}

if (Bun.env["POPULATE_SANDBOX_CACHE_ONLY"] === "true") {
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
