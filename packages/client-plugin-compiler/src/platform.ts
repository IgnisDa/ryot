import { BunFileSystem } from "@effect/platform-bun";
import { ViteBuildService } from "@ryot-app/vite-compiler";
import { Layer } from "effect";

export const clientPluginCompilerPlatformLayer = Layer.merge(
	BunFileSystem.layer,
	ViteBuildService.layer,
);
