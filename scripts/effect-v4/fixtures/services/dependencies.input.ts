import { BunContext } from "@effect/platform-bun";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { BridgeService, PackageCacheManager, RunnerFile } from "./services";

export class ProcessPool extends Effect.Service<ProcessPool>()("ProcessPool", {
	// Dependencies become explicit layer composition.
	dependencies: [
		// Known service dependency.
		BridgeService.Default,
		RunnerFile.Default,
		PackageCacheManager.Default, // Preserve trailing dependency comment.
	],
	// Constructor option stays with the constructor.
	effect: Effect.succeed({ run: Effect.void }),
}) {}

export class SandboxCompiler extends Effect.Service<SandboxCompiler>()("SandboxCompiler", {
	dependencies: [
		// Existing v4 layer stays unchanged.
		BunContext.layer,
	],
	effect: Effect.succeed({ compile: Effect.void }),
}) {}

export class SandboxService extends Effect.Service<SandboxService>()("SandboxService", {
	dependencies: [FetchHttpClient.layer, ProcessPool.Default],
	scoped: Effect.succeed({ execute: Effect.void }),
}) {}
