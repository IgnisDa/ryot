import { BunRuntime } from "@effect/platform-bun";
import { redisTestSetup } from "@ryot-app/testing/redis-container";
import { runTests } from "@ryot-app/testing/runner";
import { Effect } from "effect";

BunRuntime.runMain(
	Effect.scoped(
		Effect.gen(function* () {
			const redisUrl = yield* redisTestSetup({ label: "sandbox" });
			yield* runTests({ workers: 6, timeout: 120_000, env: { TEST_REDIS_URL: redisUrl } });
		}),
	),
);
