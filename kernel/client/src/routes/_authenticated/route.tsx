import { RyotProvider } from "@ryot/client-sdk/react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect } from "effect";

import { PublicApi } from "#/api/public";
import { createKernelRyotClient } from "#/api/ryot-client";
import { protectedRouteGuard } from "#/modules/auth/route-gates";
import { AuthenticatedShell } from "#/modules/navigation/authenticated-shell";
import { resolveRememberedWorkspace } from "#/modules/navigation/workspace-state";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { PluginCatalogProvider } from "#/modules/plugins/catalog-provider";
import { ClientStorage } from "#/persistence/storage";

export const Route = createFileRoute("/_authenticated")({
	component: AuthenticatedLayout,
	errorComponent: AuthenticatedLoadError,
	beforeLoad: ({ context, location }) => protectedRouteGuard(context, location.href),
	loader: async ({ abortController, context, location }) => {
		const ryot = createKernelRyotClient(context.runtime, context.scope, context.theme);
		const [catalog, rememberedSlug, isPro] = await Promise.all([
			context.runtime.runPromise(
				Effect.flatMap(PluginCatalogService, (service) => service.load(ryot)),
				{ signal: abortController.signal },
			),
			context.runtime.runPromise(
				Effect.flatMap(ClientStorage, (service) => service.getLastWorkspace(context.scope)),
				{ signal: abortController.signal },
			),
			context.runtime.runPromise(
				Effect.flatMap(PublicApi, (api) =>
					api.getSystemConfig(context.server).pipe(
						Effect.match({
							onFailure: () => false,
							onSuccess: (config) => config.pro.isServerKeyValidated,
						}),
					),
				),
				{ signal: abortController.signal },
			),
		]);
		if (location.pathname === "/") {
			const selected = resolveRememberedWorkspace(catalog, rememberedSlug);
			if (selected !== null) {
				if (selected.slug !== rememberedSlug) {
					await context.runtime.runPromise(
						Effect.flatMap(ClientStorage, (service) =>
							service.setLastWorkspace(context.scope, selected.slug),
						),
						{ signal: abortController.signal },
					);
				}
				// oxlint-disable-next-line typescript/only-throw-error
				throw redirect({
					replace: true,
					to: "/$pluginSlug",
					params: { pluginSlug: selected.slug },
				});
			}
		}
		return { catalog, isPro, rememberedSlug, ryot };
	},
	shouldReload: ({ location }) => location.pathname === "/",
});

function AuthenticatedLayout() {
	const { catalog, isPro, rememberedSlug, ryot } = Route.useLoaderData();
	const { runtime, scope } = Route.useRouteContext();
	return (
		<RyotProvider client={ryot}>
			<PluginCatalogProvider scope={scope} runtime={runtime} initialCatalog={catalog}>
				<AuthenticatedShell isPro={isPro} initialRememberedSlug={rememberedSlug} />
			</PluginCatalogProvider>
		</RyotProvider>
	);
}

function AuthenticatedLoadError() {
	return (
		<main className="ui-page">
			<section
				aria-labelledby="authenticated-load-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 id="authenticated-load-title" className="ui-heading">
						Workspaces unavailable
					</h1>
					<p role="alert" className="ui-subtitle">
						Your workspaces could not be loaded.
					</p>
				</div>
			</section>
		</main>
	);
}
