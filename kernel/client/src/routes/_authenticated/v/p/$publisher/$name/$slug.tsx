import { savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import { PluginId, pluginPackageIdFromSegments } from "@ryot-app/contract/schema/brands";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Effect } from "effect";

import { effectiveCatalogPlugin } from "#/modules/plugins/catalog/location";
import { PluginCatalogService } from "#/modules/plugins/catalog/service";

import { loadSavedView, SavedViewPage, savedViewRouteOptions } from "../../../-saved-view-page";

export const Route = createFileRoute("/_authenticated/v/p/$publisher/$name/$slug")({
	...savedViewRouteOptions,
	component: PluginSavedView,
	loader: ({ params, context, abortController }) =>
		context.runtime.runPromise(
			Effect.gen(function* () {
				const packageId = pluginPackageIdFromSegments(params);
				const plugin = effectiveCatalogPlugin(
					yield* Effect.flatMap(PluginCatalogService, (service) => service.load(context.ryot)),
					packageId,
				);
				if (!plugin) {
					// oxlint-disable-next-line typescript/only-throw-error
					throw notFound();
				}
				return yield* loadSavedView(
					context.scope,
					{ kind: "plugin", slug: params.slug, pluginId: PluginId.make(plugin.pluginId) },
					savedViewPath({ packageId, kind: "plugin", slug: params.slug }),
				);
			}),
			{ signal: abortController.signal },
		),
});

function PluginSavedView() {
	return <SavedViewPage search={Route.useSearch()} loaded={Route.useLoaderData()} />;
}
