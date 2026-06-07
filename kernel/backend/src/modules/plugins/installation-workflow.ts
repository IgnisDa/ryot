import { InternalError, internalError } from "@ryot/contract/errors";
import { SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer, Result, Schema } from "effect";
import { Activity, Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, type WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { Database } from "#lib/infrastructure/db/service";
import type { DurableSchema } from "#lib/infrastructure/workflow";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { PluginCatalogInvalidator } from "./catalog-events";
import { PluginDefinitionMaterializer } from "./definition-materializer";
import { PluginInstallationRepository } from "./installation-repository";
import { PluginRuntimeResolver } from "./runtime-resolver";

const PluginInstallationWorkflowPayload = Schema.Struct({ installationId: Schema.String });
type PluginInstallationWorkflowPayload = typeof PluginInstallationWorkflowPayload.Type;

const PluginInstallationBootstrap = Schema.Struct({
	userId: UserId,
	entries: Schema.Array(Schema.Struct({ slug: Schema.String, scriptId: SandboxScriptId })),
});
type PluginInstallationBootstrap = typeof PluginInstallationBootstrap.Type;

export const PluginInstallationWorkflow = Workflow.make("PluginInstallationWorkflow", {
	success: Schema.Void satisfies DurableSchema,
	error: InternalError satisfies DurableSchema,
	idempotencyKey: ({ installationId }) => installationId,
	payload: PluginInstallationWorkflowPayload satisfies DurableSchema,
});

export const pluginInstallationExecutionId = (installationId: string) =>
	`plugin-installation-${installationId}`;

export const pluginInstallationBootstrapExecutionId = (installationId: string, entrySlug: string) =>
	`plugin-installation-bootstrap-${installationId.length}-${installationId}-${entrySlug.length}-${entrySlug}`;

type PluginInstallationWorkflowOperationsValue = {
	complete: (installationId: string, userId: UserId) => Effect.Effect<void, InternalError>;
	fail: (installationId: string, healthReason: string) => Effect.Effect<void, InternalError>;
	begin: (
		installationId: string,
	) => Effect.Effect<PluginInstallationBootstrap | null, InternalError>;
	runBootstrapEntry: (input: {
		readonly userId: UserId;
		readonly entrySlug: string;
		readonly installationId: string;
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
		Effect.catchCause((cause) =>
			Effect.logError(message, cause).pipe(Effect.andThen(internalError(message))),
		),
	);

export const PluginInstallationWorkflowOperationsLive = Layer.effect(
	PluginInstallationWorkflowOperations,
	Effect.gen(function* () {
		const database = yield* Database;
		const runtime = yield* PluginRuntimeResolver;
		const sandbox = yield* SandboxExecutionService;
		const invalidator = yield* PluginCatalogInvalidator;
		const installations = yield* PluginInstallationRepository;
		const definitionMaterializer = yield* PluginDefinitionMaterializer;

		const begin = (installationId: string) =>
			asInternal(
				Effect.gen(function* () {
					const resolved = yield* runtime.resolveInstallationBootstrap(installationId);
					if (resolved?.health !== "installing") {
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
					return { entries, userId: resolved.userId };
				}),
				"Plugin installation could not be inspected",
			);

		const fail = (installationId: string, healthReason: string) =>
			asInternal(
				Effect.gen(function* () {
					const installation = yield* installations.findById(installationId);
					if (installation) {
						yield* Effect.uninterruptible(
							installations
								.updateHealth({ healthReason, id: installationId, health: "failed" })
								.pipe(Effect.andThen(invalidator.user(UserId.make(installation.userId)))),
						);
					}
				}),
				"Plugin installation failure could not be recorded",
			);

		const complete = (installationId: string, userId: UserId) =>
			asInternal(
				Effect.gen(function* () {
					yield* definitionMaterializer.materialize(userId);
					yield* Effect.uninterruptible(
						installations
							.updateHealth({ health: "ready", id: installationId, healthReason: null })
							.pipe(Effect.andThen(invalidator.user(userId))),
					);
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
						scriptId: input.scriptId,
						subject: { type: "user", userId: input.userId },
						executionId: pluginInstallationBootstrapExecutionId(
							input.installationId,
							input.entrySlug,
						),
					});
					return result.error ? yield* internalError(result.error.message) : yield* Effect.void;
				}),
				`Plugin installation bootstrap entry failed: ${input.entrySlug}`,
			);

		const provideDatabase = <A, E>(effect: Effect.Effect<A, E, Database>) =>
			effect.pipe(Effect.provideService(Database, database));

		return {
			runBootstrapEntry,
			begin: (installationId) => provideDatabase(begin(installationId)),
			complete: (installationId, userId) => provideDatabase(complete(installationId, userId)),
			fail: (installationId, healthReason) => provideDatabase(fail(installationId, healthReason)),
		} satisfies PluginInstallationWorkflowOperationsValue;
	}),
);

export const runPluginInstallationWorkflow = Effect.fn("PluginInstallationWorkflow")(
	function* (payload: PluginInstallationWorkflowPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({ executionId, installationId: payload.installationId });
		const operations = yield* PluginInstallationWorkflowOperations;
		const markFailed = (healthReason: string) =>
			Activity.make({
				name: "fail-plugin-installation",
				error: InternalError satisfies DurableSchema,
				success: Schema.Void satisfies DurableSchema,
				execute: operations.fail(payload.installationId, healthReason),
			}).pipe(Activity.retry({ times: 3 }));

		const started = yield* Activity.make({
			name: "begin-plugin-installation",
			error: InternalError satisfies DurableSchema,
			execute: operations.begin(payload.installationId),
			success: Schema.NullOr(PluginInstallationBootstrap) satisfies DurableSchema,
		}).pipe(Activity.retry({ times: 3 }), Effect.result);
		if (Result.isFailure(started)) {
			yield* markFailed("Plugin installation could not be started");
			return;
		}
		if (started.success === null) {
			return;
		}

		const { userId, entries } = started.success;
		for (const entry of entries) {
			const executed = yield* operations
				.runBootstrapEntry({
					userId,
					entrySlug: entry.slug,
					scriptId: entry.scriptId,
					installationId: payload.installationId,
				})
				.pipe(Effect.result);
			if (Result.isFailure(executed)) {
				yield* markFailed(`Plugin installation bootstrap failed: ${entry.slug}`);
				return;
			}
		}

		const completed = yield* Activity.make({
			name: "complete-plugin-installation",
			error: InternalError satisfies DurableSchema,
			success: Schema.Void satisfies DurableSchema,
			execute: operations.complete(payload.installationId, userId),
		}).pipe(Activity.retry({ times: 5 }), Effect.result);
		if (Result.isFailure(completed)) {
			yield* markFailed("Plugin installation could not be completed");
		}
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "PluginInstallationWorkflow" }),
);

export const PluginInstallationWorkflowDefinitionsLive = PluginInstallationWorkflow.toLayer(
	runPluginInstallationWorkflow,
);

export class PluginInstallationLifecycleDispatcher extends Context.Service<PluginInstallationLifecycleDispatcher>()(
	"PluginInstallationLifecycleDispatcher",
	{
		// Migration, legacy bootstrap and shipped-system ingestion never install a private plugin, so
		// their default dispatcher does nothing and those paths need no `WorkflowEngine`.
		make: Effect.succeed({
			dispatch: (_installationId: string): Effect.Effect<void, InternalError> => Effect.void,
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
			dispatch: (installationId: string) =>
				engine
					.execute(PluginInstallationWorkflow, {
						discard: true,
						payload: { installationId },
						executionId: pluginInstallationExecutionId(installationId),
					})
					.pipe(
						Effect.mapError(() =>
							internalError("Plugin installation lifecycle could not be dispatched"),
						),
					),
		};
	}),
);
