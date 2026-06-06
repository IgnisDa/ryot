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
			entityWorkflow,
			mediaImportWorkflow,
			integrationWorkflow,
		] = yield* Effect.all([
			readModule("./service.ts"),
			readModule("./workflows.ts"),
			readModule("../events/create-core.ts"),
			readModule("../entities/workflows.ts"),
			readModule("../imports/workflows.ts"),
			readModule("../integrations/workflows.ts"),
		]);

		expect(sandboxService.match(/\.execute\(RunSandboxWorkflow,/g)?.length ?? 0).toBe(1);
		expect(eventCreateCore.match(/\.execute\(RunSandboxWorkflow,/g)?.length ?? 0).toBe(1);
		expect(sandboxWorkflow).toContain("DurableQueue.process(SandboxExecutionQueue, payload)");

		for (const source of [entityWorkflow, mediaImportWorkflow, integrationWorkflow]) {
			expect(source).not.toContain("execute(RunSandboxWorkflow");
			expect(source).not.toContain("WorkflowEngine");
		}
	}),
);

it.effect("keeps parent workflows as orchestrations instead of queue pass-through wrappers", () =>
	Effect.gen(function* () {
		const [entityWorkflow, mediaImportWorkflow, integrationWorkflow] = yield* Effect.all([
			readModule("../entities/workflows.ts"),
			readModule("../imports/workflows.ts"),
			readModule("../integrations/workflows.ts"),
		]);

		expect(entityWorkflow).toContain("validate-entity-details");
		expect(entityWorkflow).toContain("write-primary-entity");
		expect(entityWorkflow).toContain("ensure-library-membership");

		expect(mediaImportWorkflow).toContain("load-media-import-adapter-result");
		expect(mediaImportWorkflow).toContain("record-total-items");
		expect(mediaImportWorkflow).toContain("finalize-import-run");

		expect(integrationWorkflow).toContain("mark-integration-run-started");
		expect(integrationWorkflow).toContain("finalize-integration-run");
		expect(integrationWorkflow).toContain("runOneTimeMediaImportWorkflow(");
	}),
);
