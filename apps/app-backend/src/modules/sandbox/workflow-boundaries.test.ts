import { BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

const readModule = (path: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const paths = yield* Path.Path;
		const modulePath = yield* paths.fromFileUrl(new URL(path, import.meta.url));
		return yield* fs.readFileString(modulePath);
	});

const readModules = (paths: ReadonlyArray<string>) =>
	Effect.all(paths.map(readModule)).pipe(Effect.map((sources) => sources.join("\n")));

const integrationWorkflowModules = [
	"../integrations/integration-workflow.ts",
	"../integrations/integration-workflow-live.ts",
	"../integrations/operations-workflow.ts",
	"../integrations/failure-workflow.ts",
] as const;

const entityImportWorkflowModules = [
	"../entity-import/entity-import-workflow.ts",
	"../entity-import/provider-entity-population-workflow.ts",
] as const;

it.effect("keeps provider population independent of media hierarchy literals", () =>
	Effect.gen(function* () {
		const source = yield* readModule("../entity-import/provider-entity-population-workflow.ts");

		expect(source).not.toContain("CHILD_ENTITY_SCHEMA_SLUGS");
		expect(source).not.toContain('"show-season"');
		expect(source).not.toContain('"podcast"');
	}).pipe(Effect.provide(BunServices.layer)),
);

it.effect("keeps raw sandbox workflow execution at the allowed boundaries", () =>
	Effect.gen(function* () {
		const [
			sandboxService,
			durableQueues,
			sandboxWorkflow,
			eventCreateCore,
			eventCreateWorkflow,
			entityImportWorkflow,
			integrationWorkflow,
			sandboxScriptWorkflow,
			subscriptionWorkflow,
		] = yield* Effect.all([
			readModule("./service.ts"),
			readModule("./durable-queues.ts"),
			readModule("./sandbox-workflow-live.ts"),
			readModule("../events/event-creation.ts"),
			readModule("../events/event-create-workflow-live.ts"),
			readModules(entityImportWorkflowModules),
			readModules(integrationWorkflowModules),
			readModule("./sandbox-script-workflow.ts"),
			readModule("../automations/subscription-execution-workflow-live.ts"),
		]);

		expect(sandboxService.match(/\.execute\(RunSandboxWorkflow,/g)?.length ?? 0).toBe(1);
		expect(durableQueues.match(/\.execute\(RunSandboxWorkflow,/g)?.length ?? 0).toBe(1);
		expect(eventCreateCore.match(/\.execute\(RunSandboxWorkflow,/g)?.length ?? 0).toBe(0);
		expect(eventCreateWorkflow.match(/\.execute\(RunSandboxWorkflow,/g)?.length ?? 0).toBe(0);
		expect(subscriptionWorkflow.match(/\.execute\(RunSandboxWorkflow,/g)?.length ?? 0).toBe(1);
		expect(sandboxScriptWorkflow.match(/\.execute\(RunSandboxWorkflow,/g)?.length ?? 0).toBe(1);
		expect(sandboxWorkflow).toContain(
			"DurableQueue.process(SandboxExecutionQueue, executionPayload)",
		);
		expect(sandboxWorkflow).toContain('Effect.timeout("1 minute")');
		expect(sandboxWorkflow).toContain('Effect.retry(Schedule.spaced("1 second"))');
		expect(sandboxWorkflow).toContain("...(payload.grants ? { grants: payload.grants } : {})");

		for (const source of [entityImportWorkflow, integrationWorkflow]) {
			expect(source).not.toContain("execute(RunSandboxWorkflow");
		}
		expect(entityImportWorkflow).toContain("execute(ProviderEntityPopulationWorkflow");
	}).pipe(Effect.provide(BunServices.layer)),
);

it.effect("keeps parent workflows as orchestrations instead of queue pass-through wrappers", () =>
	Effect.gen(function* () {
		const [entityImportWorkflow, integrationWorkflow] = yield* Effect.all([
			readModules(entityImportWorkflowModules),
			readModules(integrationWorkflowModules),
		]);

		expect(entityImportWorkflow).toContain("validate-entity-details");
		expect(entityImportWorkflow).toContain("upsert-root-entity");
		expect(entityImportWorkflow).toContain("stamp-root-populated-at");
		expect(integrationWorkflow).toContain("mark-integration-run-started");
		expect(integrationWorkflow).toContain("finalize-integration-run");
		expect(integrationWorkflow).toContain("runIntegrationImport");
	}).pipe(Effect.provide(BunServices.layer)),
);

it.effect("keeps event workflow and repository primitives behind EventsService", () =>
	Effect.gen(function* () {
		const [collectionsService, collectionsAddWorkflow, sandboxHostFunctions] = yield* Effect.all([
			readModule("../collections/service.ts"),
			readModule("../collections/add-entity-to-collection-workflow-live.ts"),
			readModule("../../app/sandbox-host-functions.ts"),
		]);

		for (const source of [collectionsService, sandboxHostFunctions]) {
			expect(source).not.toContain("#modules/events/event-create-workflow");
			expect(source).not.toContain("#modules/events/repository");
			expect(source).not.toContain("EventsRepository");
		}

		expect(collectionsService).not.toContain("EventCreateWorkflow");
		expect(collectionsAddWorkflow.match(/\.execute\(EventCreateWorkflow,/g)?.length ?? 0).toBe(1);
	}).pipe(Effect.provide(BunServices.layer)),
);

it.effect("keeps provider entity population behind the canonical workflow", () =>
	Effect.gen(function* () {
		const paths = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const [populationWorkflow, trigger] = yield* Effect.all([
			readModule("../entity-import/provider-entity-population-workflow.ts"),
			readModule("../entity-import/population-trigger-live.ts"),
		]);

		expect(populationWorkflow).toContain("validate-entity-details");
		expect(populationWorkflow).toContain("upsert-root-entity");
		expect(populationWorkflow).toContain("sync-related-entity-group:");
		expect(populationWorkflow).toContain("write-child-entity-set:");
		expect(populationWorkflow).toContain("stamp-root-populated-at");
		expect(populationWorkflow).toContain("publish-primary-entity");

		expect(trigger).toContain("ProviderEntityPopulationWorkflow");

		// `runProviderEntityPopulationWorkflow` is exported only for unit tests. No production
		// module may import it — callers must dispatch ProviderEntityPopulationWorkflow through
		// the engine. Scan every source file (not just today's known callers) so a newly added
		// module cannot bypass the single-owner boundary undetected.
		const sourceRoot = yield* paths.fromFileUrl(new URL("../../", import.meta.url));
		const productionPaths = yield* Effect.sync(() =>
			Array.from(new Bun.Glob("**/*.ts").scanSync({ cwd: sourceRoot, absolute: true }))
				.map((absolutePath) => absolutePath.replaceAll("\\", "/"))
				.filter(
					(path) =>
						!path.endsWith(".test.ts") &&
						!path.endsWith("/entity-import/provider-entity-population-workflow.ts"),
				),
		);
		const productionSources = yield* Effect.all(
			productionPaths.map((path) =>
				fs.readFileString(path).pipe(Effect.map((text) => ({ path, text }))),
			),
		);

		expect(productionSources.length).toBeGreaterThan(0);
		for (const { path, text } of productionSources) {
			expect(text, path).not.toContain("runProviderEntityPopulationWorkflow");
		}
	}).pipe(Effect.provide(BunServices.layer)),
);
