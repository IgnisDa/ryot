import { EntityId } from "@ryot-app/contract/schema/brands";
import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { ClientPage } from "#/modules/pages/documents/page";
import { useClearClientPageDocument } from "#/modules/pages/documents/state";
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

function EntityError() {
	return <EntityNotice title={kernelMessage("client.route.entity.load-failed")} />;
}

function EntityNotice(props: { readonly title: Message }) {
	const t = useT();
	useClearClientPageDocument();
	return <AppScreen title={t(props.title)}>{null}</AppScreen>;
}

function EntityPage() {
	const t = useT();
	const { preparation } = Route.useLoaderData();
	if (preparation.kind === "ready") {
		return (
			<ClientPage
				prepared={preparation.prepared}
				title={t(kernelMessage("client.route.entity.details"))}
			/>
		);
	}
	if (preparation.reason.code === "entity-not-found") {
		return <EntityNotice title={kernelMessage("client.route.entity.not-found")} />;
	}
	if (preparation.reason.code === "entity-detail-page-not-registered") {
		return <EntityNotice title={kernelMessage("client.route.entity.page-not-registered")} />;
	}
	return <EntityNotice title={kernelMessage("client.route.entity.plugin-unavailable")} />;
}
