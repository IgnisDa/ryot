import { BunRuntime } from "@effect/platform-bun";
import { postgresTestSetup } from "@ryot-app/testing/postgres-container";
import { runTests, testWorkers } from "@ryot-app/testing/runner";
import { Effect } from "effect";

import {
	encodeTestDatabaseRun,
	prepareTestDatabaseRun,
	testDatabaseMaxConnections,
	testDatabaseRunVariable,
} from "#testing/database-run";

BunRuntime.runMain(
	Effect.scoped(
		Effect.gen(function* () {
			const workers = yield* testWorkers(4);
			const adminUrl = yield* postgresTestSetup({
				label: "kernel-backend",
				maxConnections: testDatabaseMaxConnections(workers),
			});
			const database = yield* prepareTestDatabaseRun({ workers, adminUrl });
			yield* runTests({
				workers,
				timeout: 120_000,
				env: { [testDatabaseRunVariable]: yield* encodeTestDatabaseRun(database) },
			});
		}),
	),
);
