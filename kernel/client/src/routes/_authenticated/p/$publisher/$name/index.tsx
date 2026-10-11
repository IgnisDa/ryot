import { pluginPackageIdFromSegments } from "@ryot-app/contract/schema/brands";
import { createFileRoute } from "@tanstack/react-router";

import { prepareClientPage } from "#/modules/pages/preparation/prepare";

import { PluginRoutePage } from "./route";

export const Route = createFileRoute("/_authenticated/p/$publisher/$name/")({
	shouldReload: false,
	component: PluginIndex,
	loaderDeps: ({ search }) => search,
	loader: ({ params, context, location, abortController }) =>
		context.runtime.runPromise(
			prepareClientPage(context.scope, {
				path: "/",
				kind: "plugin-route",
				search: location.searchStr.replace(/^\?/, ""),
				packageId: pluginPackageIdFromSegments(params),
			}),
			{ signal: abortController.signal },
		),
});

function PluginIndex() {
	return (
		<PluginRoutePage
			preparation={Route.useLoaderData()}
			packageId={pluginPackageIdFromSegments(Route.useParams())}
		/>
	);
}
