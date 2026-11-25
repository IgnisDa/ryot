import { pluginPath } from "@ryot-app/contract/modules/plugins/navigation";
import { isEntitled } from "@ryot-app/contract/schema/entitlement";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect, Stream } from "effect";
import { useEffect, useMemo } from "react";

import { PluginsApi } from "#/api/plugins";
import { KernelRyotProvider } from "#/api/ryot-client-provider";
import { protectedRouteGuard } from "#/modules/auth/route-gates";
import { AuthService } from "#/modules/auth/service";
import { BackgroundSubmissionsProvider } from "#/modules/background-submissions/tray";
import { EntitlementsProvider } from "#/modules/entitlements/context";
import { loadEntitlements } from "#/modules/entitlements/service";
import { EntityWatchService } from "#/modules/entity-watches/service";
import { AuthenticatedMessages } from "#/modules/i18n/authenticated-messages";
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
				const [catalog, navigation, rememberedPluginId, entitlements] = yield* Effect.all(
					[
						Effect.flatMap(PluginCatalogService, (service) => service.load(context.ryot)),
						Effect.flatMap(NavigationService, (service) => service.load(context.ryot)),
						Effect.flatMap(ClientStorage, (service) => service.getLastWorkspace(context.scope)),
						loadEntitlements(context.server),
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
						throw redirect({ replace: true, href: pluginPath(selected.packageId) });
					}
				}
				return { catalog, navigation, entitlements, rememberedPluginId };
			}),
			{ signal: abortController.signal },
		),
	// oxlint-disable-next-line perfectionist/sort-objects -- TanStack derives route context in declaration order.
	shouldReload: ({ location }) => location.pathname === "/",
});

function RestoringSession() {
	const t = useT();
	usePageTitle(t(kernelMessage("client.route.authenticated.restoring-title")));
	return (
		<main {...mainContentProps} className="ui-page">
			<section
				aria-labelledby="session-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 id="session-title" className="ui-heading">
						{t(kernelMessage("client.route.authenticated.restoring-heading"))}
					</h1>
					<p role="status" className="ui-subtitle">
						{t(kernelMessage("client.route.authenticated.restoring-detail"))}
					</p>
				</div>
			</section>
		</main>
	);
}

function AuthenticatedLoadError() {
	const t = useT();
	usePageTitle(t(kernelMessage("client.route.authenticated.load-failed-title")));
	return (
		<main {...mainContentProps} className="ui-page">
			<section
				aria-labelledby="authenticated-load-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 className="ui-heading" id="authenticated-load-title">
						{t(kernelMessage("client.route.authenticated.load-failed-title"))}
					</h1>
					<p role="alert" className="ui-subtitle">
						{t(kernelMessage("client.route.authenticated.load-failed-detail"))}
					</p>
				</div>
			</section>
		</main>
	);
}

function AuthenticatedLayout() {
	const { catalog, navigation, entitlements, rememberedPluginId } = Route.useLoaderData();
	const { ryot, i18n, scope, runtime, ryotClients, hostServices } = Route.useRouteContext();
	const { userId, serverUrl } = scope;
	const session = runtime.runSync(AuthService).session(serverUrl).getSnapshot();
	const canInitializeLocale =
		session.status === "authenticated" &&
		session.accessClass === "standard" &&
		session.impersonation === undefined;
	useEffect(
		() =>
			runtime.runSync(
				Effect.map(EntityWatchService, (service) => service.acquire({ userId, serverUrl })),
			),
		[runtime, serverUrl, userId],
	);
	useEffect(() => {
		const controller = new AbortController();
		runtime.runFork(
			Effect.flatMap(EntityWatchService, (service) =>
				Stream.runForEach(service.derivedDataUpdates({ userId, serverUrl }), () =>
					Effect.sync(ryot.mutationCompleted.hint),
				),
			),
			{ signal: controller.signal },
		);
		return () => controller.abort();
	}, [runtime, ryot, serverUrl, userId]);
	const loadPluginCatalogs = useMemo(
		() =>
			runtime.runSync(
				Effect.map(
					PluginsApi,
					(api) => (locale: string) =>
						Effect.map(api.messages({ userId, serverUrl }, locale), ({ catalogs }) => catalogs),
				),
			),
		[runtime, serverUrl, userId],
	);
	const rememberInterfaceLocale = (preference: null | string) =>
		runtime.runSync(
			Effect.flatMap(ClientStorage, (storage) => storage.setInterfaceLocale(preference)),
		);
	return (
		<EntitlementsProvider entitlements={entitlements}>
			<KernelRyotProvider client={ryot} store={ryotClients} hostServices={hostServices}>
				<PluginCatalogProvider scope={scope} runtime={runtime} initialCatalog={catalog}>
					<AuthenticatedMessages
						store={i18n}
						load={loadPluginCatalogs}
						fallback={<RestoringSession />}
						canInitializeLocale={canInitializeLocale}
						onInterfaceLocale={rememberInterfaceLocale}
					>
						<BackgroundSubmissionsProvider
							scope={scope}
							runtime={runtime}
							onSucceeded={ryot.mutationCompleted.hint}
						>
							<AuthenticatedShell
								navigation={navigation}
								isPro={isEntitled(entitlements, "pro")}
								initialRememberedPluginId={rememberedPluginId}
							/>
						</BackgroundSubmissionsProvider>
					</AuthenticatedMessages>
				</PluginCatalogProvider>
			</KernelRyotProvider>
		</EntitlementsProvider>
	);
}
