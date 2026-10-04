import { pluginPackageIdFromSegments } from "@ryot-app/contract/schema/brands";
import { createFileRoute } from "@tanstack/react-router";

import { prepareClientPage } from "#/modules/client-pages/preparation";
import { toPluginLocation } from "#/modules/plugins/plugin-location";

import { PluginRoutePage } from "./route";

export const Route = createFileRoute("/_authenticated/p/$publisher/$name/$")({
	shouldReload: false,
	component: PluginSplat,
	loaderDeps: ({ search }) => search,
	loader: ({ params, context, location, abortController }) => {
		const packageId = pluginPackageIdFromSegments(params);
		const { path, search } = toPluginLocation(packageId, location.pathname, location.searchStr);
		return context.runtime.runPromise(
			prepareClientPage(context.scope, { path, search, packageId, kind: "plugin-route" }),
			{ signal: abortController.signal },
		);
	},
});

function PluginSplat() {
	return (
		<PluginRoutePage
			preparation={Route.useLoaderData()}
			packageId={pluginPackageIdFromSegments(Route.useParams())}
		/>
	);
}
