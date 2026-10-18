import { InternalError, internalError } from "@ryot-app/contract/errors";
import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Context, Effect, Layer, Result, Schema } from "effect";
import { Activity, Workflow } from "effect/workflow";
import { WorkflowEngine, type WorkflowInstance } from "effect/workflow/WorkflowEngine";

import type { DurableSchema } from "#boot/workflow-engine";
import { MutationReceipts } from "#modules/mutations/receipts";
import { ScriptPluginRevision } from "#modules/scripts/authorization/principal";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";
import { DatabaseSession } from "#platform/db/session";
import { implementWorkflow, makeActivity } from "#platform/workflow/scope";

import { PluginCatalogInvalidator } from "../catalog/events";
import { PluginRuntimeResolver } from "../catalog/runtime-resolver";
import { PluginInstallationRepository } from "./repository";

const PluginInstallationWorkflowPayload = Schema.Struct({
	activationId: Schema.String,
	installationId: Schema.String,
});
type PluginInstallationWorkflowPayload = typeof PluginInstallationWorkflowPayload.Type;

const PluginInstallationBootstrap = Schema.Struct({
	userId: UserId,
	accountGeneration: AccountGeneration,
	entries: Schema.Array(
		Schema.Struct({
			slug: Schema.String,
			scriptId: SandboxScriptId,
			pluginRevision: ScriptPluginRevision,
		}),
	),
});
type PluginInstallationBootstrap = typeof PluginInstallationBootstrap.Type;

export const PluginInstallationWorkflow = Workflow.make("PluginInstallationWorkflow", {
	success: Schema.Void satisfies DurableSchema,
	error: InternalError satisfies DurableSchema,
	payload: PluginInstallationWorkflowPayload satisfies DurableSchema,
	idempotencyKey: ({ activationId, installationId }) =>
		pluginInstallationExecutionId(installationId, activationId),
});

export const pluginInstallationExecutionId = (installationId: string, activationId: string) =>
	`plugin-installation-${installationId.length}-${installationId}-${activationId.length}-${activationId}`;

export const pluginInstallationBootstrapExecutionId = (
	installationId: string,
	activationId: string,
	entrySlug: string,
) =>
	`plugin-installation-bootstrap-${installationId.length}-${installationId}-${activationId.length}-${activationId}-${entrySlug.length}-${entrySlug}`;

type PluginInstallationWorkflowOperationsValue = {
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
	}) => Effect.Effect<void, InternalError, WorkflowEngine | WorkflowInstance>;
};

/** @effect-expect-leaking WorkflowEngine | WorkflowInstance */
export class PluginInstallationWorkflowOperations extends Context.Service<
	PluginInstallationWorkflowOperations,
	PluginInstallationWorkflowOperationsValue
>()("PluginInstallationWorkflowOperations") {}

const asInternal = <A, E, R>(effect: Effect.Effect<A, E, R>, message: string) =>
	effect.pipe(
		Effect.catchCauseIf(
			(cause) => !Cause.hasInterruptsOnly(cause),
			(cause) => Effect.logError(message, cause).pipe(Effect.andThen(internalError(message))),
		),
		Effect.mapError(() => internalError(message)),
	);

