import type { InternalError } from "@ryot-app/contract/errors";
import { internalError } from "@ryot-app/contract/errors";
import { PluginUserBootstrapEntity } from "@ryot-app/contract/modules/plugins/manifest";
import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { PluginId, SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Context, Duration, Effect, Layer, Result, Schema } from "effect";

import { AccountAdmission } from "#modules/mutations/account-admission";
import { ScriptPluginRevision } from "#modules/scripts/authorization/principal";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue, makeJobKind } from "#platform/jobs/queue";
import { type JobContext, registerJobHandler } from "#platform/jobs/worker";

import { PluginCatalogInvalidator } from "../catalog/events";
import { PluginRuntimeResolver } from "../catalog/runtime-resolver";
import type { PluginBootstrapDispatch } from "./bootstrap-entities";
import { PluginBootstrapEntities } from "./bootstrap-entities";
import { PluginInstallationRepository } from "./repository";

const PluginInstallationPayload = Schema.Struct({
	activationId: Schema.String,
	installationId: Schema.String,
});
type PluginInstallationPayload = typeof PluginInstallationPayload.Type;

const PluginInstallationBootstrap = Schema.Struct({
	userId: UserId,
	accountGeneration: AccountGeneration,
	entries: Schema.Array(
		Schema.Union([
			Schema.Struct({
				slug: Schema.String,
				scriptId: SandboxScriptId,
				pluginRevision: ScriptPluginRevision,
			}),
			Schema.Struct({ slug: Schema.String, entities: Schema.Array(PluginUserBootstrapEntity) }),
		]),
	),
});
type PluginInstallationBootstrap = typeof PluginInstallationBootstrap.Type;

export const PluginInstallationJob = makeJobKind("plugin-installation", {
	concurrency: 4,
	maxAttempts: 3,
	lease: Duration.minutes(5),
	payload: PluginInstallationPayload,
});

export const pluginInstallationBootstrapExecutionId = (
	installationId: string,
	activationId: string,
	entrySlug: string,
) =>
	`plugin-installation-bootstrap-${installationId.length}-${installationId}-${activationId.length}-${activationId}-${entrySlug.length}-${entrySlug}`;

type PluginInstallationJobOperationsValue = {
	dispatchBootstrapEntities: (plans: PluginBootstrapDispatch) => Effect.Effect<void, InternalError>;
	complete: (
		installationId: string,
		activationId: string,
		userId: UserId,
	) => Effect.Effect<void, InternalError>;
	fail: (
		installationId: string,
		activationId: string,
		healthReason: string,
	) => Effect.Effect<void, InternalError>;
	begin: (
		installationId: string,
		activationId: string,
	) => Effect.Effect<null | PluginInstallationBootstrap, InternalError>;
	releaseBootstrapEntry: (
		installationId: string,
		activationId: string,
		entrySlug: string,
	) => Effect.Effect<void, InternalError>;
	runBootstrapEntry: (input: {
		readonly userId: UserId;
		readonly entrySlug: string;
		readonly activationId: string;
		readonly installationId: string;
		readonly scriptId: SandboxScriptId;
		readonly accountGeneration: AccountGeneration;
		readonly pluginRevision: ScriptPluginRevision;
	}) => Effect.Effect<void, InternalError>;
	ensureBootstrapEntities: (input: {
		readonly userId: UserId;
		readonly entrySlug: string;
		readonly activationId: string;
		readonly installationId: string;
		readonly accountGeneration: AccountGeneration;
		readonly entities: ReadonlyArray<PluginUserBootstrapEntity>;
	}) => Effect.Effect<PluginBootstrapDispatch, InternalError>;
};

export class PluginInstallationJobOperations extends Context.Service<
	PluginInstallationJobOperations,
	PluginInstallationJobOperationsValue
>()("@ryot-app/kernel-backend/modules/plugins/installations/job/PluginInstallationJobOperations") {}

const asInternal = <A, E, R>(effect: Effect.Effect<A, E, R>, message: string) =>
	effect.pipe(
		Effect.catchCauseIf(
			(cause) => !Cause.hasInterruptsOnly(cause),
			(cause) => Effect.logError(message, cause).pipe(Effect.andThen(internalError(message))),
		),
		Effect.mapError(() => internalError(message)),
	);

