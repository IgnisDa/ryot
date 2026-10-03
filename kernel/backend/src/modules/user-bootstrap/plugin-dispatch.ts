import { SandboxRunError } from "@ryot-app/contract/errors";
import type { SandboxExecutionPayload } from "@ryot-app/contract/modules/sandbox/schemas";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { SandboxExecutionService } from "#modules/sandbox/service";

export const userBootstrapExecutionId = (
	userId: string,
	pluginSlug: string,
	bootstrapSlug: string,
	accountGeneration: AccountGeneration,
	generation?: string,
) =>
	`user-bootstrap-${userId.length}-${userId}-${pluginSlug.length}-${pluginSlug}-${bootstrapSlug.length}-${bootstrapSlug}-${accountGeneration.token}${generation ? `-${generation.length}-${generation}` : ""}`;

export const makePluginUserBootstrapDispatcher = (
	execute: (
		payload: SandboxExecutionPayload,
	) => Effect.Effect<{ readonly error: null | { readonly message: string } }, SandboxRunError>,
) =>
	Effect.gen(function* () {
		const runtime = yield* PluginRuntimeResolver;
		const installations = yield* PluginInstallationRepository;

		const dispatchAll = Effect.fn("PluginUserBootstrapDispatcher.dispatchAll")(function* (
			userId: UserId,
			accountGeneration: AccountGeneration,
			generation?: string,
		) {
			const installed = new Set(
				(yield* installations.listSystemForUser(userId)).map(({ pluginId }) => pluginId),
			);
			const entries = (yield* runtime.listSystemUserBootstraps()).filter(({ pluginId }) =>
				installed.has(pluginId),
			);

			for (const entry of entries) {
				const resolved = yield* runtime.resolveActivePluginUserBootstrap({
					pluginSlug: entry.pluginSlug,
					bootstrapSlug: entry.bootstrap.slug,
				});
				if (!resolved) {
					return yield* new SandboxRunError({
						kind: "script-failure",
						message: `Plugin user bootstrap script not found: ${entry.pluginSlug}/${entry.bootstrap.slug}`,
					});
				}
				const executionId = userBootstrapExecutionId(
					userId,
					entry.pluginSlug,
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
								message: `Plugin user bootstrap failed: ${entry.pluginSlug}/${entry.bootstrap.slug}: ${error.message}`,
							}),
					),
				);
				if (result.error) {
					return yield* new SandboxRunError({
						kind: "script-failure",
						message: `Plugin user bootstrap failed: ${entry.pluginSlug}/${entry.bootstrap.slug}: ${result.error.message}`,
					});
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
