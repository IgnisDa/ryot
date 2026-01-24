import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest } from "@ryot/contract/errors";
import { SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import { dbRunnerLayer, makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-utils/effect";

import { SandboxCompiler } from "./compiler";
import { SandboxRepository } from "./repository";
import { SandboxApiService } from "./service";

const scriptId = SandboxScriptId.make("script-id");
const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-1"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;
const storedScript = {
	metadata: {},
	id: scriptId,
	source: "source",
	compiledFormat: 1,
	slug: "test-script",
	name: "Test Script",
	compiledCode: "compiled",
};

const mockRepository = Layer.mock(SandboxRepository);
const makeRepository = (overrides: MockOverrides<typeof mockRepository> = {}) =>
	mockRepository({ _tag: "SandboxRepository", ...overrides });

const compilerLayer = Layer.mock(SandboxCompiler)({ _tag: "SandboxCompiler" });
const workflowEngineLayer = Layer.succeed(WorkflowEngine, makeWorkflowEngine());

const makeServiceLayer = (repository: ReturnType<typeof makeRepository>) =>
	SandboxApiService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				compilerLayer,
				repository,
				workflowEngineLayer,
				makeAppConfigLayer(),
			),
		),
	);

it.effect("delegates stored script patch, promotion, and idempotent deletion", () => {
	const calls: string[] = [];
	const layer = makeServiceLayer(
		makeRepository({
			patchScript: () =>
				Effect.sync(() => {
					calls.push("patch");
					return storedScript;
				}),
			promoteScript: () =>
				Effect.sync(() => {
					calls.push("promote");
					return storedScript;
				}),
			deleteScript: () =>
				Effect.sync(() => {
					calls.push("delete");
					return null;
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SandboxApiService;
		expect(yield* service.patchStoredScript({ scriptId, source: "tampered" })).toEqual(
			storedScript,
		);
		expect(yield* service.promoteStoredScript(scriptId)).toEqual(storedScript);
		expect(yield* service.deleteStoredScript(scriptId)).toBeNull();
		expect(calls).toEqual(["patch", "promote", "delete"]);
	}).pipe(Effect.provide(layer));
});

for (const capability of ["emitSignal", "sendNotification"] as const) {
	it.effect(`rejects public scripts requesting ${capability}`, () => {
		const compiler = Layer.mock(SandboxCompiler, {
			_tag: "SandboxCompiler",
			compile: () =>
				Effect.succeed({
					format: 1 as const,
					javascript: "compiled",
					manifest: {
						requiredAppConfigKeys: [],
						name: "Restricted script",
						capabilities: [capability],
						kind: "automation" as const,
						slug: `restricted-${capability}`,
					},
				}),
		});
		const layer = SandboxApiService.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
					dbRunnerLayer,
					compiler,
					makeRepository(),
					workflowEngineLayer,
					makeAppConfigLayer(),
				),
			),
		);

		return Effect.gen(function* () {
			const service = yield* SandboxApiService;
			expect(yield* Effect.exit(service.createScript(user, { source: "source" }))).toEqual(
				Exit.fail(
					new BadRequest({
						message: "Public sandbox scripts cannot request automation host capabilities",
					}),
				),
			);
		}).pipe(Effect.provide(layer));
	});
}