export const PluginInstallationWorkflowOperationsLive = Layer.effect(
	PluginInstallationWorkflowOperations,
	Effect.gen(function* () {
		const runtime = yield* PluginRuntimeResolver;
		const sandbox = yield* ScriptExecutionService;
		const sandboxRepository = yield* SandboxRepository;
		const workflowReferences = yield* SandboxWorkflowReferenceRepository;
		const invalidator = yield* PluginCatalogInvalidator;
		const database = yield* DatabaseSession;
		const installations = yield* PluginInstallationRepository;
		const receipts = yield* MutationReceipts.make;

		const begin = (installationId: string, activationId: string) =>
			asInternal(
				database.transaction(
					runtime.lockCatalog().pipe(
						Effect.andThen(
							Effect.gen(function* () {
								const resolved = yield* runtime.resolveInstallationBootstrap(installationId);
								if (resolved?.health !== "installing" || resolved.activationId !== activationId) {
									return null;
								}
								const entries: Array<PluginInstallationBootstrap["entries"][number]> = [];
								const accountGeneration = yield* receipts.currentAccount(resolved.userId);
								const installation = yield* installations.findById(installationId);
								if (installation?.isInitialized) {
									return { entries, accountGeneration, userId: resolved.userId };
								}
								for (const entry of resolved.entries) {
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
				),
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
			input: Parameters<PluginInstallationWorkflowOperationsValue["runBootstrapEntry"]>[0],
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

		return {
			fail,
			begin,
			complete,
			runBootstrapEntry,
			releaseBootstrapEntry: (installationId, activationId, entrySlug) =>
				asInternal(
					sandbox.releaseWorkflowRegistration(
						pluginInstallationBootstrapExecutionId(installationId, activationId, entrySlug),
					),
					"Plugin installation bootstrap pin could not be released",
				),
		} satisfies PluginInstallationWorkflowOperationsValue;
	}),
);

export const runPluginInstallationWorkflow = Effect.fn("PluginInstallationWorkflow")(
	function* (payload: PluginInstallationWorkflowPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({ executionId, installationId: payload.installationId });
		const operations = yield* PluginInstallationWorkflowOperations;
		const markFailed = (healthReason: string) =>
			makeActivity({
				name: "fail-plugin-installation",
				error: InternalError satisfies DurableSchema,
				success: Schema.Void satisfies DurableSchema,
				execute: operations.fail(payload.installationId, payload.activationId, healthReason),
			}).pipe(Activity.retry({ times: 3 }));

		const started = yield* makeActivity({
			name: "begin-plugin-installation",
			error: InternalError satisfies DurableSchema,
			execute: operations.begin(payload.installationId, payload.activationId),
			success: Schema.NullOr(PluginInstallationBootstrap) satisfies DurableSchema,
		}).pipe(Activity.retry({ times: 3 }), Effect.result);
		if (Result.isFailure(started)) {
			yield* markFailed("Plugin installation could not be started");
			return;
		}
		if (started.success === null) {
			return;
		}

		const { userId, entries, accountGeneration } = started.success;
		for (const [index, entry] of entries.entries()) {
			const executed = yield* operations
				.runBootstrapEntry({
					userId,
					accountGeneration,
					entrySlug: entry.slug,
					scriptId: entry.scriptId,
					activationId: payload.activationId,
					pluginRevision: entry.pluginRevision,
					installationId: payload.installationId,
				})
				.pipe(Effect.result);
			if (Result.isFailure(executed)) {
				for (const skipped of entries.slice(index + 1)) {
					yield* makeActivity({
						name: `release-bootstrap-${skipped.slug}`,
						success: Schema.Void satisfies DurableSchema,
						error: InternalError satisfies DurableSchema,
						execute: operations.releaseBootstrapEntry(
							payload.installationId,
							payload.activationId,
							skipped.slug,
						),
					}).pipe(Activity.retry({ times: 3 }));
				}
				yield* markFailed(`Plugin installation bootstrap failed: ${entry.slug}`);
				return;
			}
		}

		const completed = yield* makeActivity({
			name: "complete-plugin-installation",
			error: InternalError satisfies DurableSchema,
			success: Schema.Void satisfies DurableSchema,
			execute: operations.complete(payload.installationId, payload.activationId, userId),
		}).pipe(Activity.retry({ times: 5 }), Effect.result);
		if (Result.isFailure(completed)) {
			yield* markFailed("Plugin installation could not be completed");
		}
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "PluginInstallationWorkflow" }),
);

export const PluginInstallationWorkflowDefinitionsLive = implementWorkflow(
	PluginInstallationWorkflow,
	runPluginInstallationWorkflow,
);

export class PluginInstallationLifecycleDispatcher extends Context.Service<PluginInstallationLifecycleDispatcher>()(
	"PluginInstallationLifecycleDispatcher",
	{
		make: Effect.succeed({
			dispatch: (_input: PluginInstallationWorkflowPayload): Effect.Effect<void, InternalError> =>
				Effect.void,
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const PluginInstallationLifecycleDispatcherLive = Layer.effect(
	PluginInstallationLifecycleDispatcher,
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		return {
			dispatch: (payload: PluginInstallationWorkflowPayload) =>
				engine
					.execute(PluginInstallationWorkflow, {
						payload,
						discard: true,
						executionId: pluginInstallationExecutionId(
							payload.installationId,
							payload.activationId,
						),
					})
					.pipe(
						Effect.mapError(() =>
							internalError("Plugin installation lifecycle could not be dispatched"),
						),
					),
		};
	}),
);