export const PluginInstallationJobOperationsLive = Layer.effect(
	PluginInstallationJobOperations,
	Effect.gen(function* () {
		const runtime = yield* PluginRuntimeResolver;
		const sandbox = yield* ScriptExecutionService;
		const sandboxRepository = yield* SandboxRepository;
		const workflowReferences = yield* SandboxWorkflowReferenceRepository;
		const invalidator = yield* PluginCatalogInvalidator;
		const database = yield* DatabaseSession;
		const installations = yield* PluginInstallationRepository;
		const bootstrapEntities = yield* PluginBootstrapEntities;
		const admission = yield* AccountAdmission.make;

		const begin = (installationId: string, activationId: string) =>
			asInternal(
				Effect.gen(function* () {
					const located = yield* installations.findById(installationId);
					if (!located) {
						return null;
					}
					return yield* database.transaction(
						runtime.lockCatalog([located.userId]).pipe(
							Effect.andThen(
								Effect.gen(function* () {
									const resolved = yield* runtime.resolveInstallationBootstrap(installationId);
									if (resolved?.health !== "installing" || resolved.activationId !== activationId) {
										return null;
									}
									const entries: Array<PluginInstallationBootstrap["entries"][number]> = [];
									const accountGeneration = yield* admission.currentAccount(resolved.userId);
									const installation = yield* installations.findById(installationId);
									if (installation?.isInitialized) {
										return { entries, accountGeneration, userId: resolved.userId };
									}
									for (const entry of resolved.entries) {
										if (entry.entities) {
											entries.push({ slug: entry.slug, entities: entry.entities });
											continue;
										}
										if (!entry.scriptId) {
											return yield* internalError(
												`Plugin installation bootstrap script is unavailable: ${entry.slug}`,
											);
										}
										const initialization = { activationId, installationId };
										const pin = yield* sandboxRepository.getScriptPin(
											entry.scriptId,
											undefined,
											{ type: "user", accountGeneration, userId: resolved.userId },
											initialization,
										);
										if (!pin?.pluginRevision) {
											return yield* internalError(
												`Plugin installation bootstrap owner is unavailable: ${entry.slug}`,
											);
										}
										yield* workflowReferences.registerInTransaction({
											initialization,
											userId: resolved.userId,
											scriptId: entry.scriptId,
											contentHash: pin.contentHash,
											pluginId: pin.pluginRevision.id,
											expectedRevision: pin.pluginRevision,
											executionId: pluginInstallationBootstrapExecutionId(
												installationId,
												activationId,
												entry.slug,
											),
										});
										entries.push({
											slug: entry.slug,
											scriptId: entry.scriptId,
											pluginRevision: pin.pluginRevision,
										});
									}
									return { entries, accountGeneration, userId: resolved.userId };
								}),
							),
						),
					);
				}),
				"Plugin installation could not be inspected",
			);

		const fail = (installationId: string, activationId: string, healthReason: string) =>
			asInternal(
				Effect.gen(function* () {
					const installation = yield* installations.findById(installationId);
					if (installation) {
						const changed = yield* database.transaction(
							installations
								.updateHealthForActivation({
									healthReason,
									activationId,
									health: "failed",
									id: installationId,
									userId: UserId.make(installation.userId),
								})
								.pipe(
									Effect.tap((updated) =>
										updated
											? invalidator.recordUser(UserId.make(installation.userId))
											: Effect.void,
									),
								),
						);
						if (changed) {
							yield* invalidator.user(UserId.make(installation.userId));
						}
					}
				}),
				"Plugin installation failure could not be recorded",
			);

		const complete = (installationId: string, activationId: string, userId: UserId) =>
			asInternal(
				Effect.gen(function* () {
					const changed = yield* database.transaction(
						Effect.gen(function* () {
							const installation = yield* installations.findById(installationId);
							if (installation?.userId !== userId) {
								return false;
							}
							return yield* installations
								.updateHealthForActivation({
									userId,
									activationId,
									health: "ready",
									id: installationId,
									healthReason: null,
								})
								.pipe(
									Effect.tap((updated) => (updated ? invalidator.recordUser(userId) : Effect.void)),
								);
						}),
					);
					if (changed) {
						yield* invalidator.user(userId);
					}
				}),
				"Plugin installation completion could not be recorded",
			);

		const runBootstrapEntry = (
			input: Parameters<PluginInstallationJobOperationsValue["runBootstrapEntry"]>[0],
		) =>
			asInternal(
				Effect.gen(function* () {
					const result = yield* sandbox.executeScript({
						input: {},
						lane: "background",
						scriptId: input.scriptId,
						pluginRevision: input.pluginRevision,
						initialization: {
							activationId: input.activationId,
							installationId: input.installationId,
						},
						subject: {
							type: "user",
							userId: input.userId,
							accountGeneration: input.accountGeneration,
						},
						executionId: pluginInstallationBootstrapExecutionId(
							input.installationId,
							input.activationId,
							input.entrySlug,
						),
					});
					return result.error ? yield* internalError(result.error.message) : yield* Effect.void;
				}),
				`Plugin installation bootstrap entry failed: ${input.entrySlug}`,
			);

		const ensureBootstrapEntities = (
			input: Parameters<PluginInstallationJobOperationsValue["ensureBootstrapEntities"]>[0],
		) =>
			asInternal(
				Effect.gen(function* () {
					const installation = yield* installations.findById(input.installationId);
					if (!installation) {
						return yield* internalError("Plugin installation is unavailable");
					}
					return yield* bootstrapEntities.ensure({
						userId: input.userId,
						entities: input.entities,
						entrySlug: input.entrySlug,
						installedAt: installation.createdAt,
						installationId: input.installationId,
						accountGeneration: input.accountGeneration,
						pluginId: PluginId.make(installation.pluginId),
						executionId: pluginInstallationBootstrapExecutionId(
							input.installationId,
							input.activationId,
							input.entrySlug,
						),
					});
				}),
				`Plugin installation bootstrap entry failed: ${input.entrySlug}`,
			);

		return {
			fail,
			begin,
			complete,
			runBootstrapEntry,
			ensureBootstrapEntities,
			dispatchBootstrapEntities: bootstrapEntities.dispatch,
			releaseBootstrapEntry: (installationId, activationId, entrySlug) =>
				asInternal(
					sandbox.releaseWorkflowRegistration(
						pluginInstallationBootstrapExecutionId(installationId, activationId, entrySlug),
					),
					"Plugin installation bootstrap pin could not be released",
				),
		} satisfies PluginInstallationJobOperationsValue;
	}),
);

