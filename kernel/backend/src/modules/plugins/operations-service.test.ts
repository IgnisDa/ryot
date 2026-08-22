import { expect, it } from "@effect/vitest";
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
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { Headers } from "effect/unstable/http";
import { assert } from "vitest";

import { databaseLayer } from "#lib/test-utils/effect";
import { AuthService } from "#modules/auth/service";
import { IntegrationOperationScopeResolverLive } from "#modules/integrations/operation-scope-resolver-live";
import type { IntegrationRecord } from "#modules/integrations/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
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
	source: "source",
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
		capabilities: [],
		kind: "operation" as const,
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
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
		isDisabled: false,
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
	// oxlint-disable-next-line no-unsafe-type-assertion -- the scope resolver only reads these fields
	({
		userId: input.userId,
		lot: input.lot ?? "push",
		id: IntegrationId.make("int-1"),
		isDisabled: input.isDisabled ?? false,
		pluginInstallationId: input.pluginInstallationId,
	}) as unknown as IntegrationRecord;

const makeLayer = (input: {
	events?: string[];
	sandboxError?: string;
	sandboxValue?: unknown;
	currentUserId?: UserId;
	accessClass?: AccessClass;
	captured?: Array<unknown>;
	activeSourceHash?: string;
	integration?: IntegrationRecord | null;
	available?: ReadonlyArray<AvailableOperation>;
}) => {
	const integrationsRepository = Layer.mock(IntegrationsRepository)({
		getByIdAnyUser: () => Effect.succeed(input.integration ?? null),
		getByWebhookToken: () => Effect.succeed(input.integration ?? null),
	});
	const integrationScopeResolver = IntegrationOperationScopeResolverLive.pipe(
		Layer.provide(Layer.mergeAll(databaseLayer, integrationsRepository)),
	);
	return Layer.mergeAll(
		databaseLayer,
		OperationsService.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					databaseLayer,
					integrationScopeResolver,
					Layer.mock(PluginRepository)({
						lockIngestion: () => Effect.sync(() => input.events?.push("lock")),
						isActiveRevision: ({ sourceHash }) =>
							Effect.sync(() => {
								input.events?.push("revision");
								return sourceHash === (input.activeSourceHash ?? SOURCE_HASH);
							}),
					}),
					Layer.mock(AuthService)({
						// oxlint-disable-next-line no-unsafe-type-assertion -- the better-auth client is never touched by these tests
						auth: {} as AuthService["Service"]["auth"],
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
											preferences: { language: null, allowNsfw: false, disableIntegrations: false },
										},
									})
								: Effect.fail(
										new AuthUnauthorized({ reason: { code: "authentication-required" } }),
									),
					}),
					Layer.mock(PluginRuntimeResolver)({
						findOperationAvailableToUser: ({ userId, pluginSlug, operationSlug }) => {
							const match = (input.available ?? []).find(
								(candidate) =>
									candidate.ownerId === userId &&
									candidate.pluginSlug === pluginSlug &&
									operationSlug === OPERATION_SLUG,
							);
							return Effect.succeed(match ? resolvedOperation(match) : null);
						},
					}),
					Layer.mock(SandboxExecutionService)({
						executeScript: (runInput) =>
							Effect.sync(() => {
								input.events?.push("dispatch");
								input.captured?.push(runInput);
								return {
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
								};
							}),
					}),
				),
			),
		),
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

it.effect("returns NotFound for a plugin absent from every registry the caller owns", () =>
	Effect.gen(function* () {
		expectError(yield* Effect.exit(invoke({ pluginSlug: "missing" })), PluginNotFoundError);
	}).pipe(Effect.provide(makeLayer({ currentUserId: USER_ONE, available: [systemUserOperation] }))),
);

it.effect("returns NotFound for an unknown operation", () =>
	Effect.gen(function* () {
		expectError(
			yield* Effect.exit(invoke({ pluginSlug: SYSTEM_SLUG, operationSlug: "missing" })),
			PluginNotFoundError,
		);
	}).pipe(Effect.provide(makeLayer({ currentUserId: USER_ONE, available: [systemUserOperation] }))),
);

it.effect("rejects a plugin operation when its active source revision changed", () => {
	const events: string[] = [];
	const captured: Array<unknown> = [];
	return Effect.gen(function* () {
		expectError(
			yield* Effect.exit(invoke({ pluginSlug: SYSTEM_SLUG, sourceHash: SOURCE_HASH })),
			PluginConflictError,
		);
		expect(captured).toEqual([]);
		expect(events).toEqual(["lock", "revision"]);
	}).pipe(
		Effect.provide(
			makeLayer({
				events,
				captured,
				currentUserId: USER_ONE,
				available: [systemUserOperation],
				activeSourceHash: "next-source-hash",
			}),
		),
	);
});

it.effect("returns NotFound for a slug that exists only in another user's registry", () =>
	Effect.gen(function* () {
		expectError(yield* Effect.exit(invoke({ pluginSlug: PRIVATE_SLUG })), PluginNotFoundError);
	}).pipe(
		Effect.provide(
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
		),
	),
);

