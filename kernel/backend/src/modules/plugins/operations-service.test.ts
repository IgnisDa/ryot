import { expect, layer } from "@effect/vitest";
import { AuthUnauthorized, DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import type { PluginOperation } from "@ryot-app/contract/modules/plugins/manifest";
import {
	PluginConflictError,
	PluginInvocationError,
	PluginNotFoundError,
	PluginRequestError,
} from "@ryot-app/contract/modules/plugins/schemas";
import type { AccessClass } from "@ryot-app/contract/oauth";
import { IntegrationId, SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { Cause, Context, Effect, Exit, Layer, Option, Ref } from "effect";
import { Headers } from "effect/http";
import { assert } from "vitest";

import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";
import { AuthService } from "#modules/auth/service";
import { IntegrationOperationScopeResolverLive } from "#modules/integrations/operation-scope-resolver-live";
import type { IntegrationRecord } from "#modules/integrations/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { makeIntegration as integrationRecord } from "#modules/integrations/test-support";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { OperationsService } from "./operations-service";
import { PluginRepository } from "./repository";
import { PluginRuntimeResolver } from "./runtime-resolver";
import { fixtureManifest } from "./test-support";

const SYSTEM_SLUG = "fixture";
const PRIVATE_SLUG = "private";
const DRIVER_REF = "operation.fixture";
const OPERATION_SLUG = "resolve.fixture";
const SOURCE_HASH = "source-hash";

const USER_ONE = UserId.make("user-1");
const USER_TWO = UserId.make("user-2");

type AvailableOperation = (
	| Pick<Extract<PluginOperation, { auth: "user" }>, "auth" | "demoAccess">
	| Pick<Extract<PluginOperation, { auth: "integration" }>, "auth">
) & {
	readonly ownerId: UserId;
	readonly pluginSlug: string;
	readonly scriptId?: string;
	readonly installationId: string;
	readonly scope: "system" | "user";
};

const makeActiveScript = (id: string) => ({
	slug: DRIVER_REF,
	providerId: null,
	name: DRIVER_REF,
	compiledFormat: 1,
	pluginId: "fixture",
	createdAt: new Date(0),
	compiledCode: "compiled",
	id: SandboxScriptId.make(id),
	contentHash: "fixture-compiled",
	pluginRevisionId: "fixture-revision",
	metadata: {
		name: DRIVER_REF,
		slug: DRIVER_REF,
		...emptySandboxExecutionMetadata,
		kind: "operation" as const,
	},
});

const resolvedOperation = (available: AvailableOperation) => ({
	script: makeActiveScript(available.scriptId ?? `${available.installationId}-script`),
	operation:
		available.auth === "user"
			? {
					auth: available.auth,
					slug: OPERATION_SLUG,
					scriptSlug: DRIVER_REF,
					demoAccess: available.demoAccess,
					description: "Fixture operation",
				}
			: {
					auth: available.auth,
					slug: OPERATION_SLUG,
					scriptSlug: DRIVER_REF,
					description: "Fixture operation",
				},
	plugin: {
		isHidden: false,
		scope: available.scope,
		sourceHash: SOURCE_HASH,
		health: "ready" as const,
		slug: available.pluginSlug,
		manifest: fixtureManifest(),
		pluginRevisionId: "fixture-revision",
		id: `${available.pluginSlug}-plugin-id`,
		pluginConfigRevisionId: "fixture-config",
		installationId: available.installationId,
		compiledHashes: { [DRIVER_REF]: "fixture-compiled" },
		ownerUserId: available.scope === "user" ? available.ownerId : null,
	},
});

const makeIntegration = (input: {
	userId: UserId;
	lot?: IntegrationRecord["lot"];
	isDisabled?: boolean;
	pluginInstallationId: string;
}) =>
	integrationRecord({
		userId: input.userId,
		lot: input.lot ?? "push",
		id: IntegrationId.make("int-1"),
		isDisabled: input.isDisabled ?? false,
		pluginInstallationId: input.pluginInstallationId,
	});

class FakeOperationDependencies extends Context.Service<
	FakeOperationDependencies,
	{
		readonly events: Effect.Effect<ReadonlyArray<string>>;
		readonly captured: Effect.Effect<ReadonlyArray<unknown>>;
		readonly offerOperations: (available: ReadonlyArray<AvailableOperation>) => Effect.Effect<void>;
		readonly useIntegration: (integration: IntegrationRecord | null) => Effect.Effect<void>;
	}
>()("test/FakeOperationDependencies") {}

class OperationFakeState extends Context.Service<
	OperationFakeState,
	{
		readonly events: Ref.Ref<ReadonlyArray<string>>;
		readonly captured: Ref.Ref<ReadonlyArray<unknown>>;
		readonly integration: Ref.Ref<IntegrationRecord | null>;
		readonly available: Ref.Ref<ReadonlyArray<AvailableOperation>>;
	}
>()("test/OperationFakeState") {}

const makeLayer = (input: {
	sandboxError?: string;
	sandboxValue?: unknown;
	currentUserId?: UserId;
	accessClass?: AccessClass;
	activeSourceHash?: string;
	integration?: IntegrationRecord | null;
	available?: ReadonlyArray<AvailableOperation>;
}) => {
	const stateLayer = Layer.effect(
		OperationFakeState,
		Effect.gen(function* () {
			return {
				available: yield* Ref.make(input.available ?? []),
				events: yield* Ref.make<ReadonlyArray<string>>([]),
				captured: yield* Ref.make<ReadonlyArray<unknown>>([]),
				integration: yield* Ref.make(input.integration ?? null),
			};
		}),
	);
	const fakesLayer = Layer.unwrap(
		Effect.map(OperationFakeState, (state) => {
			const recordEvent = (event: string) => Ref.update(state.events, (all) => [...all, event]);
			return Layer.mergeAll(
				Layer.succeed(FakeOperationDependencies, {
					events: Ref.get(state.events),
					captured: Ref.get(state.captured),
					offerOperations: (available) => Ref.set(state.available, available),
					useIntegration: (integration) => Ref.set(state.integration, integration),
				}),
				Layer.mock(IntegrationsRepository)({
					getByIdAnyUser: () => Ref.get(state.integration),
					getByWebhookToken: () => Ref.get(state.integration),
				}),
				Layer.mock(PluginRepository)({
					lockIngestion: () => recordEvent("lock"),
					isActiveRevision: ({ sourceHash }) =>
						recordEvent("revision").pipe(
							Effect.as(sourceHash === (input.activeSourceHash ?? SOURCE_HASH)),
						),
				}),
				Layer.mock(AuthService)({
					handler: () => Effect.die("unused").pipe(Effect.runPromise),
					resolveRequestCredential: () =>
						input.currentUserId
							? Effect.succeed({
									authorization: {
										userId: input.currentUserId,
										accessClass: input.accessClass ?? "standard",
										credential: { kind: "api-key", keyId: "test-key" },
									},
									user: {
										image: null,
										name: "User",
										id: input.currentUserId,
										email: "user@example.com",
										preferences: { language: null, disableIntegrations: false },
										accountGeneration: {
											userId: input.currentUserId,
											token: "test-account-generation",
										},
									},
								})
							: Effect.fail(new AuthUnauthorized({ reason: { code: "authentication-required" } })),
				}),
				Layer.mock(PluginRuntimeResolver)({
					findOperationAvailableToUser: ({ userId, pluginSlug, operationSlug }) =>
						Effect.map(Ref.get(state.available), (available) => {
							const match = available.find(
								(candidate) =>
									candidate.ownerId === userId &&
									candidate.pluginSlug === pluginSlug &&
									operationSlug === OPERATION_SLUG,
							);
							return match ? resolvedOperation(match) : null;
						}),
				}),
				Layer.mock(SandboxExecutionService)({
					executeScript: (runInput) =>
						recordEvent("dispatch").pipe(
							Effect.andThen(Ref.update(state.captured, (all) => [...all, runInput])),
							Effect.as({
								logs: [],
								status: "completed" as const,
								value: "sandboxValue" in input ? input.sandboxValue : "ok",
								error: input.sandboxError
									? {
											phase: "execute" as const,
											message: input.sandboxError,
											kind: "script-failure" as const,
										}
									: null,
							}),
						),
				}),
			);
		}),
	);
	return OperationsService.layer.pipe(
		Layer.provide(IntegrationOperationScopeResolverLive),
		Layer.provideMerge(fakesLayer),
		Layer.provideMerge(stateLayer),
		Layer.provideMerge(mutationAdmissionTestLayer),
	);
};

const systemUserOperation = {
	auth: "user",
	scope: "system",
	ownerId: USER_ONE,
	demoAccess: "allowed",
	pluginSlug: SYSTEM_SLUG,
	installationId: "install-fixture-user-1",
} satisfies AvailableOperation;

const systemIntegrationOperation = {
	scope: "system",
	ownerId: USER_ONE,
	auth: "integration",
	pluginSlug: SYSTEM_SLUG,
	installationId: "install-fixture-user-1",
} satisfies AvailableOperation;

const privateIntegrationOperation = {
	scope: "user",
	ownerId: USER_ONE,
	auth: "integration",
	pluginSlug: PRIVATE_SLUG,
	installationId: "install-private-user-1",
} satisfies AvailableOperation;

const expectError = (
	exit: Exit.Exit<unknown, unknown>,
	ErrorClass: new (...args: never[]) => unknown,
) => {
	assert(Exit.isFailure(exit));
	const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
	expect(error).toBeInstanceOf(ErrorClass);
};

const invoke = (input: {
	pluginSlug: string;
	payload?: JsonValue;
	sourceHash?: string;
	operationSlug?: string;
}) =>
	Effect.flatMap(OperationsService, (service) =>
		service.invoke({
			headers: Headers.empty,
			payload: input.payload ?? {},
			pluginSlug: input.pluginSlug,
			operationSlug: input.operationSlug ?? OPERATION_SLUG,
			...(input.sourceHash === undefined ? {} : { sourceHash: input.sourceHash }),
		}),
	);

layer(makeLayer({ currentUserId: USER_ONE, available: [systemUserOperation] }))((test) => {
	test.effect("returns NotFound for a plugin absent from every registry the caller owns", () =>
		Effect.gen(function* () {
			expectError(yield* Effect.exit(invoke({ pluginSlug: "missing" })), PluginNotFoundError);
		}),
	);
});

layer(makeLayer({ currentUserId: USER_ONE, available: [systemUserOperation] }))((test) => {
	test.effect("returns NotFound for an unknown operation", () =>
		Effect.gen(function* () {
			expectError(
				yield* Effect.exit(invoke({ pluginSlug: SYSTEM_SLUG, operationSlug: "missing" })),
				PluginNotFoundError,
			);
		}),
	);
});

layer(
	makeLayer({
		currentUserId: USER_ONE,
		available: [systemUserOperation],
		activeSourceHash: "next-source-hash",
	}),
)((test) => {
	test.effect("rejects a plugin operation when its active source revision changed", () =>
		Effect.gen(function* () {
			const fake = yield* FakeOperationDependencies;
			expectError(
				yield* Effect.exit(invoke({ pluginSlug: SYSTEM_SLUG, sourceHash: SOURCE_HASH })),
				PluginConflictError,
			);
			expect(yield* fake.captured).toEqual([]);
			expect(yield* fake.events).toEqual(["lock", "revision"]);
		}),
	);
});

layer(
	makeLayer({
		currentUserId: USER_TWO,
		available: [
			{
				auth: "user",
				scope: "user",
				ownerId: USER_ONE,
				demoAccess: "allowed",
				pluginSlug: PRIVATE_SLUG,
				installationId: "install-private-user-1",
			},
		],
	}),
)((test) => {
	test.effect("returns NotFound for a slug that exists only in another user's registry", () =>
		Effect.gen(function* () {
			expectError(yield* Effect.exit(invoke({ pluginSlug: PRIVATE_SLUG })), PluginNotFoundError);
		}),
	);
});

layer(
	makeLayer({
		currentUserId: USER_ONE,
		available: [
			{
				auth: "user",
				scope: "user",
				ownerId: USER_ONE,
				demoAccess: "allowed",
				pluginSlug: PRIVATE_SLUG,
				installationId: "install-private-user-1",
			},
		],
	}),
)((test) => {
	test.effect("dispatches a private operation with the owning user's subject", () =>
		Effect.gen(function* () {
			const fake = yield* FakeOperationDependencies;
			expect(yield* invoke({ pluginSlug: PRIVATE_SLUG })).toBe("ok");
			expect(yield* fake.captured).toEqual([
				expect.objectContaining({
					scriptId: "install-private-user-1-script",
					subject: {
						type: "user",
						userId: USER_ONE,
						accountGeneration: { userId: USER_ONE, token: "test-account-generation" },
					},
				}),
			]);
		}),
	);
});

layer(makeLayer({ currentUserId: USER_ONE, available: [systemUserOperation] }))((test) => {
	test.effect("preserves user operation access for standard credentials", () =>
		Effect.gen(function* () {
			const fake = yield* FakeOperationDependencies;
			expect(yield* invoke({ pluginSlug: SYSTEM_SLUG })).toBe("ok");
			expect(yield* fake.captured).toEqual([
				expect.objectContaining({
					subject: {
						type: "user",
						userId: USER_ONE,
						accountGeneration: { userId: USER_ONE, token: "test-account-generation" },
					},
				}),
			]);
			expect(yield* fake.events).toEqual(["dispatch"]);
		}),
	);
});

layer(
	makeLayer({ accessClass: "demo", currentUserId: USER_ONE, available: [systemUserOperation] }),
)((test) => {
	test.effect("dispatches a demo-accessible system user operation for demo credentials", () =>
		Effect.gen(function* () {
			const fake = yield* FakeOperationDependencies;
			expect(yield* invoke({ pluginSlug: SYSTEM_SLUG })).toBe("ok");
			expect(yield* fake.events).toEqual(["dispatch"]);
		}),
	);
});

layer(
	makeLayer({
		accessClass: "demo",
		currentUserId: USER_ONE,
		available: [{ ...systemUserOperation, demoAccess: "protected" }],
	}),
)((test) => {
	test.effect("rejects a protected system user operation for demo credentials", () =>
		Effect.gen(function* () {
			const fake = yield* FakeOperationDependencies;
			expectError(yield* Effect.exit(invoke({ pluginSlug: SYSTEM_SLUG })), DemoOperationProtected);
			expect(yield* fake.events).toEqual([]);
		}),
	);
});

const privateUserOperation = (demoAccess: "allowed" | "protected") =>
	({
		demoAccess,
		auth: "user",
		scope: "user",
		ownerId: USER_ONE,
		pluginSlug: PRIVATE_SLUG,
		installationId: "install-private-user-1",
	}) satisfies AvailableOperation;

layer(makeLayer({ accessClass: "demo", currentUserId: USER_ONE }))((test) => {
	test.effect(
		"rejects private user operations for demo credentials regardless of the manifest",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				yield* Effect.forEach(["allowed", "protected"] as const, (demoAccess) =>
					Effect.gen(function* () {
						yield* fake.offerOperations([privateUserOperation(demoAccess)]);
						expectError(
							yield* Effect.exit(invoke({ pluginSlug: PRIVATE_SLUG })),
							DemoOperationProtected,
						);
						expect(yield* fake.events).toEqual([]);
					}),
				);
			}),
	);
});

