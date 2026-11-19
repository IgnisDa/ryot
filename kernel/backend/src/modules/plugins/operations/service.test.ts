import { expect } from "bun:test";

import { DemoOperationProtected, WriteAccessDenied } from "@ryot-app/contract/auth-middleware";
import type { ChangeSet } from "@ryot-app/contract/modules/changes/change-set";
import { EntityStale } from "@ryot-app/contract/modules/entities/schemas";
import { EntityUserDataBadRequest } from "@ryot-app/contract/modules/entity-user-data/schemas";
import { EventBadRequest } from "@ryot-app/contract/modules/events/schemas";
import type { PageOperationAuthority } from "@ryot-app/contract/modules/pages/identity";
import type { PluginOperation } from "@ryot-app/contract/modules/plugins/manifest";
import {
	PluginConflictError,
	PluginInvocationError,
	PluginNotFoundError,
	PluginOperationRejected,
	PluginRequestError,
} from "@ryot-app/contract/modules/plugins/schemas";
import type { AccessClass, WriteAccess } from "@ryot-app/contract/oauth";
import {
	EntityId,
	EventId,
	IntegrationId,
	PluginConfigRevisionId,
	PluginId,
	PluginPackageId,
	PluginRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { entitlementRequired, type Entitlements } from "@ryot-app/contract/schema/entitlement";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { emptySandboxExecutionMetadata, fixtureManifest } from "@ryot-app/contract/testing";
import { AuthUnauthorized } from "@ryot-app/instance-contract/admin-auth";
import { scriptsDigestOf } from "@ryot-app/sandbox/host/executor.test-support";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { objectContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Cause, Context, Effect, Exit, Layer, Option, Ref } from "effect";
import { Headers } from "effect/http";

import { AuthService } from "#modules/accounts/auth/service";
import type { CommitReceipt } from "#modules/changes/receipts";
import { ScriptChangesLayer } from "#modules/changes/script-changes";
import { type ChangeSetFailure, ChangeSets } from "#modules/changes/service";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { IntegrationOperationScopeResolverLive } from "#modules/integrations/operation-scope-resolver-live";
import type { IntegrationRecord } from "#modules/integrations/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { makeIntegration as integrationRecord } from "#modules/integrations/test-support";
import { mutationAdmissionTestLayer } from "#modules/mutations/admission.test-support";
import { PageAuthoringRepository } from "#modules/pages/authoring/repository";
import { PluginUserSettingsPatchError } from "#modules/plugins/preferences/user-settings-writer";
import { ScriptCalls } from "#modules/scripts/executions/calls";
import type { SandboxExecutionResult } from "#modules/scripts/executions/result";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { entitlementsLayer } from "#platform/entitlements.test-support";
import * as tables from "#schema/tables/combined";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { PluginRuntimeResolver } from "../catalog/runtime-resolver";
import type { PluginInstallationHydratedState } from "../installations/repository";
import { PluginRepository } from "../packages/repository";
import { OperationsService } from "./service";

const kernelWriter = () => Effect.die("Operations commit through ScriptChanges");

const SYSTEM_ID = PluginId.make("fixture-plugin-id");
const PRIVATE_ID = PluginId.make("private-plugin-id");
const DRIVER_REF = "operation.fixture";
const OPERATION_SLUG = "resolve.fixture";
const SOURCE_HASH = "source-hash";

const USER_ONE = UserId.make("user-1");
const USER_TWO = UserId.make("user-2");
const SYSTEM_PACKAGE_ID = PluginPackageId.make("test/fixture");
const PRIVATE_PACKAGE_ID = PluginPackageId.make("test/private-fixture");

const privateInstallation = (
	overrides: Partial<PluginInstallationHydratedState> = {},
): PluginInstallationHydratedState => ({
	config: {},
	sortOrder: 0,
	isHidden: false,
	userId: USER_ONE,
	userSettings: {},
	healthReason: null,
	isInitialized: true,
	uninstalledAt: null,
	pluginScope: "user",
	homeSavedView: null,
	pluginId: PRIVATE_ID,
	health: "incompatible",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	activeConfigRevisionId: null,
	id: "install-private-user-1",
	packageId: PRIVATE_PACKAGE_ID,
	incompatibilityReason: "package-identity-conflict",
	...overrides,
});

type AvailableOperation = (
	| Pick<Extract<PluginOperation, { auth: "integration" }>, "auth">
	| Pick<Extract<PluginOperation, { auth: "user" }>, "auth" | "demoAccess" | "entitlement">
) & {
	readonly writes?: true;
	readonly ownerId: UserId;
	readonly scriptId?: string;
	readonly pluginId: PluginId;
	readonly installationId: string;
	readonly scope: "user" | "system";
	readonly packageId?: PluginPackageId;
};

const availablePackageId = (available: AvailableOperation) =>
	available.packageId ?? (available.scope === "system" ? SYSTEM_PACKAGE_ID : PRIVATE_PACKAGE_ID);

const makeActiveScript = (id: string, capabilities: ReadonlyArray<string>) => ({
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
		capabilities,
		kind: "operation" as const,
	},
});

const resolvedOperation = (available: AvailableOperation) => ({
	script: makeActiveScript(available.scriptId ?? `${available.installationId}-script`, []),
	plugin: {
		isHidden: false,
		clientImports: [],
		healthReason: null,
		scope: available.scope,
		id: available.pluginId,
		contentHash: SOURCE_HASH,
		health: "ready" as const,
		incompatibilityReason: null,
		pluginRevisionId: "fixture-revision",
		pluginConfigRevisionId: "fixture-config",
		installationId: available.installationId,
		packageId: availablePackageId(available),
		compiledHashes: { [DRIVER_REF]: "fixture-compiled" },
		manifest: fixtureManifest(availablePackageId(available)),
		ownerUserId: available.scope === "user" ? available.ownerId : null,
	},
	operation:
		available.auth === "user"
			? {
					auth: available.auth,
					slug: OPERATION_SLUG,
					scriptSlug: DRIVER_REF,
					input: { type: "object" },
					output: { type: "string" },
					title: "Fixture operation",
					demoAccess: available.demoAccess,
					...(available.entitlement === undefined ? {} : { entitlement: available.entitlement }),
					description: "Fixture operation",
					hints: { idempotent: true, destructive: false, readOnly: available.writes !== true },
				}
			: {
					auth: available.auth,
					slug: OPERATION_SLUG,
					scriptSlug: DRIVER_REF,
					input: { type: "object" },
					output: { type: "string" },
					title: "Fixture operation",
					description: "Fixture operation",
					hints: { readOnly: true, idempotent: true, destructive: false },
				},
});

