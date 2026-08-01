import { expect, it } from "@effect/vitest";
import {
	BadRequest,
	NotFound,
	SandboxRunError,
	Unauthorized,
	unauthorized,
} from "@ryot/contract/errors";
import type { PluginManifest, PluginOperationAuth } from "@ryot/contract/modules/plugins/manifest";
import { SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option } from "effect";
import { Headers } from "effect/unstable/http";
import { assert } from "vitest";

import { dbRunnerLayer } from "#lib/test-utils/effect";
import { AuthService } from "#modules/auth/service";
import { IntegrationOperationScopeResolverLive } from "#modules/integrations/operation-scope-resolver-live";
import type { IntegrationRecord } from "#modules/integrations/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { SandboxExecutionService } from "#modules/sandbox/service";

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

const makeActiveScript = (slug: string, id = "op-script-id") => ({
	slug,
	name: slug,
	source: "source",
	providerId: null,
	compiledFormat: 1,
	pluginSlug: "fixture",
	compiledCode: "compiled",
	contentHash: `${slug}-hash`,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	id: SandboxScriptId.make(id),
	metadata: {
		slug,
		name: slug,
		capabilities: [],
		kind: "operation" as const,
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
	},
});

const makeIntegration = (userId: string, isDisabled: boolean) =>
	// oxlint-disable-next-line no-unsafe-type-assertion -- test double only exercises the userId/isDisabled fields the service reads
	({ isDisabled, userId: UserId.make(userId) }) as unknown as IntegrationRecord;

const makeLayer = (input: {
	currentUserId?: UserId;
	registerPlugin?: boolean;
	auth: PluginOperationAuth;
	captured?: Array<unknown>;
	currentUserGate?: Effect.Effect<void>;
	integration?: IntegrationRecord | null;
	operationScript?: () => ReturnType<typeof makeActiveScript>;
	sandboxError?: string;
}) => {
	const integrationsRepository = Layer.mock(IntegrationsRepository)({
		getByIdAnyUser: () => Effect.succeed(input.integration ?? null),
	});
	const integrationScopeResolver = IntegrationOperationScopeResolverLive.pipe(
		Layer.provide(Layer.mergeAll(dbRunnerLayer, integrationsRepository)),
	);
	return OperationsService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				integrationScopeResolver,
				Layer.mock(AuthService)({
					// oxlint-disable-next-line no-unsafe-type-assertion -- the better-auth client is never touched by these tests
					auth: {} as AuthService["Service"]["auth"],
					currentUser: () =>
						input.currentUserId
							? (input.currentUserGate ?? Effect.void).pipe(
									Effect.as({
										name: "User",
										id: input.currentUserId,
										email: "user@example.com",
										preferences: { isNsfw: false, language: null, disableIntegrations: false },
									}),
								)
							: Effect.fail(unauthorized()),
				}),
				Layer.mock(PluginRuntimeResolver)({
					findActiveOperation: ({ operationSlug, pluginSlug }) => {
						const operation =
							pluginSlug === "fixture" && input.registerPlugin !== false
								? normalizedPlugin(input.auth).manifest.operations.find(
										({ slug }) => slug === operationSlug,
									)
								: undefined;
						return Effect.succeed(
							operation
								? {
										operation,
										script: Effect.succeed(
											input.operationScript?.() ?? makeActiveScript(operation.scriptSlug),
										),
									}
								: null,
						);
					},
				}),
				Layer.mock(SandboxExecutionService)({
					executeScript: (runInput) =>
						Effect.sync(() => {
							input.captured?.push(runInput);
							return {
								logs: [],
								value: "ok",
								status: "completed" as const,
								error: input.sandboxError
									? { phase: "execute" as const, message: input.sandboxError }
									: null,
							};
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
	const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
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

it.effect("propagates sandbox failures from operation scripts", () =>
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
		expectError(exit, SandboxRunError);
		assert(Exit.isFailure(exit));
		const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
		expect(error).toMatchObject({ message: "execute: operation failed" });
	}).pipe(
		Effect.provide(
			makeLayer({
				auth: "user",
				sandboxError: "operation failed",
				currentUserId: UserId.make("user-1"),
			}),
		),
	),
);

it.effect("keeps operation script resolution stable while authentication is pending", () =>
	Effect.gen(function* () {
		const authenticating = yield* Deferred.make<void>();
		const release = yield* Deferred.make<void>();
		const captured: Array<unknown> = [];
		let scriptId = "original-script-id";
		const layer = makeLayer({
			captured,
			auth: "user",
			currentUserId: UserId.make("user-1"),
			operationScript: () => makeActiveScript(DRIVER_REF, scriptId),
			currentUserGate: Deferred.succeed(authenticating, undefined).pipe(
				Effect.andThen(Deferred.await(release)),
			),
		});
		const fiber = yield* Effect.forkChild(
			Effect.gen(function* () {
				const service = yield* OperationsService;
				return yield* service.invoke({
					payload: {},
					pluginSlug: "fixture",
					headers: Headers.empty,
					operationSlug: OPERATION_SLUG,
				});
			}).pipe(Effect.provide(layer)),
		);
		yield* Deferred.await(authenticating);
		scriptId = "replacement-script-id";
		yield* Deferred.succeed(release, undefined);
		expect(yield* Fiber.join(fiber)).toBe("ok");
		expect(captured).toEqual([expect.objectContaining({ scriptId: "original-script-id" })]);
	}),
);

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
