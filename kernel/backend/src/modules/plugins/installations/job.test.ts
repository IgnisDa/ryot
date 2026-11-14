import { expect } from "bun:test";

import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it, layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref } from "effect";

import { mutationAdmissionTestLayer } from "#modules/mutations/admission.test-support";
import { makeUserPluginRevision } from "#modules/scripts/authorization/principal.test-support";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";
import { JobQueue } from "#platform/jobs/queue";

import { PluginCatalogInvalidator } from "../catalog/events";
import { PluginRuntimeResolver } from "../catalog/runtime-resolver";
import { PluginBootstrapEntities, type PluginBootstrapEntitiesInput } from "./bootstrap-entities";
import {
	pluginInstallationBootstrapExecutionId,
	PluginInstallationJobOperations,
	PluginInstallationJobOperationsLive,
	runPluginInstallationJob,
} from "./job";
import { PluginInstallationRepository } from "./repository";

const userId = UserId.make("user-1");
const installationId = "installation-1";
const activationId = "activation-1";
const initialization = { activationId, installationId };
const pluginRevision = {
	...makeUserPluginRevision({
		slug: "fixture",
		ownerId: userId,
		compiledHashes: { first: "first-hash", second: "second-hash" },
	}),
	userBootstrapScriptSlugs: ["first", "second"],
};

it("keeps bootstrap executions distinct for each installation", () => {
	expect(pluginInstallationBootstrapExecutionId("installation-2", activationId, "first")).not.toBe(
		pluginInstallationBootstrapExecutionId(installationId, activationId, "first"),
	);
});

type ScriptPinLookupArguments = Parameters<SandboxRepository["Service"]["getScriptPin"]>;

type WorkflowRegistration = Parameters<
	SandboxWorkflowReferenceRepository["Service"]["registerInTransaction"]
>[0];
type ResolvedBootstrap = Effect.Success<
	ReturnType<PluginRuntimeResolver["Service"]["resolveInstallationBootstrap"]>
>;
type HealthUpdate = Omit<
	Parameters<PluginInstallationRepository["Service"]["updateHealthForActivation"]>[0],
	"activationId"
>;
type Execution = Pick<
	Parameters<ScriptExecutionService["Service"]["executeScript"]>[0],
	"subject" | "scriptId" | "executionId" | "pluginRevision" | "initialization"
>;

type ScriptPinLookup = {
	readonly subject: ScriptPinLookupArguments[2];
	readonly scriptId: ScriptPinLookupArguments[0];
	readonly initialization: ScriptPinLookupArguments[3];
	readonly expectedRevision: ScriptPinLookupArguments[1];
};

const bootstrapEntry = (slug: string) => ({ slug, scriptId: SandboxScriptId.make(`${slug}-id`) });

const installedAt = new Date(0);

const resolved = (
	overrides: Partial<NonNullable<ResolvedBootstrap>> = {},
): NonNullable<ResolvedBootstrap> => ({
	userId,
	installedAt,
	activationId,
	pluginScope: "user",
	pluginId: "plugin-1",
	health: "installing",
	entries: [bootstrapEntry("first"), bootstrapEntry("second")],
	...overrides,
});

const libraryEntity = { properties: {}, name: "Library", entitySchemaSlug: "library" };
const ensuredEntities: Array<PluginBootstrapEntitiesInput> = [];

class InstallationWorkflowFakeState extends Context.Service<
	InstallationWorkflowFakeState,
	{
		readonly isInitialized: Ref.Ref<boolean>;
		readonly didQuarantine: Ref.Ref<boolean>;
		readonly bootstrap: Ref.Ref<ResolvedBootstrap>;
		readonly seeds: Ref.Ref<ReadonlyArray<string>>;
		readonly executions: Ref.Ref<ReadonlyArray<Execution>>;
		readonly pushOrder: (entry: string) => Effect.Effect<void>;
		readonly healthUpdates: Ref.Ref<ReadonlyArray<HealthUpdate>>;
		readonly scriptPinLookups: Ref.Ref<ReadonlyArray<ScriptPinLookup>>;
		readonly registrations: Ref.Ref<ReadonlyArray<WorkflowRegistration>>;
	}
