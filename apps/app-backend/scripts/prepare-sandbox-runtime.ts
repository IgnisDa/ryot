import { BunServices, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";

import { PackageCacheManager } from "../src/lib/infrastructure/sandbox-runtime/runtime";

const SandboxCacheOnlyLive = PackageCacheManager.layer.pipe(Layer.provide(BunServices.layer));

BunRuntime.runMain(Effect.scoped(Layer.build(SandboxCacheOnlyLive)));
