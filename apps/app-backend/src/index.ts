import { BunFileSystem, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";

import { AppLive } from "./app/layers";
import { providerConfigDefinition, systemConfigDefinition } from "./lib/config/definition";
import { generateConfigDocs } from "./lib/config/docs";

let shutdownTimer: ReturnType<typeof setTimeout> | undefined;

const onShutdownSignal = () => {
	if (shutdownTimer !== undefined) {
		return;
	}
	shutdownTimer = setTimeout(() => process.exit(1), 30_000);
};

process.on("SIGINT", onShutdownSignal);
process.on("SIGTERM", onShutdownSignal);

if (process.env.NODE_ENV !== "production") {
	await Effect.runPromise(
		generateConfigDocs(
			[systemConfigDefinition.meta, providerConfigDefinition.meta],
			new URL("../../../apps/docs/src/includes/app-backend-config-schema.md", import.meta.url)
				.pathname,
		).pipe(Effect.provide(BunFileSystem.layer)),
	);
}

BunRuntime.runMain(Layer.launch(AppLive));
