import { EntityId } from "@ryot-app/contract/schema/brands";
import { createFileRoute } from "@tanstack/react-router";

import { ClientPageHost } from "#/modules/client-pages/page-host";
import { prepareClientPage } from "#/modules/client-pages/preparation";
import { AppScreen } from "#/modules/navigation/app-screen";

export const Route = createFileRoute("/_authenticated/e/$entityId")({
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
		return <ClientPageHost title="Entity details" prepared={preparation.prepared} />;
	}
	if (preparation.reason.code === "entity-not-found") {
		return <EntityNotice title="Entity not found" />;
	}
	if (preparation.reason.code === "entity-detail-page-not-registered") {
		return <EntityNotice title="Entity page not registered" />;
	}
	return <EntityNotice title="Required plugin unavailable" />;
}

function EntityPending() {
	return <EntityNotice title="Entity loading" />;
}

function EntityError() {
	return <EntityNotice title="Retryable entity load failure" />;
}

function EntityNotice(props: { readonly title: string }) {
	return <AppScreen title={props.title}>{null}</AppScreen>;
}
