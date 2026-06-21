import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/v/$viewSlug")({
	component: SavedViewPage,
});

function SavedViewPage() {
	return <main className="ui-page">TODO: Render the saved view page.</main>;
}
