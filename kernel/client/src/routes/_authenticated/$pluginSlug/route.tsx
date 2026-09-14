import { createFileRoute, notFound } from "@tanstack/react-router";
import { Effect } from "effect";

import {
	useClearClientPageDocument,
	useClientPageDocument,
	useHasPublishedClientPageDocument,
} from "#/modules/client-pages/document";
import { prepareClientPage } from "#/modules/client-pages/preparation";
import { AppScreen } from "#/modules/navigation/app-screen";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { toPluginLocation } from "#/modules/plugins/plugin-location";

export const Route = createFileRoute("/_authenticated/$pluginSlug")({
	shouldReload: true,
	component: PluginRoute,
	pendingComponent: PluginPending,
	notFoundComponent: PluginNotFound,
	errorComponent: () => <PluginNotice clear title="Plugin page unavailable" />,
	loader: async ({ params, context, location, abortController }) => {
		const catalog = await context.runtime.runPromise(
			Effect.flatMap(PluginCatalogService, (service) => service.load(context.ryot)),
			{ signal: abortController.signal },
		);
		const installation = catalog.find((candidate) => candidate.slug === params.pluginSlug);
		if (installation === undefined) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw notFound();
		}
		const pluginLocation = toPluginLocation(
			params.pluginSlug,
			location.pathname,
			location.searchStr,
		);
		const target =
			pluginLocation.path === "/" && installation.homeSavedViewId !== null
				? ({ kind: "saved-view", savedViewId: installation.homeSavedViewId } as const)
				: ({
						kind: "plugin-route",
						path: pluginLocation.path,
						search: pluginLocation.search,
						pluginId: installation.pluginId,
					} as const);
		const preparation = await context.runtime.runPromise(prepareClientPage(context.scope, target), {
			signal: abortController.signal,
		});
		return { preparation, installation };
	},
});

function PluginRoute() {
	const loaded = Route.useLoaderData();
	if (loaded.preparation.kind === "unavailable") {
		return <PluginNotice clear title="Plugin page not found" />;
	}
	return <PluginDocument title={loaded.installation.name} prepared={loaded.preparation.prepared} />;
}

function PluginDocument(props: Parameters<typeof useClientPageDocument>[0]) {
	useClientPageDocument(props);
	return null;
}

function PluginPending() {
	return useHasPublishedClientPageDocument() ? null : <PluginNotice title="Plugin loading" />;
}

function PluginNotice(props: { readonly title: string; readonly clear?: boolean }) {
	if (props.clear) {
		return <ClearedPluginNotice title={props.title} />;
	}
	return <AppScreen title={props.title}>{null}</AppScreen>;
}

function ClearedPluginNotice(props: { readonly title: string }) {
	useClearClientPageDocument();
	return <AppScreen title={props.title}>{null}</AppScreen>;
}

function PluginNotFound() {
	useClearClientPageDocument();
	usePageTitle("Plugin not found");
	return (
		<main {...mainContentProps} className="ui-page">
			<section
				aria-labelledby="plugin-route-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 className="ui-heading" id="plugin-route-title">
						Plugin not found
					</h1>
					<p role="status" className="ui-subtitle">
						This page does not exist.
					</p>
				</div>
			</section>
		</main>
	);
}
