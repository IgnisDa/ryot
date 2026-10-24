import { pluginPath } from "@ryot-app/contract/modules/plugins/navigation";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect } from "react";

import { PublicApi } from "#/api/public";
import { KernelRyotProvider } from "#/api/ryot-client-provider";
import { protectedRouteGuard } from "#/modules/auth/route-gates";
import { EntityWatchService } from "#/modules/entity-watches/service";
import { usePageTitle } from "#/modules/navigation/page-title";
import { NavigationService } from "#/modules/navigation/service";
import { mainContentProps } from "#/modules/navigation/skip-link";
import { resolveRememberedWorkspace } from "#/modules/navigation/workspace-state";
import { PluginCatalogProvider } from "#/modules/plugins/catalog/provider";
import { PluginCatalogService } from "#/modules/plugins/catalog/service";
import { AuthenticatedShell } from "#/modules/shell/authenticated-shell";
import { ClientStorage } from "#/persistence/storage";

export const Route = createFileRoute("/_authenticated")({
	component: AuthenticatedLayout,
	pendingComponent: RestoringSession,
	errorComponent: AuthenticatedLoadError,
	beforeLoad: ({ context, location }) =>
		context.runtime.runPromise(
			protectedRouteGuard(location.href).pipe(
				Effect.map((authenticated) => {
					const entry = context.ryotClients.get(authenticated.scope);
					return { ...authenticated, ryot: entry.client, hostServices: entry.hostServices };
				}),
			),
		),
	loader: ({ context, location, abortController }) =>
		context.runtime.runPromise(
			Effect.gen(function* () {
				const [catalog, navigation, rememberedPluginId, isPro] = yield* Effect.all(
					[
						Effect.flatMap(PluginCatalogService, (service) => service.load(context.ryot)),
						Effect.flatMap(NavigationService, (service) => service.load(context.ryot)),
						Effect.flatMap(ClientStorage, (service) => service.getLastWorkspace(context.scope)),
						Effect.flatMap(PublicApi, (api) => api.getSystemConfig(context.server)).pipe(
							Effect.match({
								onFailure: () => false,
								onSuccess: (config) => config.pro.isServerKeyValidated,
							}),
						),
					],
					{ concurrency: "unbounded" },
				);
				if (location.pathname === "/") {
					const selected = resolveRememberedWorkspace(catalog, rememberedPluginId);
					if (selected !== null) {
						if (selected.pluginId !== rememberedPluginId) {
							yield* Effect.flatMap(ClientStorage, (service) =>
								service.setLastWorkspace(context.scope, selected.pluginId),
							);
						}
						// oxlint-disable-next-line typescript/only-throw-error
						throw redirect({ replace: true, href: pluginPath(selected.packageId) });
					}
				}
				return { isPro, catalog, navigation, rememberedPluginId };
			}),
			{ signal: abortController.signal },
		),
	// oxlint-disable-next-line perfectionist/sort-objects -- TanStack derives route context in declaration order.
	shouldReload: ({ location }) => location.pathname === "/",
});

function AuthenticatedLayout() {
	const { isPro, catalog, navigation, rememberedPluginId } = Route.useLoaderData();
	const { ryot, scope, runtime, hostServices } = Route.useRouteContext();
	const { userId, serverUrl } = scope;
	useEffect(
		() =>
			runtime.runSync(
				Effect.map(EntityWatchService, (service) => service.acquire({ userId, serverUrl })),
			),
		[runtime, serverUrl, userId],
	);
	return (
		<KernelRyotProvider client={ryot} hostServices={hostServices}>
			<PluginCatalogProvider scope={scope} runtime={runtime} initialCatalog={catalog}>
				<AuthenticatedShell
					isPro={isPro}
					navigation={navigation}
					initialRememberedPluginId={rememberedPluginId}
				/>
			</PluginCatalogProvider>
		</KernelRyotProvider>
	);
}

function RestoringSession() {
	usePageTitle("Restoring session");
	return (
		<main {...mainContentProps} className="ui-page">
			<section
				aria-labelledby="session-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 id="session-title" className="ui-heading">
						Restoring your session
					</h1>
					<p role="status" className="ui-subtitle">
						Checking your signed-in state...
					</p>
				</div>
			</section>
		</main>
	);
}

function AuthenticatedLoadError() {
	usePageTitle("Workspaces unavailable");
	return (
		<main {...mainContentProps} className="ui-page">
			<section
				aria-labelledby="authenticated-load-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 className="ui-heading" id="authenticated-load-title">
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