const makeIntegration = (input: {
	userId: UserId;
	isDisabled?: boolean;
	pluginInstallationId: string;
	lot?: IntegrationRecord["lot"];
}) =>
	integrationRecord({
		userId: input.userId,
		lot: input.lot ?? "push",
		id: IntegrationId.make("int-1"),
		isDisabled: input.isDisabled ?? false,
		pluginInstallationId: input.pluginInstallationId,
	});

class OperationFakeState extends Context.Service<
	OperationFakeState,
	{
		readonly availableLookups: Ref.Ref<number>;
		readonly events: Ref.Ref<ReadonlyArray<string>>;
		readonly commits: Ref.Ref<ReadonlyArray<unknown>>;
		readonly captured: Ref.Ref<ReadonlyArray<unknown>>;
		readonly integration: Ref.Ref<null | IntegrationRecord>;
		readonly packageLookups: Ref.Ref<ReadonlyArray<string>>;
		readonly available: Ref.Ref<ReadonlyArray<AvailableOperation>>;
		readonly privateInstallation: Ref.Ref<null | PluginInstallationHydratedState>;
	}
>()("@ryot-app/kernel-backend/modules/plugins/operations/service.test/OperationFakeState") {}

class FakeOperationDependencies extends Context.Service<
	FakeOperationDependencies,
	{
		readonly availableLookups: Effect.Effect<number>;
		readonly events: Effect.Effect<ReadonlyArray<string>>;
		readonly commits: Effect.Effect<ReadonlyArray<unknown>>;
		readonly captured: Effect.Effect<ReadonlyArray<unknown>>;
		readonly packageLookups: Effect.Effect<ReadonlyArray<string>>;
		readonly useIntegration: (integration: null | IntegrationRecord) => Effect.Effect<void>;
		readonly offerOperations: (available: ReadonlyArray<AvailableOperation>) => Effect.Effect<void>;
	}
>()("@ryot-app/kernel-backend/modules/plugins/operations/service.test/FakeOperationDependencies") {}

