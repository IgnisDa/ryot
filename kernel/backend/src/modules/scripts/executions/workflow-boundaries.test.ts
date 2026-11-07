import { expect } from "bun:test";

import { BunServices } from "@effect/platform-bun";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, FileSystem, Path } from "effect";

const readModule = (path: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const paths = yield* Path.Path;
		const modulePath = yield* paths.fromFileUrl(new URL(path, import.meta.url));
		return yield* fs.readFileString(modulePath);
	});

const readModules = (paths: ReadonlyArray<string>) =>
	Effect.forEach(paths, readModule).pipe(Effect.map((sources) => sources.join("\n")));

const integrationWorkflowModules = [
	"../../integrations/integration-workflow.ts",
	"../../integrations/integration-workflow-live.ts",
	"../../integrations/failure-workflow.ts",
] as const;

layer(BunServices.layer)((test) => {
	test.effect(
		"keeps provider population independent of media hierarchy literals",
		() =>
			Effect.gen(function* () {
				const source = yield* readModules([
					"../../entities/providers/population-job.ts",
					"../../entities/providers/population.ts",
				]);

				expect(source).not.toContain("CHILD_ENTITY_SCHEMA_SLUGS");
				expect(source).not.toContain('"show-season"');
				expect(source).not.toContain('"podcast"');
			}),
		testTimeout,
	);

	test.effect(
		"keeps universal sandbox and queue execution at their allowed boundaries",
		() =>
			Effect.gen(function* () {
				const [
					sandboxService,
					durableQueues,
					sandboxWorkflow,
					entityImportWorkflow,
					sandboxScriptWorkflow,
					automationRunJob,
				] = yield* Effect.all([
					readModule("./service.ts"),
					readModule("./queues.ts"),
					readModule("./workflow-live.ts"),
					readModule("../../entities/providers/entity-import-workflow.ts"),
					readModule("./workflow.ts"),
					readModule("../../automations/run-job-live.ts"),
				]);

				expect(sandboxService).toMatch(
					/dispatchAdmittedWorkflow\(\s*engine,\s*ScriptExecutionWorkflow,/,
				);
				expect(durableQueues).toMatch(/jobs\s*\.enqueue\(\s*payload\.lane === "interactive"/);
				expect(automationRunJob).toContain("ScriptExecutionService");
				expect(sandboxScriptWorkflow).toMatch(
					/processSandboxExecutionQueue\(\s*\{\s*\.\.\.payload,\s*recoveryAttempt: attempt,?\s*\}\s*\)/,
				);
				expect(sandboxWorkflow).toContain("ScriptExecutionWorkflow");
				expect(entityImportWorkflow).toContain("awaitEntityPopulation(");
			}),
		testTimeout,
	);

	test.effect(
		"keeps the integration workflow an orchestration instead of a queue pass-through wrapper",
		() =>
			Effect.gen(function* () {
				const integrationWorkflow = yield* readModules(integrationWorkflowModules);

				expect(integrationWorkflow).toMatch(
					/name: `start-integration-ingestion:\$\{attempt\}`,\s*execute: repository\s*\.startIntegrationIngestion\(/,
				);
				expect(integrationWorkflow).toContain("finalize-integration-run");
				expect(integrationWorkflow).toMatch(
					/dispatchAdmittedWorkflow\(\s*engine,\s*ProcessDataImportWorkflow,/,
				);
				expect(integrationWorkflow).toMatch(/sandbox\s*\.executeWorkflow\(\{/);
				expect(integrationWorkflow).toContain('yield* settle("completed")');
				expect(integrationWorkflow).toContain('Effect.andThen(settle("failed"))');
			}),
		testTimeout,
	);

	test.effect(
		"keeps event create and repository primitives behind EventsService",
		() =>
			Effect.gen(function* () {
				const sources = yield* Effect.all([
					readModule("../../collections/service.ts"),
					readModule("../../events/script-host.ts"),
				]);

				for (const source of sources) {
					expect(source).not.toContain("#modules/events/event-create");
					expect(source).not.toContain("#modules/events/repository");
					expect(source).not.toContain("EventsRepository");
				}
			}),
		testTimeout,
	);

	test.effect(
		"keeps provider entity population behind its job",
		() =>
			Effect.gen(function* () {
				const paths = yield* Path.Path;
				const fs = yield* FileSystem.FileSystem;
				const [populationJob, trigger] = yield* Effect.all([
					readModule("../../entities/providers/population-job.ts"),
					readModule("../../entities/providers/population-trigger-live.ts"),
				]);

				expect(populationJob).toMatch(/registerJobHandler\(\s*EntityPopulationJob,/);
				expect(trigger).toContain("admitPopulation(");

				// `runPopulationAttempt` is exported only for unit tests. No other production module may call it: requests
				// reach population through its job. Scan every source file so a newly added module cannot bypass that.
				const sourceRoot = yield* paths.fromFileUrl(new URL("../../../", import.meta.url));
				const productionPaths = yield* fs.glob("**/*.ts", { root: sourceRoot }).pipe(
					Effect.map((matchedPaths) =>
						matchedPaths
							.map((path) => paths.resolve(sourceRoot, path))
							.map((absolutePath) => absolutePath.replaceAll("\\", "/"))
							.filter(
								(path) =>
									!path.endsWith(".test.ts") &&
									!path.endsWith("/entities/providers/population-job.ts"),
							),
					),
				);
				const productionSources = yield* Effect.forEach(productionPaths, (path) =>
					fs.readFileString(path).pipe(Effect.map((text) => ({ path, text }))),
				);

				expect(productionSources.length).toBeGreaterThan(0);
				for (const { path, text } of productionSources) {
					expect(text, path).not.toContain("runPopulationAttempt");
				}
			}),
		testTimeout,
	);
});
