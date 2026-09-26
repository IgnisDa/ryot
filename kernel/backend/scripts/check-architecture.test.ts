import { expect, it } from "@effect/vitest";

import { findDemoAccessPolicyViolations, findWorkflowScopeViolations } from "./check-architecture";

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

const contract = (endpoint: string, middleware = "AuthMiddleware") => `
	const Group = HttpApiGroup.make("example")
		.add(${endpoint})
		.middleware(${middleware});
`;

it("reports an unclassified authenticated POST", () =>
	findDemoAccessPolicyViolations(
		source(
			"packages/contract/src/modules/example/contract.ts",
			contract('HttpApiEndpoint.post("create", "/example")'),
		),
	).then((findings) =>
		expect(findings).toEqual([
			'packages/contract/src/modules/example/contract.ts:3: authenticated POST /example must annotate DemoAccessPolicy with "allowed" or "protected"',
		]),
	));

it("reports an unclassified authenticated PATCH", () =>
	findDemoAccessPolicyViolations(
		source(
			"packages/contract/src/modules/example/contract.ts",
			contract('HttpApiEndpoint.patch("update", "/example/:id")'),
		),
	).then((findings) => expect(findings).toHaveLength(1)));

it("reports an unclassified mutation using a direct local AuthMiddleware alias", () =>
	findDemoAccessPolicyViolations(
		source(
			"packages/contract/src/modules/example/contract.ts",
			`const UserAuth = AuthMiddleware;
			${contract('HttpApiEndpoint.post("create", "/example")', "UserAuth")}`,
		),
	).then((findings) => expect(findings).toHaveLength(1)));

it("reports an unclassified mutation using an imported AuthMiddleware alias", () =>
	findDemoAccessPolicyViolations(
		source(
			"packages/contract/src/modules/example/contract.ts",
			`import { AuthMiddleware as UserAuth } from "./middleware";
			${contract('HttpApiEndpoint.post("create", "/example")', "UserAuth")}`,
		),
	).then((findings) => expect(findings).toHaveLength(1)));

it("reports an unclassified authenticated endpoint referenced by identifier", () =>
	findDemoAccessPolicyViolations(
		source(
			"packages/contract/src/modules/example/contract.ts",
			`const Create = HttpApiEndpoint.post("create", "/example");
			const Group = HttpApiGroup.make("example")
				.add(Create)
				.middleware(AuthMiddleware);`,
		),
	).then((findings) =>
		expect(findings).toEqual([
			'packages/contract/src/modules/example/contract.ts:1: authenticated POST /example must annotate DemoAccessPolicy with "allowed" or "protected"',
		]),
	));

it("reports an unclassified endpoint when an identifier group adds AuthMiddleware", () =>
	findDemoAccessPolicyViolations(
		source(
			"packages/contract/src/modules/example/contract.ts",
			`const Create = HttpApiEndpoint.post("create", "/example");
			const BaseGroup = HttpApiGroup.make("example").add(Create);
			const Group = BaseGroup.middleware(AuthMiddleware);`,
		),
	).then((findings) =>
		expect(findings).toEqual([
			'packages/contract/src/modules/example/contract.ts:1: authenticated POST /example must annotate DemoAccessPolicy with "allowed" or "protected"',
		]),
	));

it.each(["allowed", "protected"])("accepts an explicitly %s mutation", (policy) =>
	findDemoAccessPolicyViolations(
		source(
			"packages/contract/src/modules/example/contract.ts",
			contract(
				`HttpApiEndpoint.post("create", "/example").annotate(DemoAccessPolicy, "${policy}")`,
			),
		),
	).then((findings) => expect(findings).toEqual([])),
);

it("accepts a classified endpoint referenced through an identifier group", () =>
	findDemoAccessPolicyViolations(
		source(
			"packages/contract/src/modules/example/contract.ts",
			`const Create = HttpApiEndpoint.post("create", "/example").annotate(
				DemoAccessPolicy,
				"protected",
			);
			const BaseGroup = HttpApiGroup.make("example").add(Create);
			const Group = BaseGroup.middleware(AuthMiddleware);`,
		),
	).then((findings) => expect(findings).toEqual([])));

it("accepts an ordinary GET without an annotation", () =>
	findDemoAccessPolicyViolations(
		source(
			"packages/contract/src/modules/example/contract.ts",
			contract('HttpApiEndpoint.get("get", "/example")'),
		),
	).then((findings) => expect(findings).toEqual([])));

it("accepts an explicitly protected GET", () =>
	findDemoAccessPolicyViolations(
		source(
			"packages/contract/src/modules/example/contract.ts",
			contract('HttpApiEndpoint.get("get", "/example").annotate(DemoAccessPolicy, "protected")'),
		),
	).then((findings) => expect(findings).toEqual([])));

it("does not report an AdminMiddleware mutation", () =>
	findDemoAccessPolicyViolations(
		source(
			"packages/contract/src/modules/example/contract.ts",
			contract('HttpApiEndpoint.delete("delete", "/example/:id")', "AdminMiddleware"),
		),
	).then((findings) => expect(findings).toEqual([])));

it("does not report an unauthenticated mutation added after AuthMiddleware", () =>
	findDemoAccessPolicyViolations(
		source(
			"packages/contract/src/modules/example/contract.ts",
			`const Group = HttpApiGroup.make("example")
				.add(HttpApiEndpoint.get("get", "/example"))
				.middleware(AuthMiddleware)
				.add(HttpApiEndpoint.post("webhook", "/example/webhook"));`,
		),
	).then((findings) => expect(findings).toEqual([])));