const makeLayer = (input: {
	sandboxError?: string;
	sandboxValue?: unknown;
	currentUserId?: UserId;
	accessClass?: AccessClass;
	writeAccess?: WriteAccess;
	activeSourceHash?: string;
	entitlements?: Entitlements;
	integration?: null | IntegrationRecord;
	commitFailure?: typeof ChangeSetFailure.Type;
	available?: ReadonlyArray<AvailableOperation>;
	database?: ReturnType<typeof isolatedDatabaseLayer>;
	privateInstallation?: null | PluginInstallationHydratedState;
	sandboxErrorData?: NonNullable<SandboxExecutionResult["error"]>["data"];
}) => {
	const sandboxResult = {
		logs: [],
		status: "completed" as const,
		value: "sandboxValue" in input ? input.sandboxValue : { output: "ok" },
		error: input.sandboxError
			? {
					phase: "execute" as const,
					message: input.sandboxError,
					...(input.sandboxErrorData === undefined ? {} : { data: input.sandboxErrorData }),
					kind: "script-failure" as const,
				}
			: null,
	};
	const stateLayer = Layer.effect(
		OperationFakeState,
		Effect.gen(function* () {
			return {
				availableLookups: yield* Ref.make(0),
				available: yield* Ref.make(input.available ?? []),
				events: yield* Ref.make<ReadonlyArray<string>>([]),
				commits: yield* Ref.make<ReadonlyArray<unknown>>([]),
				captured: yield* Ref.make<ReadonlyArray<unknown>>([]),
				integration: yield* Ref.make(input.integration ?? null),
				packageLookups: yield* Ref.make<ReadonlyArray<string>>([]),
				privateInstallation: yield* Ref.make(input.privateInstallation ?? null),
			};
		}),
	);
	const fakesLayer = Layer.unwrap(
		Effect.map(OperationFakeState, (state) => {
			const recordEvent = (event: string) => Ref.update(state.events, (all) => [...all, event]);
			return Layer.mergeAll(
				Layer.succeed(FakeOperationDependencies, {
					events: Ref.get(state.events),
					commits: Ref.get(state.commits),
					captured: Ref.get(state.captured),
					packageLookups: Ref.get(state.packageLookups),
					availableLookups: Ref.get(state.availableLookups),
					offerOperations: (available) => Ref.set(state.available, available),
					useIntegration: (integration) => Ref.set(state.integration, integration),
				}),
				Layer.mock(IntegrationsRepository)({
					getByIdAnyUser: () => Ref.get(state.integration),
					getByWebhookToken: () => Ref.get(state.integration),
				}),
				Layer.mock(PluginRepository)({
					lockIngestionShared: () => recordEvent("lock"),
					isActiveRevision: ({ contentHash }) =>
						recordEvent("revision").pipe(
							Effect.as(contentHash === (input.activeSourceHash ?? SOURCE_HASH)),
						),
				}),
				Layer.mock(AuthService)({
					handler: () => Promise.reject(new Error("unused")),
					resolveTrustedAccount: (userId) =>
						Effect.succeed({
							authorization: {
								writeAccess: "confirm" as const,
								accessClass: input.accessClass ?? "standard",
							},
							user: {
								id: userId,
								image: null,
								name: "User",
								email: "user@example.com",
								preferences: {
									weekStart: null,
									interfaceLocale: null,
									contentLanguage: null,
									reportingTimeZone: UTC,
									ratingScale: "hundred",
									disableIntegrations: false,
								},
							},
						}),
					resolveRequestCredential: () =>
						input.currentUserId
							? Effect.succeed({
									authorization: {
										userId: input.currentUserId,
										accessClass: input.accessClass ?? "standard",
										writeAccess: input.writeAccess ?? "unattended",
										credential: { kind: "api-key", keyId: "test-key" },
									},
									user: {
										image: null,
										name: "User",
										id: input.currentUserId,
										email: "user@example.com",
										accountUserId: input.currentUserId,
										preferences: {
											weekStart: null,
											interfaceLocale: null,
											contentLanguage: null,
											reportingTimeZone: UTC,
											ratingScale: "hundred",
											disableIntegrations: false,
										},
									},
								})
							: Effect.fail(new AuthUnauthorized({ reason: { code: "authentication-required" } })),
				}),
				Layer.mock(PluginRuntimeResolver)({
					findOperationAvailableToUser: ({ userId, pluginId, operationSlug }) =>
						Ref.update(state.availableLookups, (count) => count + 1).pipe(
							Effect.andThen(
								Effect.map(Ref.get(state.available), (available) => {
									const match = available.find(
										(candidate) =>
											candidate.ownerId === userId &&
											candidate.pluginId === pluginId &&
											operationSlug === OPERATION_SLUG,
									);
									return match ? resolvedOperation(match) : null;
								}),
							),
						),
					resolveUserPackage: (userId, packageId) =>
						Ref.update(state.packageLookups, (reads) => [...reads, `${userId}:${packageId}`]).pipe(
							Effect.andThen(
								Effect.gen(function* () {
									const effective = (yield* Ref.get(state.available)).find(
										(candidate) =>
											candidate.ownerId === userId && availablePackageId(candidate) === packageId,
									);
									if (effective) {
										return { kind: "effective" as const, pluginId: effective.pluginId };
									}
									const installation = yield* Ref.get(state.privateInstallation);
									return installation?.userId === userId &&
										installation.packageId === packageId &&
										installation.incompatibilityReason === "package-identity-conflict"
										? {
												kind: "quarantined" as const,
												pluginId: PluginId.make(installation.pluginId),
											}
										: { kind: "absent" as const };
								}),
							),
						),
				}),
				Layer.succeed(
					SandboxRepository,
					SandboxRepository.of({
						getScript: () => Effect.die("Operation admission only reads verified pins"),
						getSchemaScope: () => Effect.die("Operation admission does not read schema scope"),
						isPluginScript: () => Effect.die("Operation admission requires an exact plugin target"),
						resolveWorkflowCallScript: () =>
							Effect.die("Operations do not resolve child scripts at admission"),
						getScriptPin: (scriptId) =>
							Effect.map(Ref.get(state.available), (available) => {
								const match = available.find(
									(candidate) => resolvedOperation(candidate).script.id === scriptId,
								);
								if (!match) {
									return null;
								}
								const { plugin, script } = resolvedOperation(match);
								return {
									scriptId,
									providerId: null,
									scriptSlug: script.slug,
									metadata: script.metadata,
									contentHash: script.contentHash,
									pluginRevision: {
										id: match.pluginId,
										scope: plugin.scope,
										workflowScripts: {},
										packageId: plugin.packageId,
										ownerId: plugin.ownerUserId,
										userBootstrapScriptSlugs: [],
										configSchema: plugin.manifest.configSchema,
										scriptsDigest: scriptsDigestOf(plugin.compiledHashes),
										revisionId: PluginRevisionId.make(plugin.pluginRevisionId),
										configRevisionId: PluginConfigRevisionId.make(plugin.pluginConfigRevisionId),
									},
								};
							}),
					}),
				),
				Layer.mock(ScriptCalls)({
					run: (runInput) =>
						recordEvent("dispatch").pipe(
							Effect.andThen(Ref.update(state.captured, (all) => [...all, runInput])),
							Effect.as(sandboxResult),
						),
				}),
				ScriptChangesLayer.pipe(
					Layer.provide(
						Layer.effect(
							ChangeSets,
							Effect.map(DatabaseSession, (database) => {
								const inTransaction = <A, E>(effect: Effect.Effect<A, E>) =>
									database
										.transaction(effect)
										.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
								const commitScript = <A>(
									changes: undefined | ChangeSet,
									command: DomainLifecycleCommand,
									receipt: CommitReceipt<A>,
								) =>
									Effect.gen(function* () {
										const stored = yield* inTransaction(receipt.load);
										if (stored !== null) {
											return stored;
										}
										if (changes === undefined) {
											return yield* inTransaction(
												receipt.record({ outcomes: [], committed: { events: [] } }),
											);
										}
										yield* recordEvent("commit");
										yield* Ref.update(state.commits, (all) => [
											...all,
											{
												changes,
												causation: command.causation,
												subject: command.writeContext?.subject,
											},
										]);
										if (input.commitFailure) {
											return yield* input.commitFailure;
										}
										return yield* inTransaction(
											receipt.record({
												outcomes: [],
												committed: {
													events: (changes.events?.creates ?? []).map((create) => ({
														itemIdentity: create.itemIdentity,
														eventId: EventId.make(`event-${create.itemIdentity}`),
													})),
												},
											}),
										);
									});
								return {
									commitScript,
									commit: kernelWriter,
									commitOnce: kernelWriter,
									commitEventsKeyed: kernelWriter,
								};
							}),
						),
					),
				),
			);
		}),
	);
	return OperationsService.layer.pipe(
		Layer.provide(IntegrationOperationScopeResolverLive),
		Layer.provide(entitlementsLayer(input.entitlements ?? ["pro"])),
		Layer.provideMerge(fakesLayer),
		Layer.provideMerge(stateLayer),
		Layer.provideMerge(input.database ?? mutationAdmissionTestLayer),
	);
};

