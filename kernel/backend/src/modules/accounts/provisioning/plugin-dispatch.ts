import { SandboxRunError } from "@ryot-app/contract/errors";
import type { SandboxExecutionPayload } from "@ryot-app/contract/modules/scripts/schemas";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { PluginId, type UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	type PluginBootstrapDispatch,
	PluginBootstrapEntities,
} from "#modules/plugins/installations/bootstrap-entities";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { DatabaseSession } from "#platform/db/session";

export const userBootstrapExecutionId = (
	userId: string,
	pluginId: string,
	bootstrapSlug: string,
	accountGeneration: AccountGeneration,
) =>
	`user-bootstrap-${userId.length}-${userId}-${pluginId.length}-${pluginId}-${bootstrapSlug.length}-${bootstrapSlug}-${accountGeneration.token}`;

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
			accountGeneration: AccountGeneration,
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
				const executionId = userBootstrapExecutionId(
					userId,
					entry.pluginId,
					entry.bootstrap.slug,
					accountGeneration,
				);
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
							accountGeneration,
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
										message: `Plugin user bootstrap failed: ${entry.packageId} ${bootstrap.slug}: ${error.message}`,
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
					subject: { userId, type: "user", accountGeneration },
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

export class PluginUserBootstrapDispatcher extends Context.Service<PluginUserBootstrapDispatcher>()(
	"@ryot-app/kernel-backend/modules/accounts/provisioning/plugin-dispatch/PluginUserBootstrapDispatcher",
	{
		make: Effect.gen(function* () {
			const sandbox = yield* ScriptExecutionService;
			return yield* makePluginUserBootstrapDispatcher((payload) =>
				sandbox.executeScript({
					lane: "background",
					input: payload.context,
					subject: payload.subject,
					scriptId: payload.scriptId,
					executionId: payload.executionId,
				}),
			);
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
