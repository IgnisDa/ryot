import { createFileRoute } from "@tanstack/react-router";

import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";
import { usePluginCatalog } from "#/modules/plugins/catalog-provider";
import { resolveRouteTarget } from "#/modules/plugins/route-resolver";

export const Route = createFileRoute("/_authenticated/$pluginSlug")({
	shouldReload: false,
	component: PluginRoute,
	notFoundComponent: PluginNotFound,
});

function PluginRoute() {
	const { pluginSlug } = Route.useParams();
	const { catalog } = usePluginCatalog();
	return resolveRouteTarget(catalog, pluginSlug).owner === "plugin" ? null : <PluginNotFound />;
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