const systemUserOperation = {
	auth: "user",
	scope: "system",
	ownerId: USER_ONE,
	pluginId: SYSTEM_ID,
	demoAccess: "allowed",
	installationId: "install-fixture-user-1",
} satisfies AvailableOperation;

const systemIntegrationOperation = {
	scope: "system",
	ownerId: USER_ONE,
	auth: "integration",
	pluginId: SYSTEM_ID,
	installationId: "install-fixture-user-1",
} satisfies AvailableOperation;

const privateIntegrationOperation = {
	scope: "user",
	ownerId: USER_ONE,
	auth: "integration",
	pluginId: PRIVATE_ID,
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
	payload?: JsonValue;
	contentHash?: string;
	writeConfirmed?: true;
	operationSlug?: string;
	idempotencyKey?: string;
	packageId: PluginPackageId;
	pageAuthority?: PageOperationAuthority;
}) =>
	Effect.flatMap(OperationsService, (service) =>
		service.invoke({
			headers: Headers.empty,
			...(input.writeConfirmed === undefined ? {} : { writeConfirmed: input.writeConfirmed }),
			...(input.pageAuthority === undefined ? {} : { pageAuthority: input.pageAuthority }),
			packageId: input.packageId,
			payload: input.payload ?? {},
			operationSlug: input.operationSlug ?? OPERATION_SLUG,
			...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
			...(input.contentHash === undefined ? {} : { contentHash: input.contentHash }),
		}),
	).pipe(Effect.map(({ output }) => output));

layer(makeLayer({ currentUserId: USER_ONE, available: [systemUserOperation] }))((test) => {
	test.effect(
		"reuses a keyed operation admission identity and cached result",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				const request = {
					payload: { value: "same" },
					packageId: SYSTEM_PACKAGE_ID,
					idempotencyKey: "operation-request-1",
				};
				expect(yield* invoke(request)).toBe("ok");
				expect(yield* invoke(request)).toBe("ok");
				expect(yield* invoke({ ...request, contentHash: SOURCE_HASH })).toBe("ok");
				expect(yield* Effect.flip(invoke({ ...request, contentHash: "stale" }))).toMatchObject({
					_tag: "PluginConflictError",
					reason: { code: "source-revision-stale" },
				});
				expect(yield* fake.captured).toHaveLength(1);
			}),
		testTimeout,
	);
});

layer(makeLayer({ currentUserId: USER_ONE, available: [systemUserOperation] }))((test) => {
	test.effect(
		"derives distinct operation admission identities for distinct keys",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				const request = { payload: { value: "same" }, packageId: SYSTEM_PACKAGE_ID };
				expect(yield* invoke({ ...request, idempotencyKey: "operation-request-1" })).toBe("ok");
				expect(yield* invoke({ ...request, idempotencyKey: "operation-request-2" })).toBe("ok");
				const captured = yield* fake.captured;
				expect(captured).toHaveLength(2);
				expect(captured[0]).not.toEqual(captured[1]);
			}),
		testTimeout,
	);
});

layer(makeLayer({ currentUserId: USER_ONE, available: [systemUserOperation] }))((test) => {
	test.effect(
		"rejects a keyed operation admission identity when its input changes",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				const idempotencyKey = "operation-request-1";
				expect(
					yield* invoke({
						idempotencyKey,
						payload: { value: "first" },
						packageId: SYSTEM_PACKAGE_ID,
					}),
				).toBe("ok");
				assertExitFails(
					yield* Effect.exit(
						invoke({ idempotencyKey, packageId: SYSTEM_PACKAGE_ID, payload: { value: "second" } }),
					),
					new PluginRequestError({
						reason: {
							code: "validation-failed",
							diagnostics: [
								{
									phase: "validate",
									severity: "error",
									code: "operation-idempotency-conflict",
									message: "Operation idempotency key was reused with different input",
								},
							],
						},
					}),
				);
				expect(yield* fake.captured).toHaveLength(1);
			}),
		testTimeout,
	);
});

layer(
	makeLayer({
		currentUserId: USER_ONE,
		available: [
			systemUserOperation,
			{
				...systemUserOperation,
				scope: "user",
				pluginId: PRIVATE_ID,
				packageId: PRIVATE_PACKAGE_ID,
				installationId: "same-name-private",
			},
		],
	}),
)((test) => {
	test.effect(
		"admits same-name targets by exact owner and carries their verified pins without a UI hash",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				expect(yield* invoke({ packageId: PRIVATE_PACKAGE_ID })).toBe("ok");
				expect(yield* invoke({ packageId: SYSTEM_PACKAGE_ID })).toBe("ok");
				expect(yield* fake.events).toEqual(["lock", "dispatch", "lock", "dispatch"]);
				expect(yield* fake.captured).toMatchObject([
					{
						principal: {
							scriptId: "same-name-private-script",
							pluginRevision: {
								scope: "user",
								id: PRIVATE_ID,
								revisionId: "fixture-revision",
								configRevisionId: "fixture-config",
							},
						},
					},
					{
						principal: {
							scriptId: "install-fixture-user-1-script",
							pluginRevision: {
								id: SYSTEM_ID,
								scope: "system",
								revisionId: "fixture-revision",
								configRevisionId: "fixture-config",
							},
						},
					},
				]);
			}),
		testTimeout,
	);
});

layer(makeLayer({ currentUserId: USER_ONE, available: [systemUserOperation] }))((test) => {
	test.effect(
		"returns NotFound for a plugin absent from every registry the caller owns",
		() =>
			Effect.gen(function* () {
				expectError(
					yield* Effect.exit(invoke({ packageId: PluginPackageId.make("test/missing") })),
					PluginNotFoundError,
				);
			}),
		testTimeout,
	);
});

layer(makeLayer({ currentUserId: USER_ONE, available: [systemUserOperation] }))((test) => {
	test.effect(
		"returns NotFound for an unknown operation",
		() =>
			Effect.gen(function* () {
				expectError(
					yield* Effect.exit(invoke({ operationSlug: "missing", packageId: SYSTEM_PACKAGE_ID })),
					PluginNotFoundError,
				);
			}),
		testTimeout,
	);
});

