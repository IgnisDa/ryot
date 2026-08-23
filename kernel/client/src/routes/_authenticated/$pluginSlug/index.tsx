import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { createFileRoute } from "@tanstack/react-router";

import { prepareClientPage } from "#/modules/client-pages/preparation";

import { PluginRoutePage } from "./route";

export const Route = createFileRoute("/_authenticated/$pluginSlug/")({
	shouldReload: false,
	component: PluginIndex,
	loaderDeps: ({ search }) => search,
	loader: ({ params, context, location, abortController }) =>
		context.runtime.runPromise(
			prepareClientPage(context.scope, {
				path: "/",
				kind: "plugin-route",
				search: location.searchStr.replace(/^\?/, ""),
				pluginSlug: PluginSlug.make(params.pluginSlug),
			}),
			{ signal: abortController.signal },
		),
});

function PluginIndex() {
	return (
		<PluginRoutePage
			preparation={Route.useLoaderData()}
			pluginSlug={Route.useParams().pluginSlug}
		/>
	);
}
