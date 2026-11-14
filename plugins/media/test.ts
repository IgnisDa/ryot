import { BunRuntime } from "@effect/platform-bun";
import {
	encodeTestDatabaseRun,
	prepareTestDatabaseRun,
	testDatabaseMaxConnections,
	testDatabaseRunVariable,
} from "@ryot-app/kernel-backend/testing/database-run";
import { postgresTestSetup } from "@ryot-app/testing/postgres-container";
import { runClientTests } from "@ryot-app/testing/run-client-tests";
import { testWorkers } from "@ryot-app/testing/runner";
import { Effect } from "effect";

BunRuntime.runMain(
	Effect.scoped(
		Effect.gen(function* () {
			const workers = yield* testWorkers(4);
			const adminUrl = yield* postgresTestSetup({
				label: "media-plugin",
				maxConnections: testDatabaseMaxConnections(workers),
			});
			const database = yield* prepareTestDatabaseRun({ workers, adminUrl });
			yield* runClientTests({
				workers,
				args: ["--timeout=120000", ...process.argv.slice(2)],
				env: { [testDatabaseRunVariable]: yield* encodeTestDatabaseRun(database) },
			});
		}),
	),
);
