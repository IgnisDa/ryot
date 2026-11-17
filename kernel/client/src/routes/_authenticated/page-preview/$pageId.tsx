import { PagePreviewTarget } from "@ryot-app/contract/modules/pages/schemas";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Effect, Schema } from "effect";

import { PagesApi } from "#/api/pages";
import { useClearClientPageDocument, useClientPageDocument } from "#/modules/pages/documents/state";
import { ClientPagePending } from "#/modules/pages/loading";
import { AppScreen } from "#/modules/shell/app-screen";

export const Route = createFileRoute("/_authenticated/page-preview/$pageId")({
	gcTime: 0,
	component: PagePreview,
	errorComponent: PreviewError,
	loaderDeps: ({ search }) => search,
	pendingComponent: ClientPagePending,
	validateSearch: (search) => ({
		draftRevision: Number(search.draftRevision),
		artifactHash: typeof search.artifactHash === "string" ? search.artifactHash : "",
		definitionHash: typeof search.definitionHash === "string" ? search.definitionHash : "",
	}),
	loader: ({ deps, params, context, abortController }) =>
		context.runtime.runPromise(
			Schema.decodeUnknownEffect(PagePreviewTarget)({
				...deps,
				kind: "page-preview",
				pageId: params.pageId,
			}).pipe(
				Effect.flatMap((target) =>
					context.runtime.runSync(PagesApi).prepare(context.scope, { payload: { target } }),
				),
			),
			{ signal: abortController.signal },
		),
});

function PagePreview() {
	const t = useT();
	const prepared = Route.useLoaderData();
	useClientPageDocument({
		prepared,
		title: t(kernelMessage("client.assistant.draft.preview-description")),
	});
	return null;
}

function PreviewError() {
	const t = useT();
	useClearClientPageDocument();
	const navigate = useNavigate();
	return (
		<AppScreen
			backFallbackHref="/settings/pages"
			title={t(kernelMessage("client.route.page-preview.unavailable"))}
		>
			<p className="text-text-muted">
				{t(kernelMessage("client.route.page-preview.unavailable-detail"))}
			</p>
			<Button onClick={() => void navigate({ to: "/settings/pages" })}>
				{t(kernelMessage("client.route.page-preview.return"))}
			</Button>
		</AppScreen>
	);
}
