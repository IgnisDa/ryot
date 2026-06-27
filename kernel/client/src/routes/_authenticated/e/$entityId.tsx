import { createFileRoute } from "@tanstack/react-router";

import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";

export const Route = createFileRoute("/_authenticated/e/$entityId")({
	component: EntityPage,
});

function EntityPage() {
	usePageTitle("Entity");
	return (
		<main {...mainContentProps} className="ui-page">
			TODO: Render the entity page.
		</main>
	);
}