layer(
	makeLayer({
		accessClass: "demo",
		currentUserId: USER_ONE,
		available: [systemIntegrationOperation],
		integration: makeIntegration({
			userId: USER_ONE,
			pluginInstallationId: "install-fixture-user-1",
		}),
	}),
)((test) => {
	test.effect("preserves integration operation access for demo credentials", () =>
		Effect.gen(function* () {
			const fake = yield* FakeOperationDependencies;
			expect(yield* invoke({ pluginSlug: SYSTEM_SLUG, payload: { integrationId: "int-1" } })).toBe(
				"ok",
			);
			expect(yield* fake.events).toEqual(["dispatch"]);
		}),
	);
});

layer(
	makeLayer({
		available: [systemIntegrationOperation],
		integration: makeIntegration({
			userId: USER_ONE,
			pluginInstallationId: "install-fixture-user-1",
		}),
	}),
)((test) => {
	test.effect(
		"dispatches an integration operation declared by the integration's own installation",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				expect(
					yield* invoke({ pluginSlug: SYSTEM_SLUG, payload: { integrationId: "int-1" } }),
				).toBe("ok");
				expect(yield* fake.captured).toEqual([
					expect.objectContaining({
						subject: {
							type: "user",
							userId: USER_ONE,
							integrationId: "int-1",
							accountGeneration: { userId: USER_ONE, token: "test-account-generation" },
						},
					}),
				]);
			}),
	);
});