>()(
	"@ryot-app/kernel-backend/modules/plugins/installations/job.test/InstallationWorkflowFakeState",
) {}

class FakeInstallationWorkflow extends Context.Service<
	FakeInstallationWorkflow,
	{
		readonly isInitialized: Effect.Effect<boolean>;
		readonly order: Effect.Effect<ReadonlyArray<string>>;
		readonly seeds: Effect.Effect<ReadonlyArray<string>>;
		readonly executions: Effect.Effect<ReadonlyArray<Execution>>;
		readonly healthUpdates: Effect.Effect<ReadonlyArray<HealthUpdate>>;
		readonly scriptPinLookups: Effect.Effect<ReadonlyArray<ScriptPinLookup>>;
		readonly registrations: Effect.Effect<ReadonlyArray<WorkflowRegistration>>;
		readonly resolveBootstrapWith: (bootstrap: ResolvedBootstrap) => Effect.Effect<void>;
	}
>()("@ryot-app/kernel-backend/modules/plugins/installations/job.test/FakeInstallationWorkflow") {}

const workflowLayer = (input: {
	readonly bootstrap: ResolvedBootstrap;
	readonly hiddenInstallation?: boolean;
	readonly quarantineOnExecution?: boolean;
	readonly quarantineAfterFirstSeed?: boolean;
	readonly scriptErrors?: Record<string, string>;
	readonly bootstrapAfterExecution?: ResolvedBootstrap;
}) => {
	const fakes = Layer.effectContext(
		Effect.gen(function* () {
			const order = yield* Ref.make<ReadonlyArray<string>>([]);
			const executions = yield* Ref.make<ReadonlyArray<Execution>>([]);
			const scriptPinLookups = yield* Ref.make<ReadonlyArray<ScriptPinLookup>>([]);
			const registrations = yield* Ref.make<ReadonlyArray<WorkflowRegistration>>([]);
			const healthUpdates = yield* Ref.make<ReadonlyArray<HealthUpdate>>([]);
			const bootstrap = yield* Ref.make(input.bootstrap);
			const isInitialized = yield* Ref.make(false);
			const seeds = yield* Ref.make<ReadonlyArray<string>>([]);
			const didQuarantine = yield* Ref.make(false);
			const pushOrder = (entry: string) => Ref.update(order, (all) => [...all, entry]);
			return Context.make(PluginCatalogInvalidator, {
				all: Effect.void,
				user: () => pushOrder("invalidate"),
			}).pipe(
				Context.add(FakeInstallationWorkflow, {
					order: Ref.get(order),
					seeds: Ref.get(seeds),
					executions: Ref.get(executions),
					registrations: Ref.get(registrations),
					healthUpdates: Ref.get(healthUpdates),
					isInitialized: Ref.get(isInitialized),
					scriptPinLookups: Ref.get(scriptPinLookups),
					resolveBootstrapWith: (next) => Ref.set(bootstrap, next),
				}),
				Context.add(InstallationWorkflowFakeState, {
					seeds,
					bootstrap,
					pushOrder,
					executions,
					registrations,
					healthUpdates,
					isInitialized,
					didQuarantine,
					scriptPinLookups,
				}),
			);
		}),
	);
	const mocks = Layer.unwrap(
		Effect.map(
			InstallationWorkflowFakeState,
			({
				seeds,
				bootstrap,
				pushOrder,
				executions,
				registrations,
				healthUpdates,
				isInitialized,
				didQuarantine,
				scriptPinLookups,
			}) =>
				Layer.mergeAll(
					Layer.mock(JobQueue)({
						enqueue: (kind) => pushOrder(`enqueue:${kind.name}`).pipe(Effect.as(true)),
					}),
					Layer.succeed(PluginBootstrapEntities)({
						dispatch: (plans) => pushOrder(`dispatch:${plans.join(",")}`),
						ensure: (ensured) =>
							Effect.sync(() => void ensuredEntities.push(ensured)).pipe(
								Effect.andThen(pushOrder(`ensure:${ensured.entrySlug}`)),
								Effect.as([`plan:${ensured.entrySlug}`]),
							),
					}),
					Layer.mock(PluginRuntimeResolver)({
						lockCatalog: () => Effect.void,
						resolveInstallationBootstrap: () => Ref.get(bootstrap),
					}),
					Layer.mock(SandboxRepository)({
						getScriptPin: (scriptId, expectedRevision, subject, binding) =>
							Effect.gen(function* () {
								yield* Ref.update(scriptPinLookups, (lookups) => [
									...lookups,
									{ subject, scriptId, expectedRevision, initialization: binding },
								]);
								const current = yield* Ref.get(bootstrap);
								return binding?.installationId === installationId &&
									binding.activationId === current?.activationId &&
									current.health === "installing" &&
									pluginRevision.userBootstrapScriptSlugs.includes(scriptId.replace(/-id$/, ""))
									? {
											scriptId,
											pluginRevision,
											providerId: null,
											contentHash: `${scriptId}-hash`,
											scriptSlug: scriptId.replace(/-id$/, ""),
											metadata: { ...emptySandboxExecutionMetadata, kind: "script" },
										}
									: null;
							}),
					}),
					Layer.mock(SandboxWorkflowReferenceRepository)({
						registerInTransaction: (registration) =>
							Ref.update(registrations, (all) => [...all, registration]).pipe(
								Effect.as({ status: "registered" as const }),
							),
					}),
					Layer.mock(PluginInstallationRepository)({
						updateHealthForActivation: ({ activationId: expected, ...values }) =>
							Effect.flatMap(Ref.get(bootstrap), (current) =>
								current?.activationId === expected && current.health === "installing"
									? pushOrder(`health:${values.health}`).pipe(
											Effect.andThen(Ref.update(healthUpdates, (all) => [...all, values])),
											Effect.andThen(
												values.health === "ready" ? Ref.set(isInitialized, true) : Effect.void,
											),
											Effect.andThen(Ref.set(bootstrap, { ...current, health: values.health })),
											Effect.as(true),
										)
									: Effect.succeed(false),
							),
						findById: () =>
							Effect.map(Ref.get(isInitialized), (initialized) => ({
								userId,
								config: {},
								sortOrder: 0,
								userSettings: {},
								healthReason: null,
								id: installationId,
								uninstalledAt: null,
								pluginScope: "user",
								homeSavedView: null,
								health: "installing",
								pluginId: "plugin-1",
								createdAt: new Date(0),
								updatedAt: new Date(0),
								isInitialized: initialized,
								incompatibilityReason: null,
								activeConfigRevisionId: null,
								packageId: pluginRevision.packageId,
								isHidden: input.hiddenInstallation ?? false,
							})),
					}),
					Layer.mock(ScriptExecutionService)({
						releaseWorkflowRegistration: () => Effect.void,
						executeScript: (payload) => {
							const message = input.scriptErrors?.[payload.scriptId];
							const execution = {
								lane: payload.lane,
								subject: payload.subject,
								scriptId: payload.scriptId,
								...(payload.pluginRevision ? { pluginRevision: payload.pluginRevision } : {}),
								...(payload.initialization ? { initialization: payload.initialization } : {}),
								executionId: payload.executionId,
							};
							return Effect.gen(function* () {
								yield* Ref.update(executions, (all) => [...all, execution]);
								const current = yield* Ref.get(bootstrap);
								const failure =
									message ??
									(input.quarantineAfterFirstSeed && current?.health === "incompatible"
										? "Installation identity conflict"
										: undefined);
								if (!failure) {
									yield* Ref.update(seeds, (all) =>
										all.includes(payload.scriptId) ? all : [...all, payload.scriptId],
									);
								}
								if (
									input.quarantineAfterFirstSeed &&
									!(yield* Ref.getAndSet(didQuarantine, true))
								) {
									yield* Ref.set(bootstrap, resolved({ health: "incompatible" }));
								}
								return failure;
							}).pipe(
								Effect.tap(() =>
									input.quarantineOnExecution
										? Ref.set(bootstrap, resolved({ health: "incompatible" }))
										: Effect.void,
								),
								Effect.tap(() =>
									input.bootstrapAfterExecution !== undefined
										? Ref.set(bootstrap, input.bootstrapAfterExecution)
										: Effect.void,
								),
								Effect.map((failure) => ({
									logs: [],
									value: null,
									status: "completed" as const,
									error: failure
										? {
												message: failure,
												phase: "execute" as const,
												kind: "script-failure" as const,
											}
										: null,
								})),
							);
						},
					}),
				),
		),
	);
	return PluginInstallationJobOperationsLive.pipe(
		Layer.provide(mocks),
		Layer.provideMerge(fakes),
		Layer.provideMerge(mutationAdmissionTestLayer),
	);
};

