import { FileSystem, Path } from "@effect/platform";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { renderConfigReference } from "@ryot/config";
import { Config, ConfigProvider, Effect, Layer } from "effect";

import { AppLive, MigrationOnlyLive, SandboxCacheOnlyLive } from "./app/layers";
import { appConfigDefinition } from "./lib/infrastructure/config/definition";
import { bootPluginSources } from "./modules/plugins/boot-sources";

let shutdownTimer: ReturnType<typeof setTimeout> | undefined;

const onShutdownSignal = () => {
	if (shutdownTimer !== undefined) {
		return;
	}
	shutdownTimer = setTimeout(() => process.exit(1), 30_000);
};

process.on("SIGINT", onShutdownSignal);
process.on("SIGTERM", onShutdownSignal);

const { nodeEnv, runMigrationOnly, prepareSandboxRuntimeOnly } = await Effect.runPromise(
	Config.all({
		nodeEnv: Config.string("NODE_ENV").pipe(Config.withDefault("development")),
		runMigrationOnly: Config.boolean("RUN_MIGRATION_ONLY").pipe(Config.withDefault(false)),
		prepareSandboxRuntimeOnly: Config.boolean("PREPARE_SANDBOX_RUNTIME_ONLY").pipe(
			Config.withDefault(false),
		),
	}).pipe(Effect.withConfigProvider(ConfigProvider.fromEnv())),
);

if (runMigrationOnly) {
	await Effect.runPromise(Effect.scoped(Layer.build(MigrationOnlyLive)));
	process.exit(0);
}

if (prepareSandboxRuntimeOnly) {
	await Effect.runPromise(Effect.scoped(Layer.build(SandboxCacheOnlyLive)));
	process.exit(0);
}

if (nodeEnv !== "production") {
	await Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const outputPath = yield* path.fromFileUrl(
				new URL("../../../apps/docs/src/includes/app-backend-config-schema.md", import.meta.url),
			);
			const plugins = bootPluginSources.map(({ manifest }) => ({
				name: manifest.metadata.name,
				slug: manifest.metadata.slug,
				schema: manifest.configSchema,
			}));
			yield* fs.writeFileString(outputPath, renderConfigReference(appConfigDefinition, plugins));
		}).pipe(Effect.provide(BunContext.layer)),
	);
}

BunRuntime.runMain(Layer.launch(AppLive), {
	disablePrettyLogger: true,
});
