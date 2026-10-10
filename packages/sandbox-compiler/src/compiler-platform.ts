import { BunFileSystem, BunPath } from "@effect/platform-bun";
import { ViteBuildService } from "@ryot-app/vite-compiler";
import { Layer } from "effect";

export const sandboxCompilerPlatformLayer = Layer.mergeAll(
	BunPath.layer,
	BunFileSystem.layer,
	ViteBuildService.layer,
);
