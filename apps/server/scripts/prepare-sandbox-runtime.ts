import { BunServices, BunRuntime } from "@effect/platform-bun";
import { PackageCacheManager } from "@ryot-app/kernel-backend/lib/infrastructure/sandbox-runtime/runtime";
import { Effect, Layer } from "effect";

const SandboxCacheOnlyLive = PackageCacheManager.layer.pipe(Layer.provide(BunServices.layer));

BunRuntime.runMain(Effect.scoped(Layer.build(SandboxCacheOnlyLive)));