layer(
	makeLayer({
		available: [systemIntegrationOperation],
		integration: makeIntegration({
			lot: "sink",
			userId: USER_ONE,
			pluginInstallationId: "install-fixture-user-1",
		}),
	}),
)((test) => {
	test.effect("requires the webhook capability for a sink integration operation", () =>
		Effect.gen(function* () {
			const fake = yield* FakeOperationDependencies;
			expectError(
				yield* Effect.exit(
					invoke({ pluginSlug: SYSTEM_SLUG, payload: { integrationId: "int-1" } }),
				),
				PluginNotFoundError,
			);
			expect(
				yield* invoke({ pluginSlug: SYSTEM_SLUG, payload: { webhookToken: "webhook-token-1" } }),
			).toBe("ok");
			expect(yield* fake.events).toEqual(["dispatch"]);
		}),
	);
});

layer(
	makeLayer({
		available: [systemIntegrationOperation],
		integration: makeIntegration({
			userId: USER_ONE,
			pluginInstallationId: "install-other-user-1",
		}),
	}),
)((test) => {
	test.effect("rejects an integration from another installation owned by the same user", () =>
		Effect.gen(function* () {
			const fake = yield* FakeOperationDependencies;
			expectError(
				yield* Effect.exit(
					invoke({ pluginSlug: SYSTEM_SLUG, payload: { integrationId: "int-1" } }),
				),
				PluginNotFoundError,
			);
			expect(yield* fake.captured).toEqual([]);
		}),
	);
});

