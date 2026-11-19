import { BunFileSystem, BunPath } from "@effect/platform-bun";
import { TypeScriptSession } from "@ryot-app/typescript-compiler";
import { ViteBuildService } from "@ryot-app/vite-compiler";
import { Layer } from "effect";

const platformLayer = (session: Layer.Layer<TypeScriptSession>) =>
	Layer.mergeAll(BunPath.layer, BunFileSystem.layer, ViteBuildService.layer, session);

export const pluginBackendCompilerPlatformLayer = platformLayer(TypeScriptSession.layer);

export const pluginBackendCompilerEnvironmentLayer = platformLayer(
	TypeScriptSession.environmentLayer,
);
