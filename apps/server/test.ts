import { BunRuntime } from "@effect/platform-bun";
import {
	encodeTestDatabaseRun,
	prepareTestDatabaseRun,
	testDatabaseMaxConnections,
	testDatabaseRunVariable,
} from "@ryot-app/kernel-backend/testing/database-run";
import { postgresTestSetup } from "@ryot-app/testing/postgres-container";
import { runTests, testWorkers } from "@ryot-app/testing/runner";
import { Effect } from "effect";

BunRuntime.runMain(
	Effect.scoped(
		Effect.gen(function* () {
			const workers = yield* testWorkers(2);
			const adminUrl = yield* postgresTestSetup({
				label: "server",
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
