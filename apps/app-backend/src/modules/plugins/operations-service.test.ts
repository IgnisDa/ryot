import { Headers } from "@effect/platform";
import { expect, it } from "@effect/vitest";
import { BadRequest, NotFound, Unauthorized, unauthorized } from "@ryot/contract/errors";
import { SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import type { PluginManifest, PluginOperationAuth } from "@ryot/plugin-kit/manifest";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { assert } from "vitest";

import { SandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { dbRunnerLayer } from "#lib/test-utils/effect";
import { AuthService } from "#modules/auth/service";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";
import type { IntegrationRecord } from "#modules/integrations/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { SandboxRepository } from "#modules/sandbox/repository";

import { makePluginLoader, PluginLoader } from "./loader";
import { OperationsService } from "./operations-service";
import { PluginRuntimeResolver } from "./runtime-resolver";
import { fixtureManifest } from "./test-support";
import type { NormalizedPlugin } from "./types";

const DRIVER_REF = "operation.fixture";
const OPERATION_SLUG = "resolve.fixture";

const normalizedPlugin = (auth: PluginOperationAuth): NormalizedPlugin => {
	const manifest = fixtureManifest();
	const declared = manifest.scripts[0];
	assert(declared);
	const operationScript = {
		...declared,
		kind: "operation" as const,
		name: "Operation",
		slug: DRIVER_REF,
	};
	const normalizedManifest = {
		...manifest,
		savedViews: [],
		entitySchemas: [],
		signalSchemas: [],
		relationshipSchemas: [],
		scripts: [operationScript],
		bindings: {
			eventAutomations: [],
			entityAutomations: [],
			signalAutomations: [],
			schemaProviderLinks: [],
			relationshipAutomations: [],
		},
		operations: [
			{ auth, slug: OPERATION_SLUG, scriptSlug: DRIVER_REF, description: "Resolve fixture" },
		],
	} satisfies PluginManifest;
	const { entry, ...metadata } = operationScript;
	return {
		sourceHash: "fixture-source",
		manifest: normalizedManifest,
		scripts: [
			{
				entry,
				name: "Operation",
				slug: DRIVER_REF,
				source: "source",
				compiledFormat: 1,
				compiledCode: "compiled",
				contentHash: "fixture-compiled",
				metadata,
			},
		],
	};
};

const makeActiveScript = (slug: string) => ({
	slug,
	name: slug,
	source: "source",
	compiledFormat: 1,
	pluginSlug: "fixture",
	providerId: null,
	compiledCode: "compiled",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	contentHash: `${slug}-hash`,
	id: SandboxScriptId.make("op-script-id"),
	metadata: {
		slug,
		name: slug,
		capabilities: [],
		kind: "operation" as const,
		requiredAppConfigKeys: [],
	},
});

const makeIntegration = (userId: string, isDisabled: boolean) =>
	// oxlint-disable-next-line no-unsafe-type-assertion -- test double only exercises the userId/isDisabled fields the service reads
	({ isDisabled, userId: UserId.make(userId) }) as unknown as IntegrationRecord;

const makeLayer = (input: {
	auth: PluginOperationAuth;
	registerPlugin?: boolean;
	captured?: Array<unknown>;
	currentUserId?: UserId;
	integration?: IntegrationRecord | null;
}) => {
	const loader = makePluginLoader(makeDefinitionRegistry());
	if (input.registerPlugin !== false) {
		loader.load(normalizedPlugin(input.auth));
	}
	return OperationsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				Layer.succeed(PluginLoader, { _tag: "PluginLoader", ...loader }),
				Layer.mock(AuthService)({
					_tag: "AuthService",
					// oxlint-disable-next-line no-unsafe-type-assertion -- the better-auth client is never touched by these tests
					auth: {} as AuthService["auth"],
					currentUser: () =>
						input.currentUserId
							? Effect.succeed({
									name: "User",
									email: "user@example.com",
									id: input.currentUserId,
									preferences: { isNsfw: false, language: null, disableIntegrations: false },
								})
							: Effect.fail(unauthorized()),
				}),
				Layer.mock(IntegrationsRepository)({
					_tag: "IntegrationsRepository",
					getByIdAnyUser: () => Effect.succeed(input.integration ?? null),
				}),
				Layer.mock(PluginRuntimeResolver)({
					_tag: "PluginRuntimeResolver",
					findActiveScript: (slug) => Effect.succeed(makeActiveScript(slug)),
				}),
				Layer.mock(SandboxService)({
					_tag: "SandboxService",
					run: (runInput) =>
						Effect.sync(() => {
							input.captured?.push(runInput);
							return {
								logs: [],
								error: null,
								value: "ok",
								success: true,
								harvest: null,
								executionId: runInput.executionId,
								timing: { totalMs: 1, executionMs: 1 },
							};
						}),
				}),
				Layer.mock(SandboxRepository)({
					_tag: "SandboxRepository",
					isPluginScript: () => Effect.succeed(true),
					getScript: (scriptId) =>
						Effect.succeed({
							id: scriptId,
							providerId: null,
							compiledFormat: 1,
							compiledCode: "compiled",
							metadata: { capabilities: [] },
						}),
				}),
			),
		),
	);
};

