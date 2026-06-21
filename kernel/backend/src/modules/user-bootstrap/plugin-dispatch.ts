import { SandboxRunError } from "@ryot-app/contract/errors";
import type { SandboxExecutionPayload } from "@ryot-app/contract/modules/sandbox/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { findPluginEntryById, PluginLoader } from "#modules/plugins/loader";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { SandboxExecutionService } from "#modules/sandbox/service";

export const userBootstrapExecutionId = (
	userId: string,
	pluginSlug: string,
	bootstrapSlug: string,
) =>
	`user-bootstrap-${userId.length}-${userId}-${pluginSlug.length}-${pluginSlug}-${bootstrapSlug.length}-${bootstrapSlug}`;

export const makePluginUserBootstrapDispatcher = (
	execute: (
		payload: SandboxExecutionPayload,
	) => Effect.Effect<{ readonly error: null | { readonly message: string } }, unknown>,
) =>
	Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const runtime = yield* PluginRuntimeResolver;
		const installations = yield* PluginInstallationRepository;

		const dispatchAll = Effect.fn("PluginUserBootstrapDispatcher.dispatchAll")(function* (
			userId: UserId,
		) {
			const snapshot = loader.getSnapshot();
			const installed = yield* installations.listSystemForUser(userId);
			const entries = installed
				.flatMap((installation) => {
					const plugin = findPluginEntryById(snapshot, installation.pluginId);
					return plugin
						? plugin.manifest.userBootstrap.map((bootstrap) => ({
								bootstrap,
								pluginSlug: plugin.slug,
							}))
						: [];
				})
				.sort(
					(left, right) =>
						left.pluginSlug.localeCompare(right.pluginSlug) ||
						left.bootstrap.slug.localeCompare(right.bootstrap.slug),
				);

			for (const entry of entries) {
				const resolved = yield* runtime.resolveActivePluginUserBootstrap({
					pluginSlug: entry.pluginSlug,
					bootstrapSlug: entry.bootstrap.slug,
				});
				if (!resolved) {
					return yield* new SandboxRunError({
						message: `Plugin user bootstrap script not found: ${entry.pluginSlug}/${entry.bootstrap.slug}`,
					});
				}
				const executionId = userBootstrapExecutionId(
					userId,
					entry.pluginSlug,
					entry.bootstrap.slug,
				);
				const result = yield* execute({
					context: {},
					executionId,
					scriptId: resolved.script.id,
					subject: { type: "user", userId },
				}).pipe(
					Effect.mapError(
						(error) =>
							new SandboxRunError({
								message: `Plugin user bootstrap failed: ${entry.pluginSlug}/${entry.bootstrap.slug}: ${String(error)}`,
							}),
					),
				);
				if (result.error) {
					return yield* new SandboxRunError({
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
			const loader = yield* PluginLoader;
			const sandbox = yield* SandboxExecutionService;
			const runtime = yield* PluginRuntimeResolver;
			const installations = yield* PluginInstallationRepository;
			return yield* makePluginUserBootstrapDispatcher((payload) =>
				sandbox.executeScript({
					input: payload.context,
					subject: payload.subject,
					scriptId: payload.scriptId,
					executionId: payload.executionId,
				}),
			).pipe(
				Effect.provideService(PluginLoader, loader),
				Effect.provideService(PluginRuntimeResolver, runtime),
				Effect.provideService(PluginInstallationRepository, installations),
			);
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
