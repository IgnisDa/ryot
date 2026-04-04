import { SandboxRunError } from "@ryot/contract/errors";
import type { SandboxExecutionPayload } from "@ryot/contract/modules/sandbox/schemas";
import type { UserId } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { bootConfiguredPluginSlugs } from "#modules/plugins/boot-sources";
import { PluginLoader } from "#modules/plugins/loader";
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
		const runWithDb = yield* DbRunner;
		const loader = yield* PluginLoader;
		const runtime = yield* PluginRuntimeResolver;

		const dispatchAll = Effect.fn("PluginUserBootstrapDispatcher.dispatchAll")(function* (
			userId: UserId,
		) {
			const entries = Object.entries(loader.getSnapshot().plugins)
				.filter(([pluginSlug]) => bootConfiguredPluginSlugs.has(pluginSlug))
				.flatMap(([pluginSlug, plugin]) =>
					plugin.manifest.userBootstrap.map((bootstrap) => ({ bootstrap, pluginSlug })),
				)
				.sort(
					(left, right) =>
						left.pluginSlug.localeCompare(right.pluginSlug) ||
						left.bootstrap.slug.localeCompare(right.bootstrap.slug),
				);

			for (const entry of entries) {
				const resolved = yield* runWithDb(
					runtime.resolveActivePluginUserBootstrap({
						pluginSlug: entry.pluginSlug,
						bootstrapSlug: entry.bootstrap.slug,
					}),
				);
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
					authority: { type: "user", userId },
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
			const runWithDb = yield* DbRunner;
			const loader = yield* PluginLoader;
			const sandbox = yield* SandboxExecutionService;
			const runtime = yield* PluginRuntimeResolver;
			return yield* makePluginUserBootstrapDispatcher((payload) =>
				sandbox.executeScript({
					input: payload.context,
					scriptId: payload.scriptId,
					authority: payload.authority,
					executionId: payload.executionId,
				}),
			).pipe(
				Effect.provideService(DbRunner, runWithDb),
				Effect.provideService(PluginLoader, loader),
				Effect.provideService(PluginRuntimeResolver, runtime),
			);
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
