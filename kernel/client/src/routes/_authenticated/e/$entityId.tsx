import { EntityId } from "@ryot-app/contract/schema/brands";
import { createFileRoute } from "@tanstack/react-router";

import {
	useClearClientPageDocument,
	useClientPageDocument,
	useHasPublishedClientPageDocument,
} from "#/modules/client-pages/document";
import { prepareClientPage } from "#/modules/client-pages/preparation";
import { AppScreen } from "#/modules/navigation/app-screen";

export const Route = createFileRoute("/_authenticated/e/$entityId")({
	staleTime: 30_000,
	component: EntityPage,
	errorComponent: EntityError,
	pendingComponent: EntityPending,
	loader: async ({ params, context, abortController }) => {
		const preparation = await context.runtime.runPromise(
			prepareClientPage(context.scope, {
				kind: "entity",
				entityId: EntityId.make(params.entityId),
			}),
			{ signal: abortController.signal },
		);
		return { preparation };
	},
});

function EntityPage() {
	const { preparation } = Route.useLoaderData();
	if (preparation.kind === "ready") {
		return <EntityDocument prepared={preparation.prepared} />;
	}
	if (preparation.reason.code === "entity-not-found") {
		return <EntityNotice clear title="Entity not found" />;
	}
	if (preparation.reason.code === "entity-detail-page-not-registered") {
		return <EntityNotice clear title="Entity page not registered" />;
	}
	return <EntityNotice clear title="Required plugin unavailable" />;
}

function EntityDocument(props: {
	readonly prepared: Parameters<typeof useClientPageDocument>[0]["prepared"];
}) {
	useClientPageDocument({ title: "Entity details", prepared: props.prepared });
	return null;
}

function EntityPending() {
	if (useHasPublishedClientPageDocument()) {
		return null;
	}
	return <EntityNotice title="Entity loading" />;
}

function EntityError() {
	return <EntityNotice clear title="Retryable entity load failure" />;
}

function EntityNotice(props: { readonly title: string; readonly clear?: boolean }) {
	if (props.clear) {
		return <ClearedEntityNotice title={props.title} />;
	}
	return <AppScreen title={props.title}>{null}</AppScreen>;
}

function ClearedEntityNotice(props: { readonly title: string }) {
	useClearClientPageDocument();
	return <AppScreen title={props.title}>{null}</AppScreen>;
}
