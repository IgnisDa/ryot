import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

const readModule = (path: string) =>
	Effect.promise(() => Bun.file(new URL(path, import.meta.url)).text());

const readModules = (paths: ReadonlyArray<string>) =>
	Effect.all(paths.map(readModule)).pipe(Effect.map((sources) => sources.join("\n")));

const mediaImportWorkflowModules = [
	"../imports/media-workflow.ts",
	"../imports/media/load-workflow.ts",
	"../imports/media/normalized-import-workflow.ts",
	"../imports/media/normalized-import-workflow-live.ts",
	"../imports/media/resolution-workflow.ts",
	"../imports/media/population-workflow.ts",
	"../imports/media/writing-workflow.ts",
	"../imports/media/writing-failures-workflow.ts",
] as const;

const integrationWorkflowModules = [
	"../integrations/integration-workflow.ts",
	"../integrations/operations-workflow.ts",
	"../integrations/failure-workflow.ts",
	"../integrations/media-workflow.ts",
] as const;

const entityImportWorkflowModules = [
	"../entity-import/entity-import-workflow.ts",
	"../entity-import/provider-entity-population-workflow.ts",
] as const;

it.effect("keeps raw sandbox workflow execution at the allowed boundaries", () =>
	Effect.gen(function* () {
		const [
			sandboxService,
			sandboxWorkflow,
			eventCreateCore,
			eventCreateWorkflow,
			exercisePreload,
			entityImportWorkflow,
			libraryWorkflow,
			mediaImportWorkflow,
			integrationWorkflow,
		] = yield* Effect.all([
			readModule("./service.ts"),
			readModule("./sandbox-workflow-live.ts"),
			readModule("../events/event-creation.ts"),
			readModule("../events/event-create-workflow-live.ts"),
			readModule("../exercises/preload.ts"),
			readModules(entityImportWorkflowModules),
			readModule("../library-membership/library-entity-import-workflow.ts"),
			readModules(mediaImportWorkflowModules),
			readModules(integrationWorkflowModules),
		]);

		expect(sandboxService.match(/\.execute\(RunSandboxWorkflow,/g)?.length ?? 0).toBe(1);
		expect(eventCreateCore.match(/\.execute\(RunSandboxWorkflow,/g)?.length ?? 0).toBe(0);
		expect(eventCreateWorkflow.match(/\.execute\(RunSandboxWorkflow,/g)?.length ?? 0).toBe(1);
		expect(exercisePreload.match(/\.execute\(RunSandboxWorkflow,/g)?.length ?? 0).toBe(1);
		expect(sandboxWorkflow).toContain("DurableQueue.process(SandboxExecutionQueue, payload)");

		expect(libraryWorkflow).not.toContain("execute(RunSandboxWorkflow");
		expect(libraryWorkflow).toContain("execute(ProviderEntityPopulationWorkflow");

		for (const source of [entityImportWorkflow, mediaImportWorkflow, integrationWorkflow]) {
			expect(source).not.toContain("execute(RunSandboxWorkflow");
		}
		expect(entityImportWorkflow).not.toMatch(/^import\s+(?!type\b)[^\n;]*\bWorkflowEngine\b/m);
		expect(
			mediaImportWorkflow.match(/\.execute\(ProcessNormalizedMediaImportWorkflow,/g)?.length ?? 0,
		).toBe(1);
		expect(
			integrationWorkflow.match(/\.execute\(ProcessNormalizedMediaImportWorkflow,/g)?.length ?? 0,
		).toBe(1);
	}),
);

it.effect("keeps parent workflows as orchestrations instead of queue pass-through wrappers", () =>
	Effect.gen(function* () {
		const [entityImportWorkflow, libraryWorkflow, mediaImportWorkflow, integrationWorkflow] =
			yield* Effect.all([
				readModules(entityImportWorkflowModules),
				readModule("../library-membership/library-entity-import-workflow.ts"),
				readModules(mediaImportWorkflowModules),
				readModules(integrationWorkflowModules),
			]);

		expect(entityImportWorkflow).toContain("validate-entity-details");
		expect(entityImportWorkflow).toContain("write-primary-entity");
		expect(libraryWorkflow).toContain("ensureLibraryMembership");
		expect(libraryWorkflow).not.toContain("ensureEntityInLibrary");

		expect(mediaImportWorkflow).toContain("load-media-import-adapter-result");
		expect(mediaImportWorkflow).toContain("record-total-items");
		expect(mediaImportWorkflow).toContain("finalize-import-run");

		expect(integrationWorkflow).toContain("mark-integration-run-started");
		expect(integrationWorkflow).toContain("finalize-integration-run");
		expect(integrationWorkflow).toContain("ProcessNormalizedMediaImportWorkflow");
	}),
);

it.effect("keeps event workflow and repository primitives behind EventsService", () =>
	Effect.gen(function* () {
		const [collectionsService, collectionsAddWorkflow, sandboxHostFunctions] = yield* Effect.all([
			readModule("../collections/service.ts"),
			readModule("../collections/add-entity-to-collection-workflow-live.ts"),
			readModule("../../lib/infrastructure/sandbox-runtime/host-functions.ts"),
		]);

		for (const source of [collectionsService, sandboxHostFunctions]) {
			expect(source).not.toContain("#modules/events/event-create-workflow");
			expect(source).not.toContain("#modules/events/repository");
			expect(source).not.toContain("EventsRepository");
		}

		expect(collectionsService).not.toContain("EventCreateWorkflow");
		expect(collectionsAddWorkflow.match(/\.execute\(EventCreateWorkflow,/g)?.length ?? 0).toBe(1);
	}),
);

it.effect("keeps provider entity population behind the canonical workflow", () =>
	Effect.gen(function* () {
		const [
			populationWorkflow,
			libraryWorkflow,
			monitoringWorkflow,
			mediaOperations,
			membershipWorker,
			trigger,
			preload,
		] = yield* Effect.all([
			readModule("../entity-import/provider-entity-population-workflow.ts"),
			readModule("../library-membership/library-entity-import-workflow.ts"),
			readModule("../media-monitoring/refresh-workflow.ts"),
			readModule("../imports/media/operations-workflow.ts"),
			readModule("../library-membership/membership-worker.ts"),
			readModule("../entity-import/population-trigger-live.ts"),
			readModule("../exercises/preload.ts"),
		]);

		expect(populationWorkflow).toContain("validate-entity-details");
		expect(populationWorkflow).toContain("mark-primary-entity-populated");

		for (const source of [trigger, preload, libraryWorkflow, monitoringWorkflow]) {
			expect(source).toContain("ProviderEntityPopulationWorkflow");
		}

		expect(mediaOperations).toContain("LibraryEntityImportWorkflow");
		expect(mediaOperations).not.toContain("ProviderEntityPopulationWorkflow");

		expect(membershipWorker).toContain("ensureEntityInLibrary");

		// `runProviderEntityPopulationWorkflow` is exported only for unit tests. No production
		// module may import it — callers must dispatch ProviderEntityPopulationWorkflow through
		// the engine. Scan every source file (not just today's known callers) so a newly added
		// module cannot bypass the single-owner boundary undetected.
		const sourceRoot = Bun.fileURLToPath(new URL("../../", import.meta.url));
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
				Effect.promise(() => Bun.file(path).text()).pipe(Effect.map((text) => ({ path, text }))),
			),
		);

		expect(productionSources.length).toBeGreaterThan(0);
		for (const { path, text } of productionSources) {
			expect(text, path).not.toContain("runProviderEntityPopulationWorkflow");
		}
	}),
);
