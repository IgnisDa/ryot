import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { ClientPageHost } from "#/modules/client-pages/page-host";
import { prepareClientPage } from "#/modules/client-pages/preparation";
import { AppScreen } from "#/modules/navigation/app-screen";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { toPluginLocation } from "#/modules/plugins/plugin-location";

export const Route = createFileRoute("/_authenticated/$pluginSlug")({
	component: PluginRoute,
	notFoundComponent: PluginNotFound,
	pendingComponent: () => <PluginNotice title="Plugin loading" />,
	shouldReload: true,
	loader: async ({ abortController, context, location, params }) => {
		const catalog = await context.runtime.runPromise(
			Effect.flatMap(PluginCatalogService, (service) => service.load(context.ryot)),
			{ signal: abortController.signal },
		);
		const installation = catalog.find((candidate) => candidate.slug === params.pluginSlug);
		if (installation === undefined) {
			return { kind: "missing" as const };
		}
		const pluginLocation = toPluginLocation(
			params.pluginSlug,
			location.pathname,
			location.searchStr,
		);
		const preparation = await context.runtime.runPromise(
			prepareClientPage(context.scope, {
				kind: "plugin-route",
				path: pluginLocation.path,
				search: pluginLocation.search,
				pluginId: installation.pluginId,
			}),
			{ signal: abortController.signal },
		);
		return { installation, preparation, kind: "resolved" as const };
	},
});

function PluginRoute() {
	const loaded = Route.useLoaderData();
	if (loaded.kind === "missing") {
		return <PluginNotFound />;
	}
	if (loaded.preparation.kind === "unavailable") {
		return <PluginNotice title="Plugin page not found" />;
	}
	return <ClientPageHost title={loaded.installation.name} prepared={loaded.preparation.prepared} />;
}

function PluginNotice(props: { readonly title: string }) {
	return <AppScreen title={props.title}>{null}</AppScreen>;
}

function PluginNotFound() {
	usePageTitle("Plugin not found");
	return (
		<main {...mainContentProps} className="ui-page">
			<section
				aria-labelledby="plugin-route-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 id="plugin-route-title" className="ui-heading">
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
