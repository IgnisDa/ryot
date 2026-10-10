import { InternalError, internalError } from "@ryot-app/contract/errors";
import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Context, Effect, Layer, Result, Schema } from "effect";
import { Activity, Workflow } from "effect/workflow";
import { WorkflowEngine, type WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import type { DurableSchema } from "#lib/infrastructure/workflow";
import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";
import { MutationReceipts } from "#modules/mutations/receipts";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { PluginCatalogInvalidator } from "./catalog-events";
import { PluginInstallationRepository } from "./installation-repository";
import { PluginRuntimeResolver } from "./runtime-resolver";

const PluginInstallationWorkflowPayload = Schema.Struct({
	activationId: Schema.String,
	installationId: Schema.String,
});
type PluginInstallationWorkflowPayload = typeof PluginInstallationWorkflowPayload.Type;

const PluginInstallationBootstrap = Schema.Struct({
	userId: UserId,
	accountGeneration: AccountGeneration,
	entries: Schema.Array(Schema.Struct({ slug: Schema.String, scriptId: SandboxScriptId })),
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
	) => Effect.Effect<PluginInstallationBootstrap | null, InternalError>;
	runBootstrapEntry: (input: {
		readonly accountGeneration: AccountGeneration;
		readonly userId: UserId;
		readonly entrySlug: string;
		readonly installationId: string;
		readonly activationId: string;
		readonly scriptId: SandboxScriptId;
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
		const sandbox = yield* SandboxExecutionService;
		const invalidator = yield* PluginCatalogInvalidator;
		const database = yield* DatabaseSession;
		const installations = yield* PluginInstallationRepository;
		const receipts = yield* MutationReceipts.make;

		const begin = (installationId: string, activationId: string) =>
			asInternal(
				Effect.gen(function* () {
					const resolved = yield* runtime.resolveInstallationBootstrap(installationId);
					if (resolved?.health !== "installing" || resolved.activationId !== activationId) {
						return null;
					}
					const entries: Array<PluginInstallationBootstrap["entries"][number]> = [];
					for (const entry of resolved.entries) {
						if (!entry.scriptId) {
							return yield* internalError(
								`Plugin installation bootstrap script is unavailable: ${entry.slug}`,
							);
						}
						entries.push({ slug: entry.slug, scriptId: entry.scriptId });
					}
					return {
						entries,
						userId: resolved.userId,
						accountGeneration: yield* receipts.currentAccount(resolved.userId),
					};
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
						installations
							.updateHealthForActivation({
								activationId,
								health: "ready",
								id: installationId,
								healthReason: null,
							})
							.pipe(
								Effect.tap((updated) => (updated ? invalidator.recordUser(userId) : Effect.void)),
							),
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
		for (const entry of entries) {
			const executed = yield* operations
				.runBootstrapEntry({
					userId,
					accountGeneration,
					entrySlug: entry.slug,
					scriptId: entry.scriptId,
					activationId: payload.activationId,
					installationId: payload.installationId,
				})
				.pipe(Effect.result);
			if (Result.isFailure(executed)) {
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
		// Migration, legacy bootstrap and shipped-system ingestion never install a private plugin, so
		// their default dispatcher does nothing and those paths need no `WorkflowEngine`.
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
