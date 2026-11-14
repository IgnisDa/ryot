import { BunRuntime } from "@effect/platform-bun";
import { runTests } from "@ryot-app/testing/runner";
import { Effect } from "effect";

BunRuntime.runMain(Effect.scoped(runTests({ workers: 6, timeout: 120_000 })));