layer(
	makeLayer({
		currentUserId: USER_ONE,
		available: [systemUserOperation],
		activeSourceHash: "next-source-hash",
	}),
)((test) => {
	test.effect(
		"rejects a plugin operation when its active source revision changed",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				expectError(
					yield* Effect.exit(invoke({ contentHash: SOURCE_HASH, packageId: SYSTEM_PACKAGE_ID })),
					PluginConflictError,
				);
				expect(yield* fake.captured).toEqual([]);
				expect(yield* fake.events).toEqual(["lock", "revision"]);
			}),
		testTimeout,
	);
});

layer(
	makeLayer({
		currentUserId: USER_TWO,
		privateInstallation: privateInstallation(),
		available: [
			{
				auth: "user",
				scope: "user",
				ownerId: USER_ONE,
				pluginId: PRIVATE_ID,
				demoAccess: "allowed",
				installationId: "install-private-user-1",
			},
		],
	}),
)((test) => {
	test.effect(
		"returns NotFound for a plugin owned only by another user",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				expectError(
					yield* Effect.exit(invoke({ packageId: PRIVATE_PACKAGE_ID })),
					PluginNotFoundError,
				);
				expect(yield* fake.packageLookups).toEqual([`${USER_TWO}:${PRIVATE_PACKAGE_ID}`]);
				expect(yield* fake.availableLookups).toBe(0);
			}),
		testTimeout,
	);
});

layer(
	makeLayer({
		currentUserId: USER_ONE,
		available: [systemUserOperation],
		privateInstallation: privateInstallation(),
	}),
)((test) => {
	test.effect(
		"reports the stored private package identity for an owned quarantined plugin",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				const exit = yield* Effect.exit(invoke({ packageId: PRIVATE_PACKAGE_ID }));
				assert(Exit.isFailure(exit));
				expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toEqual(
					new PluginConflictError({
						reason: {
							pluginId: PRIVATE_ID,
							packageId: PRIVATE_PACKAGE_ID,
							code: "package-identity-conflict",
						},
					}),
				);
				expect(yield* fake.packageLookups).toEqual([`${USER_ONE}:${PRIVATE_PACKAGE_ID}`]);
				expect(yield* fake.availableLookups).toBe(0);
				expect(yield* fake.events).toEqual(["lock"]);
			}),
		testTimeout,
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
				pluginId: PRIVATE_ID,
				demoAccess: "allowed",
				installationId: "install-private-user-1",
			},
		],
	}),
)((test) => {
	test.effect(
		"dispatches a private operation with the owning user's subject",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				expect(yield* invoke({ packageId: PRIVATE_PACKAGE_ID })).toBe("ok");
				expect(yield* fake.captured).toMatchObject([
					{
						lane: "interactive",
						principal: {
							scriptId: "install-private-user-1-script",
							subject: { type: "user", userId: USER_ONE },
						},
					},
				]);
			}),
		testTimeout,
	);
});

layer(makeLayer({ currentUserId: USER_ONE, available: [systemUserOperation] }))((test) => {
	test.effect(
		"preserves user operation access for standard credentials",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				expect(yield* invoke({ packageId: SYSTEM_PACKAGE_ID })).toBe("ok");
				expect(yield* fake.captured).toMatchObject([
					{ principal: { subject: { type: "user", userId: USER_ONE } } },
				]);
				expect(yield* fake.events).toEqual(["lock", "dispatch"]);
			}),
		testTimeout,
	);
});

layer(
	makeLayer({ accessClass: "demo", currentUserId: USER_ONE, available: [systemUserOperation] }),
)((test) => {
	test.effect(
		"dispatches a demo-accessible system user operation for demo credentials",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				expect(yield* invoke({ packageId: SYSTEM_PACKAGE_ID })).toBe("ok");
				expect(yield* fake.events).toEqual(["lock", "dispatch"]);
			}),
		testTimeout,
	);
});

layer(
	makeLayer({
		accessClass: "demo",
		currentUserId: USER_ONE,
		available: [{ ...systemUserOperation, demoAccess: "protected" }],
	}),
)((test) => {
	test.effect(
		"rejects a protected system user operation for demo credentials",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				expectError(
					yield* Effect.exit(invoke({ packageId: SYSTEM_PACKAGE_ID })),
					DemoOperationProtected,
				);
				expect(yield* fake.events).toEqual(["lock"]);
			}),
		testTimeout,
	);
});

layer(
	makeLayer({
		entitlements: [],
		currentUserId: USER_ONE,
		available: [{ ...systemUserOperation, entitlement: "pro" }],
	}),
)((test) => {
	test.effect(
		"rejects an operation declaring an entitlement the instance lacks",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				expect(yield* Effect.flip(invoke({ packageId: SYSTEM_PACKAGE_ID }))).toEqual(
					entitlementRequired("pro"),
				);
				expect(yield* fake.captured).toEqual([]);
			}),
		testTimeout,
	);
});

layer(
	makeLayer({
		writeAccess: "confirm",
		currentUserId: USER_ONE,
		available: [{ ...systemUserOperation, writes: true }],
	}),
)((test) => {
	test.effect(
		"refuses unconfirmed writes from credentials that cannot write unattended",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				expectError(
					yield* Effect.exit(invoke({ packageId: SYSTEM_PACKAGE_ID })),
					WriteAccessDenied,
				);
				expect(yield* fake.events).toEqual(["lock"]);
				expect(yield* invoke({ writeConfirmed: true, packageId: SYSTEM_PACKAGE_ID })).toBe("ok");
			}),
		testTimeout,
	);
});