const expectError = (
	exit: Exit.Exit<unknown, unknown>,
	ErrorClass: new (...args: never[]) => unknown,
) => {
	assert(Exit.isFailure(exit));
	const error = Option.getOrThrow(Cause.failureOption(exit.cause));
	expect(error).toBeInstanceOf(ErrorClass);
};

it.effect("returns NotFound for an unknown plugin", () =>
	Effect.gen(function* () {
		const service = yield* OperationsService;
		const exit = yield* Effect.exit(
			service.invoke({
				payload: {},
				pluginSlug: "missing",
				headers: Headers.empty,
				operationSlug: OPERATION_SLUG,
			}),
		);
		expectError(exit, NotFound);
	}).pipe(Effect.provide(makeLayer({ auth: "user" }))),
);

it.effect("returns NotFound for an unknown operation", () =>
	Effect.gen(function* () {
		const service = yield* OperationsService;
		const exit = yield* Effect.exit(
			service.invoke({
				payload: {},
				pluginSlug: "fixture",
				headers: Headers.empty,
				operationSlug: "missing",
			}),
		);
		expectError(exit, NotFound);
	}).pipe(Effect.provide(makeLayer({ auth: "user" }))),
);

it.effect("rejects integration operations without an integrationId payload", () =>
	Effect.gen(function* () {
		const service = yield* OperationsService;
		const exit = yield* Effect.exit(
			service.invoke({
				payload: {},
				pluginSlug: "fixture",
				headers: Headers.empty,
				operationSlug: OPERATION_SLUG,
			}),
		);
		expectError(exit, BadRequest);
	}).pipe(Effect.provide(makeLayer({ auth: "integration" }))),
);

it.effect("rejects integration operations for a missing or disabled integration", () =>
	Effect.forEach([null, makeIntegration("user-1", true)] as const, (integration) =>
		Effect.gen(function* () {
			const service = yield* OperationsService;
			const exit = yield* Effect.exit(
				service.invoke({
					pluginSlug: "fixture",
					headers: Headers.empty,
					operationSlug: OPERATION_SLUG,
					payload: { integrationId: "int-1" },
				}),
			);
			expectError(exit, NotFound);
		}).pipe(Effect.provide(makeLayer({ auth: "integration", integration }))),
	),
);

it.effect("dispatches integration operations as the owning user", () => {
	const captured: Array<unknown> = [];
	return Effect.gen(function* () {
		const service = yield* OperationsService;
		const result = yield* service.invoke({
			pluginSlug: "fixture",
			headers: Headers.empty,
			operationSlug: OPERATION_SLUG,
			payload: { integrationId: "int-1" },
		});
		expect(result).toBe("ok");
		expect(captured).toEqual([
			expect.objectContaining({
				authority: { type: "user", userId: "user-1", integrationId: "int-1" },
			}),
		]);
	}).pipe(
		Effect.provide(
			makeLayer({ auth: "integration", captured, integration: makeIntegration("user-1", false) }),
		),
	);
});

it.effect("dispatches authenticated user operations without system authority", () => {
	const captured: Array<unknown> = [];
	return Effect.gen(function* () {
		const service = yield* OperationsService;
		const result = yield* service.invoke({
			payload: {},
			pluginSlug: "fixture",
			headers: Headers.empty,
			operationSlug: OPERATION_SLUG,
		});
		expect(result).toBe("ok");
		expect(captured).toEqual([
			expect.objectContaining({ authority: { type: "user", userId: "user-1" } }),
		]);
	}).pipe(
		Effect.provide(makeLayer({ auth: "user", captured, currentUserId: UserId.make("user-1") })),
	);
});

it.effect("rejects user operations without an authenticated session", () =>
	Effect.gen(function* () {
		const service = yield* OperationsService;
		const exit = yield* Effect.exit(
			service.invoke({
				payload: {},
				pluginSlug: "fixture",
				headers: Headers.empty,
				operationSlug: OPERATION_SLUG,
			}),
		);
		expectError(exit, Unauthorized);
	}).pipe(Effect.provide(makeLayer({ auth: "user" }))),
);