it.effect("dispatches a private operation with the owning user's subject", () => {
	const captured: Array<unknown> = [];
	return Effect.gen(function* () {
		expect(yield* invoke({ pluginSlug: PRIVATE_SLUG })).toBe("ok");
		expect(captured).toEqual([
			expect.objectContaining({
				scriptId: "install-private-user-1-script",
				subject: { type: "user", userId: USER_ONE },
			}),
		]);
	}).pipe(
		Effect.provide(
			makeLayer({
				captured,
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
		),
	);
});

it.effect("preserves user operation access for standard credentials", () => {
	const events: string[] = [];
	const captured: Array<unknown> = [];
	return Effect.gen(function* () {
		expect(yield* invoke({ pluginSlug: SYSTEM_SLUG })).toBe("ok");
		expect(captured).toEqual([
			expect.objectContaining({ subject: { type: "user", userId: USER_ONE } }),
		]);
		expect(events).toEqual(["dispatch"]);
	}).pipe(
		Effect.provide(
			makeLayer({ events, captured, currentUserId: USER_ONE, available: [systemUserOperation] }),
		),
	);
});

it.effect("dispatches a demo-accessible system user operation for demo credentials", () => {
	const events: string[] = [];
	return Effect.gen(function* () {
		expect(yield* invoke({ pluginSlug: SYSTEM_SLUG })).toBe("ok");
		expect(events).toEqual(["dispatch"]);
	}).pipe(
		Effect.provide(
			makeLayer({
				events,
				accessClass: "demo",
				currentUserId: USER_ONE,
				available: [systemUserOperation],
			}),
		),
	);
});

it.effect("rejects a protected system user operation for demo credentials", () => {
	const events: string[] = [];
	return Effect.gen(function* () {
		expectError(yield* Effect.exit(invoke({ pluginSlug: SYSTEM_SLUG })), DemoOperationProtected);
		expect(events).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				events,
				accessClass: "demo",
				currentUserId: USER_ONE,
				available: [{ ...systemUserOperation, demoAccess: "protected" }],
			}),
		),
	);
});

it.effect("rejects private user operations for demo credentials regardless of the manifest", () =>
	Effect.forEach(["allowed", "protected"] as const, (demoAccess) => {
		const events: string[] = [];
		return Effect.gen(function* () {
			expectError(yield* Effect.exit(invoke({ pluginSlug: PRIVATE_SLUG })), DemoOperationProtected);
			expect(events).toEqual([]);
		}).pipe(
			Effect.provide(
				makeLayer({
					events,
					accessClass: "demo",
					currentUserId: USER_ONE,
					available: [
						{
							demoAccess,
							auth: "user",
							scope: "user",
							ownerId: USER_ONE,
							pluginSlug: PRIVATE_SLUG,
							installationId: "install-private-user-1",
						},
					],
				}),
			),
		);
	}),
);

it.effect("preserves integration operation access for demo credentials", () => {
	const events: string[] = [];
	return Effect.gen(function* () {
		expect(yield* invoke({ pluginSlug: SYSTEM_SLUG, payload: { integrationId: "int-1" } })).toBe(
			"ok",
		);
		expect(events).toEqual(["dispatch"]);
	}).pipe(
		Effect.provide(
			makeLayer({
				events,
				accessClass: "demo",
				currentUserId: USER_ONE,
				available: [systemIntegrationOperation],
				integration: makeIntegration({
					userId: USER_ONE,
					pluginInstallationId: "install-fixture-user-1",
				}),
			}),
		),
	);
});

it.effect(
	"dispatches an integration operation declared by the integration's own installation",
	() => {
		const captured: Array<unknown> = [];
		return Effect.gen(function* () {
			expect(yield* invoke({ pluginSlug: SYSTEM_SLUG, payload: { integrationId: "int-1" } })).toBe(
				"ok",
			);
			expect(captured).toEqual([
				expect.objectContaining({
					subject: { type: "user", userId: USER_ONE, integrationId: "int-1" },
				}),
			]);
		}).pipe(
			Effect.provide(
				makeLayer({
					captured,
					available: [systemIntegrationOperation],
					integration: makeIntegration({
						userId: USER_ONE,
						pluginInstallationId: "install-fixture-user-1",
					}),
				}),
			),
		);
	},
);

it.effect("requires the webhook capability for a sink integration operation", () => {
	const events: string[] = [];
	return Effect.gen(function* () {
		expectError(
			yield* Effect.exit(invoke({ pluginSlug: SYSTEM_SLUG, payload: { integrationId: "int-1" } })),
			PluginNotFoundError,
		);
		expect(
			yield* invoke({ pluginSlug: SYSTEM_SLUG, payload: { webhookToken: "webhook-token-1" } }),
		).toBe("ok");
		expect(events).toEqual(["dispatch"]);
	}).pipe(
		Effect.provide(
			makeLayer({
				events,
				available: [systemIntegrationOperation],
				integration: makeIntegration({
					lot: "sink",
					userId: USER_ONE,
					pluginInstallationId: "install-fixture-user-1",
				}),
			}),
		),
	);
});

