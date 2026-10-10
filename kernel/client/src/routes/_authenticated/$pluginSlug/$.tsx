import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { createFileRoute } from "@tanstack/react-router";

import { prepareClientPage } from "#/modules/client-pages/preparation";
import { toPluginLocation } from "#/modules/plugins/plugin-location";

import { PluginRoutePage } from "./route";

export const Route = createFileRoute("/_authenticated/$pluginSlug/$")({
	shouldReload: false,
	component: PluginSplat,
	loaderDeps: ({ search }) => search,
	loader: ({ params, context, location, abortController }) => {
		const { path, search } = toPluginLocation(
			params.pluginSlug,
			location.pathname,
			location.searchStr,
		);
		return context.runtime.runPromise(
			prepareClientPage(context.scope, {
				path,
				search,
				kind: "plugin-route",
				pluginSlug: PluginSlug.make(params.pluginSlug),
			}),
			{ signal: abortController.signal },
		);
	},
});

function PluginSplat() {
	return (
		<PluginRoutePage
			preparation={Route.useLoaderData()}
			pluginSlug={Route.useParams().pluginSlug}
		/>
	);
}