export const runPluginInstallationJob = Effect.fn("PluginInstallationJob")(
	function* (payload: PluginInstallationPayload, job: JobContext) {
		yield* Effect.annotateCurrentSpan({ jobId: job.id, installationId: payload.installationId });
		const operations = yield* PluginInstallationJobOperations;
		const markFailed = (healthReason: string) =>
			operations
				.fail(payload.installationId, payload.activationId, healthReason)
				.pipe(Effect.retry({ times: 3 }));

		const started = yield* operations
			.begin(payload.installationId, payload.activationId)
			.pipe(Effect.retry({ times: 3 }), Effect.result);
		if (Result.isFailure(started)) {
			yield* markFailed("Plugin installation could not be started");
			return;
		}
		if (started.success === null) {
			return;
		}

		const { userId, entries, accountGeneration } = started.success;
		for (const [index, entry] of entries.entries()) {
			const executed = yield* (
				"entities" in entry
					? operations
							.ensureBootstrapEntities({
								userId,
								accountGeneration,
								entrySlug: entry.slug,
								entities: entry.entities,
								activationId: payload.activationId,
								installationId: payload.installationId,
							})
							.pipe(
								Effect.retry({ times: 3 }),
								Effect.flatMap((plans) =>
									operations
										.dispatchBootstrapEntities(plans)
										.pipe(
											Effect.catchCause((cause) =>
												Effect.logError(
													"plugin installation bootstrap hook dispatch failed",
													cause,
												),
											),
										),
								),
							)
					: operations.runBootstrapEntry({
							userId,
							accountGeneration,
							entrySlug: entry.slug,
							scriptId: entry.scriptId,
							activationId: payload.activationId,
							pluginRevision: entry.pluginRevision,
							installationId: payload.installationId,
						})
			).pipe(Effect.result);
			if (Result.isFailure(executed)) {
				for (const skipped of entries.slice(index + 1).filter((next) => "scriptId" in next)) {
					yield* operations
						.releaseBootstrapEntry(payload.installationId, payload.activationId, skipped.slug)
						.pipe(Effect.retry({ times: 3 }));
				}
				yield* markFailed(`Plugin installation bootstrap failed: ${entry.slug}`);
				return;
			}
		}

		const completed = yield* operations
			.complete(payload.installationId, payload.activationId, userId)
			.pipe(Effect.retry({ times: 5 }), Effect.result);
		if (Result.isFailure(completed)) {
			yield* markFailed("Plugin installation could not be completed");
		}
	},
	(effect, payload) => Effect.annotateLogs(effect, { installationId: payload.installationId }),
);

export const PluginInstallationJobLive = registerJobHandler(
	PluginInstallationJob,
	runPluginInstallationJob,
);

export class PluginInstallationLifecycleDispatcher extends Context.Service<PluginInstallationLifecycleDispatcher>()(
	"@ryot-app/kernel-backend/modules/plugins/installations/job/PluginInstallationLifecycleDispatcher",
	{
		make: Effect.succeed({
			dispatch: (_input: PluginInstallationPayload): Effect.Effect<void, InternalError> =>
				Effect.void,
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const PluginInstallationLifecycleDispatcherLive = Layer.effect(
	PluginInstallationLifecycleDispatcher,
	Effect.gen(function* () {
		const jobs = yield* JobQueue;
		return {
			dispatch: (payload: PluginInstallationPayload) =>
				jobs
					.enqueue(PluginInstallationJob, payload, {
						key: `${payload.installationId}:${payload.activationId}`,
					})
					.pipe(
						Effect.asVoid,
						Effect.mapError(() =>
							internalError("Plugin installation lifecycle could not be dispatched"),
						),
					),
		};
	}),
);
