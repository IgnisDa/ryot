import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import { ChangesOutput } from "@ryot-app/contract/modules/changes/change-set";
import type { SandboxExecutionPayload } from "@ryot-app/contract/modules/scripts/schemas";
import { PluginId, type UserId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { Context, Effect, Layer, Schema } from "effect";

import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	type PluginBootstrapDispatch,
	PluginBootstrapEntities,
} from "#modules/plugins/installations/bootstrap-entities";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { ScriptCalls } from "#modules/scripts/executions/calls";
import { infrastructureRunError } from "#modules/scripts/executions/run-error";
import {
	ScriptChanges,
	type ScriptChangesRejected,
} from "#modules/scripts/executions/script-changes";
import { sandboxStartedAt } from "#modules/scripts/host/execution-context";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";

export const userBootstrapExecutionId = (userId: string, pluginId: string, bootstrapSlug: string) =>
	`user-bootstrap-${userId.length}-${userId}-${pluginId.length}-${pluginId}-${bootstrapSlug.length}-${bootstrapSlug}`;

export const makePluginUserBootstrapDispatcher = (
	execute: (
		payload: SandboxExecutionPayload,
	) => Effect.Effect<{ readonly error: null | { readonly message: string } }, SandboxRunError>,
) =>
	Effect.gen(function* () {
		const runtime = yield* PluginRuntimeResolver;
		const installations = yield* PluginInstallationRepository;
		const bootstrapEntities = yield* PluginBootstrapEntities;
		const database = yield* DatabaseSession;
		const completeInitialization = Effect.fn(
			"PluginUserBootstrapDispatcher.completeInitialization",
		)((input: Parameters<typeof installations.completeSystemInitialization>[0]) =>
			database
				.transaction(installations.completeSystemInitialization(input))
				.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die)),
		);

		const dispatchAll = Effect.fn("PluginUserBootstrapDispatcher.dispatchAll")(function* (
			userId: UserId,
			accountUserId: UserId,
		) {
			const installed = (yield* runtime.resolveUserInstallationBootstraps(userId)).filter(
				({ health, isHidden }) => !isHidden && (health === "ready" || health === "installing"),
			);
			const initialization = new Map(
				installed.map((installation) => [
					installation.pluginId,
					{ ...installation, completed: new Set<string>() },
				]),
			);
			const noEntries = installed
				.filter(({ entries }) => entries.length === 0)
				.map(({ activationId, installationId }) => ({ activationId, installationId }));
			if (noEntries.length > 0) {
				yield* database
					.transaction(
						installations.completeNoEntryInitializations({ userId, installations: noEntries }),
					)
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
			}
			const plans: Array<PluginBootstrapDispatch[number]> = [];
			const entries = (yield* runtime.listSystemUserBootstraps()).filter(({ pluginId }) =>
				initialization.has(pluginId),
			);

			const markCompleted = (pluginId: string, slug: string) => {
				const captured = initialization.get(pluginId);
				if (!captured) {
					return Effect.void;
				}
				captured.completed.add(slug);
				return captured.completed.size === captured.entries.length
					? completeInitialization({
							userId,
							activationId: captured.activationId,
							installationId: captured.installationId,
						})
					: Effect.void;
			};

			for (const entry of entries) {
				const executionId = userBootstrapExecutionId(userId, entry.pluginId, entry.bootstrap.slug);
				const { bootstrap } = entry;
				if ("entities" in bootstrap) {
					const captured = initialization.get(entry.pluginId);
					if (!captured) {
						continue;
					}
					const ensured = yield* bootstrapEntities
						.ensure({
							userId,
							executionId,
							accountUserId,
							entrySlug: bootstrap.slug,
							entities: bootstrap.entities,
							installedAt: captured.installedAt,
							installationId: captured.installationId,
							pluginId: PluginId.make(entry.pluginId),
						})
						.pipe(
							Effect.mapError(
								(error) =>
									new SandboxRunError({
										kind: "script-failure",
										message: `Plugin user bootstrap failed: ${entry.packageId} ${bootstrap.slug}: ${unknownToMessage(error)}`,
									}),
							),
						);
					plans.push(...ensured);
					if (captured.entries.some(({ slug }) => slug === bootstrap.slug)) {
						yield* markCompleted(entry.pluginId, bootstrap.slug);
					}
					continue;
				}
				const resolved = yield* runtime.resolveActivePluginUserBootstrap({
					pluginId: entry.pluginId,
					bootstrapSlug: bootstrap.slug,
				});
				if (!resolved) {
					return yield* new SandboxRunError({
						kind: "script-failure",
						message: `Plugin user bootstrap script not found: ${entry.packageId} ${bootstrap.slug}`,
					});
				}
				const result = yield* execute({
					context: {},
					executionId,
					scriptId: resolved.script.id,
					subject: { userId, type: "user" },
				}).pipe(
					Effect.mapError(
						(error) =>
							new SandboxRunError({
								kind: "script-failure",
								message: `Plugin user bootstrap failed: ${entry.packageId} ${entry.bootstrap.slug}: ${error.message}`,
							}),
					),
				);
				if (result.error) {
					return yield* new SandboxRunError({
						kind: "script-failure",
						message: `Plugin user bootstrap failed: ${entry.packageId} ${entry.bootstrap.slug}: ${result.error.message}`,
					});
				}
				if (
					initialization
						.get(entry.pluginId)
						?.entries.some(
							(captured) =>
								captured.slug === bootstrap.slug &&
								"scriptId" in captured &&
								captured.scriptId === resolved.script.id,
						)
				) {
					yield* markCompleted(entry.pluginId, bootstrap.slug);
				}
			}
			return plans;
		});

		return { dispatchAll };
	});