const runWorkflow = runPluginInstallationJob(
	{ activationId, installationId },
	{ attempt: 1, id: "installation-job" },
);

layer(workflowLayer({ bootstrap: resolved() }))((test) => {
	test.effect(
		"runs bootstrap entries in declared order with owner subject and stable ids",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationWorkflow;
				yield* runWorkflow;
				expect(yield* fake.order).toEqual(["health:ready", "invalidate", "enqueue:fold-rebuild"]);
				expect(yield* fake.executions).toEqual<unknown>([
					{
						pluginRevision,
						initialization,
						lane: "background",
						scriptId: "first-id",
						subject: { userId, type: "user" },
						executionId: pluginInstallationBootstrapExecutionId(
							installationId,
							activationId,
							"first",
						),
					},
					{
						pluginRevision,
						initialization,
						lane: "background",
						scriptId: "second-id",
						subject: { userId, type: "user" },
						executionId: pluginInstallationBootstrapExecutionId(
							installationId,
							activationId,
							"second",
						),
					},
				]);
				expect(yield* fake.scriptPinLookups).toEqual([
					{
						initialization,
						expectedRevision: undefined,
						subject: { userId, type: "user" },
						scriptId: SandboxScriptId.make("first-id"),
					},
					{
						initialization,
						expectedRevision: undefined,
						subject: { userId, type: "user" },
						scriptId: SandboxScriptId.make("second-id"),
					},
				]);
				expect(yield* fake.registrations).toEqual([
					{
						userId,
						initialization,
						pluginId: pluginRevision.id,
						contentHash: "first-id-hash",
						expectedRevision: pluginRevision,
						scriptId: SandboxScriptId.make("first-id"),
						executionId: pluginInstallationBootstrapExecutionId(
							installationId,
							activationId,
							"first",
						),
					},
					{
						userId,
						initialization,
						pluginId: pluginRevision.id,
						contentHash: "second-id-hash",
						expectedRevision: pluginRevision,
						scriptId: SandboxScriptId.make("second-id"),
						executionId: pluginInstallationBootstrapExecutionId(
							installationId,
							activationId,
							"second",
						),
					},
				]);
				expect(yield* fake.healthUpdates).toEqual([
					{ userId, health: "ready", healthReason: null, id: installationId },
				]);
			}),
		testTimeout,
	);
});

