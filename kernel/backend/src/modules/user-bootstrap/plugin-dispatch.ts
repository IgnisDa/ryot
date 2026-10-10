import { SandboxRunError } from "@ryot-app/contract/errors";
import type { SandboxExecutionPayload } from "@ryot-app/contract/modules/sandbox/schemas";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { SandboxExecutionService } from "#modules/sandbox/service";

export const userBootstrapExecutionId = (
	userId: string,
	pluginId: string,
	bootstrapSlug: string,
	accountGeneration: AccountGeneration,
	generation?: string,
) =>
	`user-bootstrap-${userId.length}-${userId}-${pluginId.length}-${pluginId}-${bootstrapSlug.length}-${bootstrapSlug}-${accountGeneration.token}${generation ? `-${generation.length}-${generation}` : ""}`;

export const makePluginUserBootstrapDispatcher = (
	execute: (
		payload: SandboxExecutionPayload,
	) => Effect.Effect<{ readonly error: null | { readonly message: string } }, SandboxRunError>,
) =>
	Effect.gen(function* () {
		const runtime = yield* PluginRuntimeResolver;
		const installations = yield* PluginInstallationRepository;
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
			generation?: string,
		) {
			const installed = (yield* installations.listSystemForUser(userId)).filter(
				({ health, isHidden }) => !isHidden && (health === "ready" || health === "installing"),
			);
			const initialization = new Map<
				string,
				Pick<
					NonNullable<Effect.Success<ReturnType<typeof runtime.resolveInstallationBootstrap>>>,
					"activationId" | "entries"
				> & { readonly installationId: string; readonly completed: Set<string> }
			>();
			for (const installation of installed) {
				const captured = yield* runtime.resolveInstallationBootstrap(installation.id);
				if (captured?.userId !== userId || captured.pluginScope !== "system") {
					continue;
				}
				initialization.set(installation.pluginId, {
					completed: new Set(),
					entries: captured.entries,
					installationId: installation.id,
					activationId: captured.activationId,
				});
				if (captured.entries.length === 0) {
					yield* completeInitialization({
						userId,
						installationId: installation.id,
						activationId: captured.activationId,
					});
				}
			}
			const installedIds = new Set(installed.map(({ pluginId }) => pluginId));
			const entries = (yield* runtime.listSystemUserBootstraps()).filter(({ pluginId }) =>
				installedIds.has(pluginId),
			);

			for (const entry of entries) {
				const resolved = yield* runtime.resolveActivePluginUserBootstrap({
					pluginId: entry.pluginId,
					bootstrapSlug: entry.bootstrap.slug,
				});
				if (!resolved) {
					return yield* new SandboxRunError({
						kind: "script-failure",
						message: `Plugin user bootstrap script not found: ${entry.packageId} ${entry.bootstrap.slug}`,
					});
				}
				const executionId = userBootstrapExecutionId(
					userId,
					entry.pluginId,
					entry.bootstrap.slug,
					accountGeneration,
					generation,
				);
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
				const captured = initialization.get(entry.pluginId);
				if (
					captured?.entries.some(
						({ slug, scriptId }) =>
							slug === entry.bootstrap.slug && scriptId === resolved.script.id,
					)
				) {
					captured.completed.add(entry.bootstrap.slug);
					if (captured.completed.size === captured.entries.length) {
						yield* completeInitialization({
							userId,
							activationId: captured.activationId,
							installationId: captured.installationId,
						});
					}
				}
			}
			return yield* Effect.void;
		});

		return { dispatchAll };
	});

export class PluginUserBootstrapDispatcher extends Context.Service<PluginUserBootstrapDispatcher>()(
	"PluginUserBootstrapDispatcher",
	{
		make: Effect.gen(function* () {
			const sandbox = yield* SandboxExecutionService;
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