layer(
	makeLayer({
		currentUserId: USER_ONE,
		available: [systemIntegrationOperation],
		integration: makeIntegration({
			userId: USER_ONE,
			pluginInstallationId: "install-other-user-1",
		}),
	}),
)((test) => {
	test.effect(
		"rejects an integration from another installation owned by the same authenticated user",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				expectError(
					yield* Effect.exit(
						invoke({ pluginSlug: SYSTEM_SLUG, payload: { integrationId: "int-1" } }),
					),
					PluginNotFoundError,
				);
				expect(yield* fake.captured).toEqual([]);
			}),
	);
});

layer(
	makeLayer({
		currentUserId: USER_TWO,
		integration: makeIntegration({
			userId: USER_ONE,
			pluginInstallationId: "install-fixture-user-1",
		}),
		available: [
			systemIntegrationOperation,
			{ ...systemIntegrationOperation, ownerId: USER_TWO, installationId: "install-user-2" },
		],
	}),
)((test) => {
	test.effect("rejects an integration owned by another user's installation", () =>
		Effect.gen(function* () {
			const fake = yield* FakeOperationDependencies;
			expectError(
				yield* Effect.exit(
					invoke({ pluginSlug: SYSTEM_SLUG, payload: { integrationId: "int-1" } }),
				),
				PluginNotFoundError,
			);
			expect(yield* fake.captured).toEqual([]);
		}),
	);
});

