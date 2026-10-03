import { PluginId } from "@ryot-app/contract/schema/brands";
import { createFileRoute } from "@tanstack/react-router";

import { prepareClientPage } from "#/modules/client-pages/preparation";
import { toPluginLocation } from "#/modules/plugins/plugin-location";

import { PluginRoutePage } from "./route";

export const Route = createFileRoute("/_authenticated/p/$pluginId/$")({
	shouldReload: false,
	component: PluginSplat,
	loaderDeps: ({ search }) => search,
	loader: ({ params, context, location, abortController }) => {
		const { path, search } = toPluginLocation(
			params.pluginId,
			location.pathname,
			location.searchStr,
		);
		return context.runtime.runPromise(
			prepareClientPage(context.scope, {
				path,
				search,
				kind: "plugin-route",
				pluginId: PluginId.make(params.pluginId),
			}),
			{ signal: abortController.signal },
		);
	},
});

function PluginSplat() {
	return (
		<PluginRoutePage preparation={Route.useLoaderData()} pluginId={Route.useParams().pluginId} />
	);
}
