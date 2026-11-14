import { PagePreviewTarget } from "@ryot-app/contract/modules/pages/schemas";
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
	const prepared = Route.useLoaderData();
	useClientPageDocument({ prepared, title: "Read-only draft preview" });
	return null;
}

function PreviewError() {
	useClearClientPageDocument();
	const navigate = useNavigate();
	return (
		<AppScreen title="Preview unavailable" backFallbackHref="/settings/pages">
			<p className="text-text-muted">
				This compiled draft is unavailable or has changed. Return to Pages, reload the latest draft
				and compile it again.
			</p>
			<Button onClick={() => void navigate({ to: "/settings/pages" })}>Return to Pages</Button>
		</AppScreen>
	);
}