layer(
	makeLayer({
		available: [privateIntegrationOperation],
		integration: makeIntegration({
			userId: USER_ONE,
			pluginInstallationId: "install-private-user-1",
		}),
	}),
)((test) => {
	test.effect("dispatches a private integration operation for its owner's integration", () =>
		Effect.gen(function* () {
			const fake = yield* FakeOperationDependencies;
			expect(yield* invoke({ pluginSlug: PRIVATE_SLUG, payload: { integrationId: "int-1" } })).toBe(
				"ok",
			);
			expect(yield* fake.captured).toEqual([
				expect.objectContaining({
					scriptId: "install-private-user-1-script",
					subject: {
						type: "user",
						userId: USER_ONE,
						integrationId: "int-1",
						accountGeneration: { userId: USER_ONE, token: "test-account-generation" },
					},
				}),
			]);
		}),
	);
});

layer(
	makeLayer({
		available: [privateIntegrationOperation],
		integration: makeIntegration({
			userId: USER_TWO,
			pluginInstallationId: "install-private-user-2",
		}),
	}),
)((test) => {
	test.effect("rejects a foreign integration for a private integration operation", () =>
		Effect.gen(function* () {
			const fake = yield* FakeOperationDependencies;
			expectError(
				yield* Effect.exit(
					invoke({ pluginSlug: PRIVATE_SLUG, payload: { integrationId: "int-1" } }),
				),
				PluginNotFoundError,
			);
			expect(yield* fake.captured).toEqual([]);
		}),
	);
});

