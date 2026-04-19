import { BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";

import { AppLive } from "./app/layers";
import { generateConfigDocs } from "./lib/config/docs";

await generateConfigDocs(Bun.fileURLToPath(new URL("../CONFIG.md", import.meta.url)));

let shutdownTimer: ReturnType<typeof setTimeout> | undefined;

const onShutdownSignal = () => {
	if (shutdownTimer !== undefined) {
		return;
	}
	shutdownTimer = setTimeout(() => process.exit(1), 30_000);
};

process.on("SIGINT", onShutdownSignal);
process.on("SIGTERM", onShutdownSignal);

BunRuntime.runMain(Layer.launch(AppLive));
