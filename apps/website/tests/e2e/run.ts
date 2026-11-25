import { BunRuntime } from "@effect/platform-bun";
import { runTests } from "@ryot-app/testing/runner";
import { Effect } from "effect";

BunRuntime.runMain(
	Effect.scoped(runTests({ timeout: 150_000, args: ["tests/e2e", ...process.argv.slice(2)] })),
);
