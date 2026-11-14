import { savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import { SavedViewId } from "@ryot-app/contract/schema/brands";
import { createFileRoute } from "@tanstack/react-router";

import { loadSavedView, SavedViewPage, savedViewRouteOptions } from "../-saved-view-page";

export const Route = createFileRoute("/_authenticated/v/c/$savedViewId")({
	...savedViewRouteOptions,
	component: CustomSavedView,
	loader: ({ params, context, abortController }) => {
		const reference = {
			kind: "custom",
			savedViewId: SavedViewId.make(params.savedViewId),
		} as const;
		return context.runtime.runPromise(
			loadSavedView(context.scope, reference, savedViewPath(reference)),
			{ signal: abortController.signal },
		);
	},
});

function CustomSavedView() {
	return <SavedViewPage search={Route.useSearch()} loaded={Route.useLoaderData()} />;
}
