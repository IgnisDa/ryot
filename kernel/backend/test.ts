import { BunRuntime } from "@effect/platform-bun";
import { postgresTestSetup } from "@ryot-app/testing/postgres-container";
import { redisTestSetup } from "@ryot-app/testing/redis-container";
import { runTests } from "@ryot-app/testing/runner";
import { Effect } from "effect";

BunRuntime.runMain(
	Effect.scoped(
		Effect.gen(function* () {
			const databaseUrl = yield* postgresTestSetup({
				maxConnections: 100,
				label: "kernel-backend",
			});
			const redisUrl = yield* redisTestSetup({ label: "kernel-backend" });
			yield* runTests({
				workers: 4,
				timeout: 120_000,
				env: { TEST_REDIS_URL: redisUrl, TEST_DATABASE_URL: databaseUrl },
			});
		}),
	),
);
