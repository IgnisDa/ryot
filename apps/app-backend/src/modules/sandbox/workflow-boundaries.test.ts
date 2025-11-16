import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

const readModule = (path: string) =>
	Effect.promise(() => Bun.file(new URL(path, import.meta.url)).text());

const readModules = (paths: ReadonlyArray<string>) =>
	Effect.all(paths.map(readModule)).pipe(Effect.map((sources) => sources.join("\n")));

const mediaImportWorkflowModules = [
	"../imports/media-workflow.ts",
	"../imports/media/load-workflow.ts",
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

it.effect("keeps raw sandbox workflow execution at the allowed boundaries", () =>
	Effect.gen(function* () {
		const [
			sandboxService,
			sandboxWorkflow,
			eventCreateCore,
			exercisePreload,
			entityImportWorkflow,
			libraryWorkflow,
			mediaImportWorkflow,
			integrationWorkflow,
		] = yield* Effect.all([
			readModule("./service.ts"),
			readModule("./sandbox-workflow-live.ts"),
			readModule("../events/event-creation.ts"),
			readModule("../exercises/preload.ts"),
			readModule("../entity-import/entity-import-workflow.ts"),
			readModule("../library-membership/library-entity-import-workflow.ts"),
			readModules(mediaImportWorkflowModules),
			readModules(integrationWorkflowModules),
		]);

		expect(sandboxService.match(/\.execute\(RunSandboxWorkflow,/g)?.length ?? 0).toBe(1);
		expect(eventCreateCore.match(/\.execute\(RunSandboxWorkflow,/g)?.length ?? 0).toBe(2);
		expect(exercisePreload.match(/\.execute\(RunSandboxWorkflow,/g)?.length ?? 0).toBe(1);
		expect(sandboxWorkflow).toContain("DurableQueue.process(SandboxExecutionQueue, payload)");

		for (const source of [
			entityImportWorkflow,
			libraryWorkflow,
			mediaImportWorkflow,
			integrationWorkflow,
		]) {
			expect(source).not.toContain("execute(RunSandboxWorkflow");
			expect(source).not.toMatch(/^import\s+(?!type\b)[^\n;]*\bWorkflowEngine\b/m);
		}
	}),
);

it.effect("keeps parent workflows as orchestrations instead of queue pass-through wrappers", () =>
	Effect.gen(function* () {
		const [entityImportWorkflow, libraryWorkflow, mediaImportWorkflow, integrationWorkflow] =
			yield* Effect.all([
				readModule("../entity-import/entity-import-workflow.ts"),
				readModule("../library-membership/library-entity-import-workflow.ts"),
				readModules(mediaImportWorkflowModules),
				readModules(integrationWorkflowModules),
			]);

		expect(entityImportWorkflow).toContain("validate-entity-details");
		expect(entityImportWorkflow).toContain("write-primary-entity");
		expect(libraryWorkflow).toContain("ensure-library-membership");

		expect(mediaImportWorkflow).toContain("load-media-import-adapter-result");
		expect(mediaImportWorkflow).toContain("record-total-items");
		expect(mediaImportWorkflow).toContain("finalize-import-run");

		expect(integrationWorkflow).toContain("mark-integration-run-started");
		expect(integrationWorkflow).toContain("finalize-integration-run");
		expect(integrationWorkflow).toContain("runLoadedMediaImportWorkflow({");
	}),
);

it.effect("keeps event workflow and repository primitives behind EventsService", () =>
	Effect.gen(function* () {
		const [collectionsService, sandboxHostFunctions] = yield* Effect.all([
			readModule("../collections/service.ts"),
			readModule("../../lib/sandbox/host-functions.ts"),
		]);

		for (const source of [collectionsService, sandboxHostFunctions]) {
			expect(source).not.toContain("#modules/events/event-create-workflow");
			expect(source).not.toContain("#modules/events/repository");
			expect(source).not.toContain("EventsRepository");
		}
	}),
);
