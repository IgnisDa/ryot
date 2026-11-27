import { createFileRoute } from "@tanstack/react-router";

import { PublicationVisit } from "#/modules/publications/visit";

export const Route = createFileRoute("/share/$publicationId")({ component: SharedPublication });

function SharedPublication() {
	const { publicationId } = Route.useParams();
	const { theme, runtime, backInterceptors } = Route.useRouteContext();
	return (
		<PublicationVisit
			theme={theme}
			runtime={runtime}
			key={publicationId}
			publicationId={publicationId}
			backInterceptors={backInterceptors}
		/>
	);
}