const privateUserOperation = (demoAccess: "allowed" | "protected") =>
	({
		demoAccess,
		auth: "user",
		scope: "user",
		ownerId: USER_ONE,
		pluginId: PRIVATE_ID,
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
							yield* Effect.exit(invoke({ packageId: PRIVATE_PACKAGE_ID })),
							DemoOperationProtected,
						);
						expect(yield* fake.events).toEqual(
							demoAccess === "allowed" ? ["lock"] : ["lock", "lock"],
						);
					}),
				);
			}),
		testTimeout,
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
	test.effect(
		"preserves integration operation access for demo credentials",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				expect(
					yield* invoke({ packageId: SYSTEM_PACKAGE_ID, payload: { integrationId: "int-1" } }),
				).toBe("ok");
				expect(yield* fake.events).toEqual(["lock", "dispatch"]);
			}),
		testTimeout,
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
					yield* invoke({ packageId: SYSTEM_PACKAGE_ID, payload: { integrationId: "int-1" } }),
				).toBe("ok");
				expect(yield* fake.captured).toMatchObject([
					{ principal: { subject: { type: "user", userId: USER_ONE, integrationId: "int-1" } } },
				]);
			}),
		testTimeout,
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
	test.effect(
		"requires the webhook capability for a sink integration operation",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				expectError(
					yield* Effect.exit(
						invoke({ packageId: SYSTEM_PACKAGE_ID, payload: { integrationId: "int-1" } }),
					),
					PluginNotFoundError,
				);
				expect(
					yield* invoke({
						packageId: SYSTEM_PACKAGE_ID,
						payload: { webhookToken: "webhook-token-1" },
					}),
				).toBe("ok");
				expect(yield* fake.events).toEqual(["lock", "dispatch"]);
			}),
		testTimeout,
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
	test.effect(
		"rejects an integration from another installation owned by the same user",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				expectError(
					yield* Effect.exit(
						invoke({ packageId: SYSTEM_PACKAGE_ID, payload: { integrationId: "int-1" } }),
					),
					PluginNotFoundError,
				);
				expect(yield* fake.captured).toEqual([]);
			}),
		testTimeout,
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
						invoke({ packageId: SYSTEM_PACKAGE_ID, payload: { integrationId: "int-1" } }),
					),
					PluginNotFoundError,
				);
				expect(yield* fake.captured).toEqual([]);
			}),
		testTimeout,
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
	test.effect(
		"rejects an integration owned by another user's installation",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				expectError(
					yield* Effect.exit(
						invoke({ packageId: SYSTEM_PACKAGE_ID, payload: { integrationId: "int-1" } }),
					),
					PluginNotFoundError,
				);
				expect(yield* fake.captured).toEqual([]);
			}),
		testTimeout,
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
	test.effect(
		"dispatches a private integration operation for its owner's integration",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				expect(
					yield* invoke({ packageId: PRIVATE_PACKAGE_ID, payload: { integrationId: "int-1" } }),
				).toBe("ok");
				expect(yield* fake.captured).toMatchObject([
					{
						principal: {
							scriptId: "install-private-user-1-script",
							subject: { type: "user", userId: USER_ONE, integrationId: "int-1" },
						},
					},
				]);
				expect(yield* fake.packageLookups).toEqual([`${USER_ONE}:${PRIVATE_PACKAGE_ID}`]);
			}),
		testTimeout,
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
	test.effect(
		"rejects a foreign integration for a private integration operation",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				expectError(
					yield* Effect.exit(
						invoke({ packageId: PRIVATE_PACKAGE_ID, payload: { integrationId: "int-1" } }),
					),
					PluginNotFoundError,
				);
				expect(yield* fake.captured).toEqual([]);
			}),
		testTimeout,
	);
});

layer(makeLayer({ currentUserId: USER_ONE, available: [systemIntegrationOperation] }))((test) => {
	test.effect(
		"rejects an authenticated integration operation without a scope payload",
		() =>
			Effect.gen(function* () {
				expectError(
					yield* Effect.exit(invoke({ packageId: SYSTEM_PACKAGE_ID })),
					PluginRequestError,
				);
			}),
		testTimeout,
	);
});

layer(makeLayer({ currentUserId: USER_ONE, available: [systemIntegrationOperation] }))((test) => {
	test.effect(
		"rejects integration operations for a missing or disabled integration",
		() =>
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
									invoke({ packageId: SYSTEM_PACKAGE_ID, payload: { integrationId: "int-1" } }),
								),
								PluginNotFoundError,
							);
						}),
				);
			}),
		testTimeout,
	);
});

layer(makeLayer({ available: [systemUserOperation] }))((test) => {
	test.effect(
		"rejects user operations without an authenticated session",
		() =>
			Effect.gen(function* () {
				expectError(yield* Effect.exit(invoke({ packageId: SYSTEM_PACKAGE_ID })), AuthUnauthorized);
			}),
		testTimeout,
	);
});

layer(makeLayer({ available: [systemIntegrationOperation] }))((test) => {
	test.effect(
		"rejects an unauthenticated call that carries no integration scope",
		() =>
			Effect.gen(function* () {
				expectError(yield* Effect.exit(invoke({ packageId: SYSTEM_PACKAGE_ID })), AuthUnauthorized);
			}),
		testTimeout,
	);
});

layer(
	makeLayer({
		currentUserId: USER_ONE,
		sandboxError: "operation failed",
		available: [systemUserOperation],
	}),
)((test) => {
	test.effect(
		"propagates sandbox failures from operation scripts",
		() =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(invoke({ packageId: SYSTEM_PACKAGE_ID }));
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
		testTimeout,
	);
});

layer(
	makeLayer({
		currentUserId: USER_ONE,
		sandboxValue: new Date(0),
		available: [systemUserOperation],
	}),
)((test) => {
	test.effect(
		"rejects non-JSON operation results as runtime failures",
		() =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(invoke({ packageId: SYSTEM_PACKAGE_ID }));
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
									message: "Sandbox operation result is invalid",
								},
							],
						},
					}),
				);
			}),
		testTimeout,
	);
});

