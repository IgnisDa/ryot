import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest, NotFound } from "@ryot/contract/errors";
import { SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import { dbRunnerLayer, makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

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
	userId: user.id,
	isBuiltin: false,
	compiledCode: "compiled",
};

const mockRepository = Layer.mock(SandboxRepository);
const makeRepository = (overrides: MockOverrides<typeof mockRepository> = {}) =>
	mockRepository({ _tag: "SandboxRepository", ...overrides });

const compilerLayer = Layer.mock(SandboxCompiler)({ _tag: "SandboxCompiler" });
const workflowEngineLayer = Layer.succeed(
	WorkflowEngine,
	makeWorkflowEngine({ execute: () => Effect.succeed(null) }),
);
const makePluginRuntime = (
	findActiveScriptById: PluginRuntimeResolver["findActiveScriptById"] = () => Effect.succeed(null),
) =>
	Layer.mock(PluginRuntimeResolver)({
		_tag: "PluginRuntimeResolver",
		findActiveScriptById,
	});

const makeServiceLayer = (
	repository: ReturnType<typeof makeRepository>,
	pluginRuntime = makePluginRuntime(),
	workflowEngine = workflowEngineLayer,
) =>
	SandboxApiService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				compilerLayer,
				repository,
				workflowEngine,
				makeAppConfigLayer(),
				pluginRuntime,
			),
		),
	);

it.effect(
	"rejects inactive plugin scripts at enqueue while retaining legacy and active scripts",
	() => {
		const cases = [
			{ pluginOwned: true, active: false, rejected: true },
			{ pluginOwned: true, active: true, rejected: false },
			{ pluginOwned: false, active: false, rejected: false },
		] as const;

		return Effect.forEach(cases, ({ active, pluginOwned, rejected }) => {
			let executionCount = 0;
			const activeScript = {
				...storedScript,
				userId: null,
				contentHash: "hash",
				pluginSlug: "active-plugin",
				createdAt: new Date(0),
				updatedAt: new Date(0),
			};
			const layer = makeServiceLayer(
				makeRepository({
					isPluginScript: () => Effect.succeed(pluginOwned),
					getScriptForUser: () => Effect.succeed(storedScript),
				}),
				makePluginRuntime(() => Effect.succeed(active ? activeScript : null)),
				Layer.succeed(
					WorkflowEngine,
					makeWorkflowEngine({
						execute: () =>
							Effect.sync(() => {
								executionCount += 1;
								return null;
							}),
					}),
				),
			);
			return Effect.gen(function* () {
				const service = yield* SandboxApiService;
				const exit = yield* Effect.exit(
					service.enqueue(user, { scriptId, driverName: "run", context: {} }),
				);
				if (rejected) {
					expect(exit).toEqual(Exit.fail(new NotFound({ message: "Sandbox script not found" })));
					expect(executionCount).toBe(0);
				} else {
					expect(Exit.isSuccess(exit)).toBe(true);
					expect(executionCount).toBe(1);
				}
			}).pipe(Effect.provide(layer));
		});
	},
);

it.effect("pins a stale active plugin ID to the current row before starting the workflow", () => {
	const currentScriptId = SandboxScriptId.make("current-script-id");
	let capturedOptions: Parameters<WorkflowEngine["Type"]["execute"]>[1] | undefined;
	const workflowEngine = Layer.succeed(
		WorkflowEngine,
		makeWorkflowEngine({
			execute: (_workflow, options) => {
				capturedOptions = options;
				return Effect.succeed(null);
			},
		}),
	);
	const layer = makeServiceLayer(
		makeRepository({
			isPluginScript: () => Effect.succeed(true),
			getScriptForUser: () => Effect.succeed(storedScript),
		}),
		makePluginRuntime(() =>
			Effect.succeed({
				...storedScript,
				userId: null,
				id: currentScriptId,
				contentHash: "current-hash",
				pluginSlug: "active-plugin",
				createdAt: new Date(1),
				updatedAt: new Date(1),
			}),
		),
		workflowEngine,
	);

	return Effect.gen(function* () {
		const service = yield* SandboxApiService;
		yield* service.enqueue(user, { scriptId, driverName: "run", context: {} });

		expect(capturedOptions?.payload).toMatchObject({
			userId: user.id,
			driverName: "run",
			scriptId: currentScriptId,
		});
	}).pipe(Effect.provide(layer));
});

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
					makePluginRuntime(),
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