layer(
	workflowLayer({
		bootstrap: resolved({
			entries: [{ slug: "library", entities: [libraryEntity] }, bootstrapEntry("first")],
		}),
	}),
)((test) => {
	test.effect(
		"ensures declared entities as a durable step before later script entries",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationWorkflow;
				ensuredEntities.length = 0;
				yield* runWorkflow;
				expect(yield* fake.order).toEqual([
					"ensure:library",
					"dispatch:plan:library",
					"health:ready",
					"invalidate",
					"enqueue:fold-rebuild",
				]);
				expect(ensuredEntities).toEqual<unknown>([
					{
						userId,
						installedAt,
						installationId,
						entrySlug: "library",
						pluginId: "plugin-1",
						accountUserId: userId,
						entities: [libraryEntity],
						executionId: pluginInstallationBootstrapExecutionId(
							installationId,
							activationId,
							"library",
						),
					},
				]);
				expect((yield* fake.executions).map(({ scriptId }) => scriptId)).toEqual<unknown>([
					"first-id",
				]);
				expect((yield* fake.registrations).map(({ scriptId }) => scriptId)).toEqual<unknown>([
					"first-id",
				]);
			}),
		testTimeout,
	);
});

layer(workflowLayer({ bootstrap: resolved({ activationId: "replacement" }) }))((test) => {
	test.effect(
		"does not register bootstrap pins for a stale activation",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationWorkflow;
				yield* runWorkflow;
				expect(yield* fake.scriptPinLookups).toEqual([]);
				expect(yield* fake.registrations).toEqual([]);
				expect(yield* fake.executions).toEqual([]);
			}),
		testTimeout,
	);
});

