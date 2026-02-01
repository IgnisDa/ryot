import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";

import { PackageCacheManager } from "../src/lib/infrastructure/sandbox-runtime/runtime";

const SandboxCacheOnlyLive = PackageCacheManager.Default.pipe(Layer.provide(BunContext.layer));

BunRuntime.runMain(Effect.scoped(Layer.build(SandboxCacheOnlyLive)));
