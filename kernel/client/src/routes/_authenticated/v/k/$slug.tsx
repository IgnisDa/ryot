import { savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import { createFileRoute } from "@tanstack/react-router";

import { loadSavedView, SavedViewPage, savedViewRouteOptions } from "../-saved-view-page";

export const Route = createFileRoute("/_authenticated/v/k/$slug")({
	...savedViewRouteOptions,
	component: KernelSavedView,
	loader: ({ params, context, abortController }) => {
		const reference = { kind: "kernel", slug: params.slug } as const;
		return context.runtime.runPromise(
			loadSavedView(context.scope, reference, savedViewPath(reference)),
			{ signal: abortController.signal },
		);
	},
});

function KernelSavedView() {
	return <SavedViewPage search={Route.useSearch()} loaded={Route.useLoaderData()} />;
}