layer(
	workflowLayer({
		hiddenInstallation: true,
		bootstrap: resolved({ entries: [bootstrapEntry("ordinary")] }),
	}),
)((test) => {
	test.effect(
		"does not register a hidden installation's non-bootstrap script",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationWorkflow;
				yield* runWorkflow;
				const scriptPinLookups = yield* fake.scriptPinLookups;
				expect(scriptPinLookups.map(({ scriptId }) => scriptId)).toEqual(
					scriptPinLookups.map(() => SandboxScriptId.make("ordinary-id")),
				);
				expect(
					scriptPinLookups.map(({ initialization: lookupInitialization }) => lookupInitialization),
				).toEqual(scriptPinLookups.map(() => initialization));
				expect(yield* fake.registrations).toEqual([]);
				expect(yield* fake.executions).toEqual([]);
			}),
		testTimeout,
	);
});

layer(workflowLayer({ bootstrap: resolved(), quarantineOnExecution: true }))((test) => {
	test.effect(
		"does not mark a quarantined installation ready after an admitted bootstrap finishes",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationWorkflow;
				yield* runWorkflow;
				expect(yield* fake.healthUpdates).toEqual([]);
			}),
		testTimeout,
	);
});

layer(
	workflowLayer({
		bootstrap: resolved(),
		bootstrapAfterExecution: resolved({
			entries: [bootstrapEntry("new-first"), bootstrapEntry("new-second")],
		}),
	}),
)((test) => {
	test.effect(
		"keeps admitted bootstrap pins while a compatible revision changes the current declarations",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationWorkflow;
				yield* runWorkflow;
				expect(
					(yield* fake.executions).map(({ scriptId, pluginRevision: pin }) => ({
						scriptId,
						revisionId: pin?.revisionId,
						configRevisionId: pin?.configRevisionId,
					})),
				).toEqual<unknown>([
					{
						scriptId: "first-id",
						revisionId: pluginRevision.revisionId,
						configRevisionId: pluginRevision.configRevisionId,
					},
					{
						scriptId: "second-id",
						revisionId: pluginRevision.revisionId,
						configRevisionId: pluginRevision.configRevisionId,
					},
				]);
				expect(yield* fake.healthUpdates).toEqual([
					{ userId, health: "ready", healthReason: null, id: installationId },
				]);
			}),
		testTimeout,
	);
});

layer(
	workflowLayer({
		bootstrap: resolved(),
		quarantineOnExecution: true,
		scriptErrors: { "first-id": "installation unavailable" },
	}),
)((test) => {
	test.effect(
		"does not replace quarantine with failed health when admitted bootstrap execution fails",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationWorkflow;
				yield* runWorkflow;
				expect(yield* fake.healthUpdates).toEqual([]);
				expect((yield* fake.executions).map(({ scriptId }) => scriptId)).toEqual<unknown>([
					"first-id",
				]);
			}),
		testTimeout,
	);
});

