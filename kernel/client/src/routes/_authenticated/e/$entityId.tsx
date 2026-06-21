import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/e/$entityId")({
	component: EntityPage,
});

function EntityPage() {
	return <main className="ui-page">TODO: Render the entity page.</main>;
}