layer(makeLayer({ currentUserId: USER_ONE, available: [systemIntegrationOperation] }))((test) => {
	test.effect("rejects an authenticated integration operation without a scope payload", () =>
		Effect.gen(function* () {
			expectError(yield* Effect.exit(invoke({ pluginSlug: SYSTEM_SLUG })), PluginRequestError);
		}),
	);
});

layer(makeLayer({ currentUserId: USER_ONE, available: [systemIntegrationOperation] }))((test) => {
	test.effect("rejects integration operations for a missing or disabled integration", () =>
		Effect.gen(function* () {
			const fake = yield* FakeOperationDependencies;
			yield* Effect.forEach(
				[
					null,
					makeIntegration({
						userId: USER_ONE,
						isDisabled: true,
						pluginInstallationId: "install-fixture-user-1",
					}),
				] as const,
				(integration) =>
					Effect.gen(function* () {
						yield* fake.useIntegration(integration);
						expectError(
							yield* Effect.exit(
								invoke({ pluginSlug: SYSTEM_SLUG, payload: { integrationId: "int-1" } }),
							),
							PluginNotFoundError,
						);
					}),
			);
		}),
	);
});

layer(makeLayer({ available: [systemUserOperation] }))((test) => {
	test.effect("rejects user operations without an authenticated session", () =>
		Effect.gen(function* () {
			expectError(yield* Effect.exit(invoke({ pluginSlug: SYSTEM_SLUG })), AuthUnauthorized);
		}),
	);
});

layer(makeLayer({ available: [systemIntegrationOperation] }))((test) => {
	test.effect("rejects an unauthenticated call that carries no integration scope", () =>
		Effect.gen(function* () {
			expectError(yield* Effect.exit(invoke({ pluginSlug: SYSTEM_SLUG })), AuthUnauthorized);
		}),
	);
});

layer(
	makeLayer({
		currentUserId: USER_ONE,
		sandboxError: "operation failed",
		available: [systemUserOperation],
	}),
)((test) => {
	test.effect("propagates sandbox failures from operation scripts", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(invoke({ pluginSlug: SYSTEM_SLUG }));
			assert(Exit.isFailure(exit));
			expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toEqual(
				new PluginInvocationError({
					reason: {
						code: "runtime-failed",
						diagnostics: [
							{
								phase: "execute",
								severity: "error",
								message: "operation failed",
								code: "sandbox-runtime-error",
							},
						],
					},
				}),
			);
		}),
	);
});

layer(
	makeLayer({
		currentUserId: USER_ONE,
		sandboxValue: new Date(0),
		available: [systemUserOperation],
	}),
)((test) => {
	test.effect("rejects non-JSON operation results as runtime failures", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(invoke({ pluginSlug: SYSTEM_SLUG }));
			assert(Exit.isFailure(exit));
			expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toEqual(
				new PluginInvocationError({
					reason: {
						code: "runtime-failed",
						diagnostics: [
							{
								phase: "output",
								severity: "error",
								code: "sandbox-runtime-error",
								message: "Sandbox operation result must be JSON",
							},
						],
					},
				}),
			);
		}),
	);
});
