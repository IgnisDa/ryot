import { createFileRoute } from "@tanstack/react-router";
import { SavedViewPage } from "#/features/saved-views/view-page";

export const Route = createFileRoute("/_protected/views/$viewId")({
	component: RouteComponent,
});

function RouteComponent() {
	const { viewId } = Route.useParams();
	return <SavedViewPage viewId={viewId} />;
}
