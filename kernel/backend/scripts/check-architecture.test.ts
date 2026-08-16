import { expect, it } from "@effect/vitest";

import { findWorkflowScopeViolations } from "./check-architecture";

const source = (path: string, body: string) => [{ path, source: body }];

it("reports Activity.make( in a production file", () => {
	const findings = findWorkflowScopeViolations(
		source(
			"kernel/backend/src/modules/example/workflow.ts",
			`const activity = Activity.make({ name: "example", execute });`,
		),
	);

	expect(findings).toEqual([
		"kernel/backend/src/modules/example/workflow.ts: Activity.make( must go through makeActivity in src/lib/infrastructure/workflow-scope.ts",
	]);
});

it("reports .toLayer( in a test file", () => {
	const findings = findWorkflowScopeViolations(
		source(
			"kernel/backend/src/modules/example/workflow.test.ts",
			`const layer = ExampleWorkflow.toLayer(runExampleWorkflow);`,
		),
	);

	expect(findings).toEqual([
		"kernel/backend/src/modules/example/workflow.test.ts: .toLayer( must go through implementWorkflow in src/lib/infrastructure/workflow-scope.ts",
	]);
});

it("does not report workflow-scope.ts itself", () => {
	const findings = findWorkflowScopeViolations(
		source(
			"kernel/backend/src/lib/infrastructure/workflow-scope.ts",
			`
				export const makeActivity = (options) => Activity.make(options);
				export const implementWorkflow = (workflow, execute) => workflow.toLayer(execute);
			`,
		),
	);

	expect(findings).toEqual([]);
});

it("does not report a file using makeActivity and implementWorkflow", () => {
	const findings = findWorkflowScopeViolations(
		source(
			"kernel/backend/src/modules/example/workflow.ts",
			`
				const activity = makeActivity({ name: "example", execute });
				const layer = implementWorkflow(ExampleWorkflow, runExampleWorkflow);
			`,
		),
	);

	expect(findings).toEqual([]);
});
