import { EntityId } from "@ryot-app/contract/schema/brands";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { useCollectionScreens } from "#/modules/collections/screens";
import { useClearClientPageDocument, useClientPageDocument } from "#/modules/pages/documents/state";
import { ClientPagePending } from "#/modules/pages/loading";
import { prepareClientPage } from "#/modules/pages/preparation/prepare";
import { AppScreen } from "#/modules/shell/app-screen";

export const Route = createFileRoute("/_authenticated/e/$entityId")({
	staleTime: 30_000,
	component: EntityPage,
	errorComponent: EntityError,
	pendingComponent: ClientPagePending,
	loader: ({ params, context, abortController }) =>
		context.runtime.runPromise(
			prepareClientPage(context.scope, {
				kind: "entity",
				entityId: EntityId.make(params.entityId),
			}).pipe(Effect.map((preparation) => ({ preparation }))),
			{ signal: abortController.signal },
		),
});

function EntityPage() {
	const { preparation } = Route.useLoaderData();
	if (preparation.kind === "ready") {
		return <EntityDocument prepared={preparation.prepared} />;
	}
	if (preparation.reason.code === "entity-not-found") {
		return <EntityNotice title="Entity not found" />;
	}
	if (preparation.reason.code === "entity-detail-page-not-registered") {
		return <EntityNotice title="Entity page not registered" />;
	}
	return <EntityNotice title="Required plugin unavailable" />;
}

function EntityDocument(props: {
	readonly prepared: Parameters<typeof useClientPageDocument>[0]["prepared"];
}) {
	const collections = useCollectionScreens();
	useClientPageDocument({
		title: "Entity details",
		inert: collections.open,
		prepared: props.prepared,
		onEditCollection: collections.onEditCollection,
		onAddToCollection: collections.onAddToCollection,
	});
	return collections.screen;
}

function EntityError() {
	return <EntityNotice title="Retryable entity load failure" />;
}

function EntityNotice(props: { readonly title: string }) {
	useClearClientPageDocument();
	return <AppScreen title={props.title}>{null}</AppScreen>;
}