const pageAuthority: PageOperationAuthority = {
	revision: 1,
	authorityRevision: 1,
	pageId: "operation-page",
	definitionHash: "published",
};
const pageDatabase = Layer.effectDiscard(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db.insert(tables.user).values([
				{ name: "One", id: USER_ONE, email: "one@page-operation.test" },
				{ name: "Two", id: USER_TWO, email: "two@page-operation.test" },
			]),
		);
		const definition = {
			files: [],
			pluginDependencies: {},
			entry: "client/page.tsx",
			queries: { queries: {} },
		};
		yield* session.run((db) =>
			db
				.insert(tables.page)
				.values({
					origin: "user",
					userId: USER_ONE,
					slug: "operation",
					name: "Operation",
					writeAccess: true,
					publishedRevision: 1,
					authorityRevision: 1,
					id: pageAuthority.pageId,
					draftDefinition: definition,
					draftDefinitionHash: "draft",
					publishedDefinition: definition,
					publishedDefinitionHash: pageAuthority.definitionHash,
				}),
		);
	}),
).pipe(Layer.provideMerge(isolatedDatabaseLayer("page_operation_invocation")));

layer(
	makeLayer({ database: pageDatabase, currentUserId: USER_ONE, available: [systemUserOperation] }),
)((test) => {
	test.effect(
		"fences page operation dispatch and retry by owner, published revision and mutable grant",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeOperationDependencies;
				for (const stale of [
					{ ...pageAuthority, revision: 2 },
					{ ...pageAuthority, definitionHash: "draft" },
					{ ...pageAuthority, authorityRevision: 0 },
					{ ...pageAuthority, pageId: "foreign" },
				]) {
					assertExitFails(
						yield* Effect.exit(invoke({ pageAuthority: stale, packageId: SYSTEM_PACKAGE_ID })),
						new PluginRequestError({ reason: { code: "page-write-access-required" } }),
					);
				}
				expect(yield* fake.captured).toEqual([]);
				expect(
					yield* invoke({
						pageAuthority,
						idempotencyKey: "page-key",
						packageId: SYSTEM_PACKAGE_ID,
					}),
				).toBe("ok");
				expect(yield* fake.captured).toMatchObject([
					{ principal: { subject: { type: "user", pageAuthority, userId: USER_ONE } } },
				]);
				const repository = yield* PageAuthoringRepository.make;
				yield* repository.setWriteAccess(USER_ONE, pageAuthority.pageId, false);
				assertExitFails(
					yield* Effect.exit(
						invoke({ pageAuthority, idempotencyKey: "page-key", packageId: SYSTEM_PACKAGE_ID }),
					),
					new PluginRequestError({ reason: { code: "page-write-access-required" } }),
				);
				yield* repository.setWriteAccess(USER_ONE, pageAuthority.pageId, true);
				assertExitFails(
					yield* Effect.exit(
						invoke({ pageAuthority, idempotencyKey: "page-key", packageId: SYSTEM_PACKAGE_ID }),
					),
					new PluginRequestError({ reason: { code: "page-write-access-required" } }),
				);
				expect(yield* fake.captured).toHaveLength(1);
			}),
		testTimeout,
	);
});

layer(
	makeLayer({
		currentUserId: USER_ONE,
		available: [systemUserOperation],
		sandboxError: "Page write access is required",
		sandboxErrorData: { code: "page-write-access-required" },
	}),
)((test) => {
	test.effect(
		"preserves page grant refusal from retained execution as a displayable operation failure",
		() =>
			Effect.gen(function* () {
				assertExitFails(
					yield* Effect.exit(invoke({ packageId: SYSTEM_PACKAGE_ID })),
					new PluginRequestError({ reason: { code: "page-write-access-required" } }),
				);
			}),
		testTimeout,
	);
});

layer(
	makeLayer({
		currentUserId: USER_ONE,
		available: [systemUserOperation],
		sandboxError: "The baseline changed",
		sandboxErrorData: { code: "operation-conflict", conflict: "entity-not-found" },
	}),
)((test) => {
	test.effect(
		"maps an operation conflict raised before changes were built to a 409 changes conflict",
		() =>
			Effect.gen(function* () {
				expect(yield* Effect.flip(invoke({ packageId: SYSTEM_PACKAGE_ID }))).toEqual(
					new PluginConflictError({
						reason: { code: "changes-conflict", conflict: "entity-not-found" },
					}),
				);
			}),
		testTimeout,
	);
});

layer(makeLayer({ available: [systemUserOperation] }))((test) => {
	test.effect(
		"dispatches trusted user commands through ordinary admission without bearer headers and rejects changed pins",
		() =>
			Effect.gen(function* () {
				const service = yield* OperationsService;
				const fake = yield* FakeOperationDependencies;
				const request = {
					payload: {},
					userId: USER_ONE,
					packageId: SYSTEM_PACKAGE_ID,
					operationSlug: OPERATION_SLUG,
					idempotencyKey: "trusted-operation",
				};
				const receipt = { output: "ok", committed: { events: [] } };
				expect(yield* service.invokeTrusted(request)).toEqual(receipt);
				expect(yield* service.invokeTrusted(request)).toEqual(receipt);
				expect(yield* fake.captured).toHaveLength(1);
				expect(
					yield* Effect.flip(
						service.invokeTrusted({
							...request,
							sourcePin: {
								configRevisionId: "changed",
								revisionId: "fixture-revision",
								installationId: systemUserOperation.installationId,
							},
						}),
					),
				).toMatchObject({ _tag: "PluginConflictError", reason: { code: "source-revision-stale" } });
				expect(
					yield* Effect.flip(service.invoke({ ...request, headers: Headers.empty })),
				).toMatchObject({ _tag: "AuthUnauthorized" });
			}),
		testTimeout,
	);
});

const pluginRejection = { key: "rejection.blocked", namespace: "plugin-fixture" };
const returnedChanges = {
	output: "saved",
	changes: {
		events: {
			changes: [],
			creates: [
				{
					properties: {},
					itemIdentity: "review",
					eventSchemaSlug: "review",
					entity: { kind: "existing", entityId: "entity-1" },
				},
			],
		},
	},
};