it.effect("rejects an integration from another installation owned by the same user", () => {
	const captured: Array<unknown> = [];
	return Effect.gen(function* () {
		expectError(
			yield* Effect.exit(invoke({ pluginSlug: SYSTEM_SLUG, payload: { integrationId: "int-1" } })),
			PluginNotFoundError,
		);
		expect(captured).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				captured,
				available: [systemIntegrationOperation],
				integration: makeIntegration({
					userId: USER_ONE,
					pluginInstallationId: "install-other-user-1",
				}),
			}),
		),
	);
});

it.effect(
	"rejects an integration from another installation owned by the same authenticated user",
	() => {
		const captured: Array<unknown> = [];
		return Effect.gen(function* () {
			expectError(
				yield* Effect.exit(
					invoke({ pluginSlug: SYSTEM_SLUG, payload: { integrationId: "int-1" } }),
				),
				PluginNotFoundError,
			);
			expect(captured).toEqual([]);
		}).pipe(
			Effect.provide(
				makeLayer({
					captured,
					currentUserId: USER_ONE,
					available: [systemIntegrationOperation],
					integration: makeIntegration({
						userId: USER_ONE,
						pluginInstallationId: "install-other-user-1",
					}),
				}),
			),
		);
	},
);

it.effect("rejects an integration owned by another user's installation", () => {
	const captured: Array<unknown> = [];
	return Effect.gen(function* () {
		expectError(
			yield* Effect.exit(invoke({ pluginSlug: SYSTEM_SLUG, payload: { integrationId: "int-1" } })),
			PluginNotFoundError,
		);
		expect(captured).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				captured,
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
		),
	);
});

it.effect("dispatches a private integration operation for its owner's integration", () => {
	const captured: Array<unknown> = [];
	return Effect.gen(function* () {
		expect(yield* invoke({ pluginSlug: PRIVATE_SLUG, payload: { integrationId: "int-1" } })).toBe(
			"ok",
		);
		expect(captured).toEqual([
			expect.objectContaining({
				scriptId: "install-private-user-1-script",
				subject: { type: "user", userId: USER_ONE, integrationId: "int-1" },
			}),
		]);
	}).pipe(
		Effect.provide(
			makeLayer({
				captured,
				available: [privateIntegrationOperation],
				integration: makeIntegration({
					userId: USER_ONE,
					pluginInstallationId: "install-private-user-1",
				}),
			}),
		),
	);
});

it.effect("rejects a foreign integration for a private integration operation", () => {
	const captured: Array<unknown> = [];
	return Effect.gen(function* () {
		expectError(
			yield* Effect.exit(invoke({ pluginSlug: PRIVATE_SLUG, payload: { integrationId: "int-1" } })),
			PluginNotFoundError,
		);
		expect(captured).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				captured,
				available: [privateIntegrationOperation],
				integration: makeIntegration({
					userId: USER_TWO,
					pluginInstallationId: "install-private-user-2",
				}),
			}),
		),
	);
});

it.effect("rejects an authenticated integration operation without a scope payload", () =>
	Effect.gen(function* () {
		expectError(yield* Effect.exit(invoke({ pluginSlug: SYSTEM_SLUG })), PluginRequestError);
	}).pipe(
		Effect.provide(makeLayer({ currentUserId: USER_ONE, available: [systemIntegrationOperation] })),
	),
);

it.effect("rejects integration operations for a missing or disabled integration", () =>
	Effect.forEach(
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
				expectError(
					yield* Effect.exit(
						invoke({ pluginSlug: SYSTEM_SLUG, payload: { integrationId: "int-1" } }),
					),
					PluginNotFoundError,
				);
			}).pipe(
				Effect.provide(
					makeLayer({
						integration,
						currentUserId: USER_ONE,
						available: [systemIntegrationOperation],
					}),
				),
			),
	),
);

it.effect("rejects user operations without an authenticated session", () =>
	Effect.gen(function* () {
		expectError(yield* Effect.exit(invoke({ pluginSlug: SYSTEM_SLUG })), AuthUnauthorized);
	}).pipe(Effect.provide(makeLayer({ available: [systemUserOperation] }))),
);

it.effect("rejects an unauthenticated call that carries no integration scope", () =>
	Effect.gen(function* () {
		expectError(yield* Effect.exit(invoke({ pluginSlug: SYSTEM_SLUG })), AuthUnauthorized);
	}).pipe(Effect.provide(makeLayer({ available: [systemIntegrationOperation] }))),
);

it.effect("propagates sandbox failures from operation scripts", () =>
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
	}).pipe(
		Effect.provide(
			makeLayer({
				currentUserId: USER_ONE,
				sandboxError: "operation failed",
				available: [systemUserOperation],
			}),
		),
	),
);

it.effect("rejects non-JSON operation results as runtime failures", () =>
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
	}).pipe(
		Effect.provide(
			makeLayer({
				currentUserId: USER_ONE,
				sandboxValue: new Date(0),
				available: [systemUserOperation],
			}),
		),
	),
);
