import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

const readModule = (path: string) =>
	Effect.promise(() => Bun.file(new URL(path, import.meta.url)).text());

it.effect("keeps raw sandbox workflow execution at the allowed boundaries", () =>
	Effect.gen(function* () {
		const [
			sandboxService,
			sandboxWorkflow,
			eventCreateCore,
			entityImportWorkflow,
			libraryWorkflow,
			mediaImportWorkflow,
			integrationWorkflow,
		] = yield* Effect.all([
			readModule("./service.ts"),
			readModule("./workflows.ts"),
			readModule("../events/create-core.ts"),
			readModule("../entity-import/workflows.ts"),
			readModule("../library/workflows.ts"),
			readModule("../imports/workflows.ts"),
			readModule("../integrations/workflows.ts"),
		]);

		expect(sandboxService.match(/\.execute\(RunSandboxWorkflow,/g)?.length ?? 0).toBe(1);
		expect(eventCreateCore.match(/\.execute\(RunSandboxWorkflow,/g)?.length ?? 0).toBe(1);
		expect(sandboxWorkflow).toContain("DurableQueue.process(SandboxExecutionQueue, payload)");

		for (const source of [
			entityImportWorkflow,
			libraryWorkflow,
			mediaImportWorkflow,
			integrationWorkflow,
		]) {
			expect(source).not.toContain("execute(RunSandboxWorkflow");
			expect(source).not.toContain("WorkflowEngine");
		}
	}),
);

it.effect("keeps parent workflows as orchestrations instead of queue pass-through wrappers", () =>
	Effect.gen(function* () {
		const [entityImportWorkflow, libraryWorkflow, mediaImportWorkflow, integrationWorkflow] =
			yield* Effect.all([
				readModule("../entity-import/workflows.ts"),
				readModule("../library/workflows.ts"),
				readModule("../imports/workflows.ts"),
				readModule("../integrations/workflows.ts"),
			]);

		expect(entityImportWorkflow).toContain("validate-entity-details");
		expect(entityImportWorkflow).toContain("write-primary-entity");
		expect(libraryWorkflow).toContain("ensure-library-membership");

		expect(mediaImportWorkflow).toContain("load-media-import-adapter-result");
		expect(mediaImportWorkflow).toContain("record-total-items");
		expect(mediaImportWorkflow).toContain("finalize-import-run");

		expect(integrationWorkflow).toContain("mark-integration-run-started");
		expect(integrationWorkflow).toContain("finalize-integration-run");
		expect(integrationWorkflow).toContain("runOneTimeMediaImportWorkflow(");
	}),
);