layer(
	makeLayer({
		currentUserId: USER_ONE,
		sandboxValue: returnedChanges,
		available: [systemUserOperation],
	}),
)((test) => {
	test.effect(
		"runs an operation and commits its returned changes once per key",
		() =>
			Effect.gen(function* () {
				const service = yield* OperationsService;
				const fake = yield* FakeOperationDependencies;
				const request = {
					payload: {},
					headers: Headers.empty,
					packageId: SYSTEM_PACKAGE_ID,
					operationSlug: OPERATION_SLUG,
					idempotencyKey: "direct-operation",
				};
				const receipt = {
					output: "saved",
					committed: {
						events: [{ itemIdentity: "review", eventId: EventId.make("event-review") }],
					},
				};
				expect(yield* service.invoke(request)).toEqual(receipt);
				expect(yield* service.invoke(request)).toEqual(receipt);
				expect((yield* fake.events).filter((event) => event !== "lock")).toEqual([
					"dispatch",
					"commit",
				]);
				const [run] = yield* fake.captured;
				expect(run).toMatchObject({
					lane: "interactive",
					principal: { subject: { type: "user", userId: USER_ONE } },
				});
				const commits = yield* fake.commits;
				expect(commits).toHaveLength(1);
				expect(commits[0]).toMatchObject({
					changes: returnedChanges.changes,
					subject: { type: "user", userId: USER_ONE },
					causation: { depth: 0, source: "api", initiator: { kind: "user", id: USER_ONE } },
				});
			}),
		testTimeout,
	);
});

layer(
	makeLayer({
		currentUserId: USER_ONE,
		sandboxValue: returnedChanges,
		available: [systemUserOperation],
		commitFailure: new EventBadRequest({
			reason: { code: "policy-rejected", message: pluginRejection },
		}),
	}),
)((test) => {
	test.effect(
		"maps a policy rejection of returned changes to a 422 with the policy's reason",
		() =>
			Effect.gen(function* () {
				expect(yield* Effect.flip(invoke({ packageId: SYSTEM_PACKAGE_ID }))).toEqual(
					new PluginOperationRejected({ reason: pluginRejection }),
				);
			}),
		testTimeout,
	);
});

layer(
	makeLayer({
		currentUserId: USER_ONE,
		sandboxValue: returnedChanges,
		available: [systemUserOperation],
		commitFailure: new EntityStale({
			reason: { code: "entity-stale", entityId: EntityId.make("entity-1") },
		}),
	}),
)((test) => {
	test.effect(
		"maps a stale baseline of returned changes to a 409 changes conflict",
		() =>
			Effect.gen(function* () {
				expect(yield* Effect.flip(invoke({ packageId: SYSTEM_PACKAGE_ID }))).toEqual(
					new PluginConflictError({
						reason: { code: "changes-conflict", conflict: "entity-stale" },
					}),
				);
			}),
		testTimeout,
	);
});

layer(
	makeLayer({
		currentUserId: USER_ONE,
		sandboxValue: returnedChanges,
		available: [systemUserOperation],
		commitFailure: new EntityUserDataBadRequest({
			reason: { code: "child-mapping-conflict", entityIds: [EntityId.make("child-1")] },
		}),
	}),
)((test) => {
	test.effect(
		"maps an entity user-data refusal of returned changes to a 409 with its conflict code",
		() =>
			Effect.gen(function* () {
				expect(yield* Effect.flip(invoke({ packageId: SYSTEM_PACKAGE_ID }))).toEqual(
					new PluginConflictError({
						reason: { code: "changes-conflict", conflict: "child-mapping-conflict" },
					}),
				);
			}),
		testTimeout,
	);
});

layer(
	makeLayer({
		currentUserId: USER_ONE,
		sandboxValue: returnedChanges,
		available: [systemUserOperation],
		commitFailure: new EntityUserDataBadRequest({
			reason: { operation: "merge", code: "operation-denied" },
		}),
	}),
)((test) => {
	test.effect(
		"reports an entity user-data refusal the plugin could rule out as invalid changes",
		() =>
			Effect.gen(function* () {
				expect(yield* Effect.flip(invoke({ packageId: SYSTEM_PACKAGE_ID }))).toMatchObject({
					_tag: "PluginInvocationError",
					reason: {
						code: "runtime-failed",
						diagnostics: [
							objectContaining({
								message:
									"Operation changes were not committed (EntityUserDataBadRequest: operation-denied)",
							}),
						],
					},
				});
			}),
		testTimeout,
	);
});

layer(
	makeLayer({
		currentUserId: USER_ONE,
		sandboxValue: returnedChanges,
		available: [systemUserOperation],
		commitFailure: new PluginUserSettingsPatchError({
			message: "Unknown plugin user settings: unknown",
		}),
	}),
)((test) => {
	test.effect(
		"reports a rejected settings patch with its validation message",
		() =>
			Effect.gen(function* () {
				expect(yield* Effect.flip(invoke({ packageId: SYSTEM_PACKAGE_ID }))).toMatchObject({
					_tag: "PluginInvocationError",
					reason: {
						code: "runtime-failed",
						diagnostics: [
							objectContaining({
								message:
									"Operation changes were not committed (settings: Unknown plugin user settings: unknown)",
							}),
						],
					},
				});
			}),
		testTimeout,
	);
});

layer(
	makeLayer({
		currentUserId: USER_ONE,
		sandboxValue: returnedChanges,
		available: [systemUserOperation],
		commitFailure: new EventBadRequest({ reason: { code: "root-entity-required" } }),
	}),
)((test) => {
	test.effect(
		"reports invalid returned changes as a plugin invocation failure",
		() =>
			Effect.gen(function* () {
				expect(yield* Effect.flip(invoke({ packageId: SYSTEM_PACKAGE_ID }))).toMatchObject({
					_tag: "PluginInvocationError",
					reason: {
						code: "runtime-failed",
						diagnostics: [
							objectContaining({
								phase: "output",
								message:
									"Operation changes were not committed (EventBadRequest: root-entity-required)",
							}),
						],
					},
				});
			}),
		testTimeout,
	);
});
