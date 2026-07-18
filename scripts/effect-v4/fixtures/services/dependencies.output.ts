import { BunContext } from "@effect/platform-bun";
import { Context, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { BridgeService, PackageCacheManager, RunnerFile } from "./services";

export class ProcessPool extends Context.Service<ProcessPool>()("ProcessPool", {
    // Constructor option stays with the constructor.
    make: Effect.succeed({ run: Effect.void })
}) {
    // Dependencies become explicit layer composition.
    static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(Layer.mergeAll(// Known service dependency.
    BridgeService.layer, RunnerFile.layer, // Preserve trailing dependency comment.
    PackageCacheManager.layer)));
}

export class SandboxCompiler extends Context.Service<SandboxCompiler>()("SandboxCompiler", {
    make: Effect.succeed({ compile: Effect.void })
}) {
    static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(// Existing v4 layer stays unchanged.
    BunContext.layer));
}

export class SandboxService extends Context.Service<SandboxService>()("SandboxService", {
    make: Effect.succeed({ execute: Effect.void })
}) {
    static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(Layer.mergeAll(FetchHttpClient.layer, ProcessPool.layer)));
}