layer(workflowLayer({ bootstrap: resolved(), quarantineAfterFirstSeed: true }))((test) => {
	test.effect(
		"recovers partial initialization through the existing workflow without duplicating completed seeds",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationWorkflow;
				const operations = yield* PluginInstallationJobOperations;
				yield* runWorkflow;
				expect(yield* fake.seeds).toEqual(["first-id"]);
				expect(yield* fake.isInitialized).toBe(false);
				const recoveredActivation = "recovered-activation";
				yield* fake.resolveBootstrapWith(resolved({ activationId: recoveredActivation }));
				yield* operations.complete(installationId, activationId, userId);
				yield* operations.fail(installationId, activationId, "late old failure");
				expect(yield* fake.isInitialized).toBe(false);
				expect(yield* fake.healthUpdates).toEqual([]);
				yield* runPluginInstallationJob(
					{ installationId, activationId: recoveredActivation },
					{ attempt: 1, id: "recovered-installation-job" },
				);
				expect(yield* fake.seeds).toEqual(["first-id", "second-id"]);
				expect(yield* fake.isInitialized).toBe(true);
				expect((yield* fake.executions).map(({ executionId: id }) => id)).toEqual([
					pluginInstallationBootstrapExecutionId(installationId, activationId, "first"),
					pluginInstallationBootstrapExecutionId(installationId, activationId, "second"),
					pluginInstallationBootstrapExecutionId(installationId, recoveredActivation, "first"),
					pluginInstallationBootstrapExecutionId(installationId, recoveredActivation, "second"),
				]);
			}),
		testTimeout,
	);
});

layer(workflowLayer({ bootstrap: null }))((test) => {
	test.effect(
		"does nothing for a missing or settled installation",
		() => {
			const cases = [
				null,
				resolved({ health: "ready" }),
				resolved({ activationId: "replacement" }),
			];
			return Effect.gen(function* () {
				const fake = yield* FakeInstallationWorkflow;
				yield* Effect.forEach(cases, (bootstrap) =>
					Effect.gen(function* () {
						yield* fake.resolveBootstrapWith(bootstrap);
						yield* runWorkflow;
						expect(yield* fake.executions).toEqual([]);
						expect(yield* fake.healthUpdates).toEqual([]);
					}),
				);
			});
		},
		testTimeout,
	);
});

layer(workflowLayer({ bootstrap: resolved() }))((test) => {
	test.effect(
		"does not rerun initialization after guarded completion",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationWorkflow;
				yield* runWorkflow;
				yield* runWorkflow;
				expect((yield* fake.executions).map(({ executionId }) => executionId)).toEqual([
					pluginInstallationBootstrapExecutionId(installationId, activationId, "first"),
					pluginInstallationBootstrapExecutionId(installationId, activationId, "second"),
				]);
				expect(yield* fake.isInitialized).toBe(true);
			}),
		testTimeout,
	);
});

layer(workflowLayer({ bootstrap: resolved({ entries: [{ slug: "first", scriptId: null }] }) }))(
	(test) => {
		test.effect(
			"fails the installation when a bootstrap entry has no compiled script",
			() =>
				Effect.gen(function* () {
					const fake = yield* FakeInstallationWorkflow;
					yield* runWorkflow;
					expect(yield* fake.executions).toEqual([]);
					expect(yield* fake.healthUpdates).toEqual([
						{
							userId,
							health: "failed",
							id: installationId,
							healthReason: "Plugin installation could not be started",
						},
					]);
				}),
			testTimeout,
		);
	},
);

layer(
	workflowLayer({
		bootstrap: resolved(),
		scriptErrors: { "first-id": "TypeError at scripts/bootstrap.sandbox.ts:12" },
	}),
)((test) => {
	test.effect(
		"fails the installation with a safe reason and skips later entries",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationWorkflow;
				yield* runWorkflow;
				expect((yield* fake.executions).map(({ scriptId }) => scriptId)).toEqual<unknown>([
					"first-id",
				]);
				const healthUpdates = yield* fake.healthUpdates;
				expect(healthUpdates).toEqual([
					{
						userId,
						health: "failed",
						id: installationId,
						healthReason: "Plugin installation bootstrap failed: first",
					},
				]);
				expect(String(healthUpdates[0]?.healthReason)).not.toContain("TypeError");
				expect(String(healthUpdates[0]?.healthReason)).not.toContain("bootstrap.sandbox.ts");
			}),
		testTimeout,
	);
});