const changesRejection = (error: ScriptChangesRejected) => {
	const { reason } = error;
	if (reason.code === "conflict") {
		return `its changes conflicted with a newer write (${reason.conflict})`;
	}
	return reason.code === "policy-rejected"
		? "a policy rejected its changes"
		: `its changes were rejected: ${reason.message}`;
};

/**
 * Runs a user bootstrap script under its pinned principal and commits the changes it returns, once
 * per bootstrap execution and script content.
 */
export const runUserBootstrapScript = Effect.fn("runUserBootstrapScript")(function* (
	payload: SandboxExecutionPayload,
) {
	const scripts = yield* SandboxRepository;
	const calls = yield* ScriptCalls;
	const changes = yield* ScriptChanges;
	const pin = yield* scripts
		.getScriptPin(payload.scriptId, undefined, payload.subject)
		.pipe(Effect.catchTag("DbError", (error) => Effect.fail(infrastructureRunError(error))));
	if (!pin) {
		return yield* new SandboxRunError({
			kind: "missing-artifact",
			message: "User bootstrap script is unavailable",
		});
	}
	const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({
		...pin,
		subject: payload.subject,
	}).pipe(Effect.mapError(infrastructureRunError));
	const result = yield* calls.run({
		principal,
		lane: "background",
		executionId: payload.executionId,
		input: yield* Schema.decodeUnknownEffect(JsonValue)(payload.context).pipe(
			Effect.mapError(infrastructureRunError),
		),
	});
	if (result.error) {
		return { error: result.error };
	}
	const output = yield* Schema.decodeUnknownEffect(ChangesOutput)(result.value).pipe(
		Effect.orElseSucceed(() => null),
	);
	if (output === null) {
		return { error: { message: "A user bootstrap script must return { changes? }" } };
	}
	return yield* changes
		.commitKeyed({
			principal,
			lane: "background",
			changes: output.changes,
			occurredAt: yield* sandboxStartedAt,
			executionId: `${payload.executionId}-${pin.contentHash}`,
		})
		.pipe(
			Effect.as({ error: null }),
			Effect.catchTags({
				DbError: (error) => Effect.fail(infrastructureRunError(error)),
				ScriptChangesRejected: (error) =>
					Effect.succeed({ error: { message: changesRejection(error) } }),
			}),
		);
});

export class PluginUserBootstrapDispatcher extends Context.Service<PluginUserBootstrapDispatcher>()(
	"@ryot-app/kernel-backend/modules/accounts/provisioning/plugin-dispatch/PluginUserBootstrapDispatcher",
	{
		make: Effect.gen(function* () {
			const context =
				yield* Effect.context<Effect.Services<ReturnType<typeof runUserBootstrapScript>>>();
			return yield* makePluginUserBootstrapDispatcher((payload) =>
				runUserBootstrapScript(payload).pipe(Effect.provideContext(context)),
			);
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
