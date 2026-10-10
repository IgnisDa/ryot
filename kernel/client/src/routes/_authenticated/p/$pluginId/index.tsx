import { PluginId } from "@ryot-app/contract/schema/brands";
import { createFileRoute } from "@tanstack/react-router";

import { prepareClientPage } from "#/modules/client-pages/preparation";

import { PluginRoutePage } from "./route";

export const Route = createFileRoute("/_authenticated/p/$pluginId/")({
	shouldReload: false,
	component: PluginIndex,
	loaderDeps: ({ search }) => search,
	loader: ({ params, context, location, abortController }) =>
		context.runtime.runPromise(
			prepareClientPage(context.scope, {
				path: "/",
				kind: "plugin-route",
				pluginId: PluginId.make(params.pluginId),
				search: location.searchStr.replace(/^\?/, ""),
			}),
			{ signal: abortController.signal },
		),
});

function PluginIndex() {
	return (
		<PluginRoutePage preparation={Route.useLoaderData()} pluginId={Route.useParams().pluginId} />
	);
}
