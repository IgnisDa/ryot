import type { PageDraftBuildIdentity } from "@ryot-app/contract/modules/pages/identity";
import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import { createRyotHostQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, Notice } from "@ryot-app/plugin-ui-sdk";
import { useRouteContext, useRouterState } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";

import type { AuthenticatedApiError } from "#/api/authenticated";
import { PagesApi } from "#/api/pages";
import { KernelHostServices } from "#/host-services";
import { historyEntry } from "#/modules/navigation/history-entry";
import { PageDocumentHost } from "#/modules/pages/runtime/page-document-host";
import {
	createClientPagePresentationController,
	useEdge,
	useShellChrome,
} from "#/modules/shell/authenticated-shell-context";

const pagePreviewQuery = createRyotHostQuery<
	PageDraftBuildIdentity,
	PreparedClientPage,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, hostServices }) =>
		hostServices.runtime
			.runSync(PagesApi)
			.prepare(hostServices.scope, { payload: { target: { kind: "page-preview", ...input } } }),
	{ cancelOnUnmount: true, hostServices: KernelHostServices },
);

export function EmbeddedPagePreview(props: {
	readonly title: string;
	readonly identity: PageDraftBuildIdentity;
}) {
	const preview = useRyotQuery(pagePreviewQuery, props.identity);
	const { scope, theme, runtime, backInterceptors } = useRouteContext({ from: "/_authenticated" });
	const chrome = useShellChrome();
	const edge = useEdge();
	const location = useRouterState({ select: (state) => state.location });
	const triggerRef = useRef<null | HTMLElement>(null);
	const presentation = useMemo(() => createClientPagePresentationController(() => undefined), []);
	const entry = historyEntry(location.state);
	const [owner] = useState(() => crypto.randomUUID());
	const [generation, setGeneration] = useState(0);
	const retry = () => {
		preview.refetch();
		setGeneration((value) => value + 1);
	};
	if (preview.isError) {
		return (
			<Notice tone="danger" action={<Button onClick={retry}>Retry</Button>}>
				This preview is unavailable or has changed.
			</Notice>
		);
	}
	const prepared = preview.data;
	if (prepared === undefined || preview.isFetching) {
		return (
			<p role="status" className="text-sm text-text-muted">
				Loading preview…
			</p>
		);
	}
	const { identity } = props;
	return (
		<PageDocumentHost
			active
			embedded
			scope={scope}
			theme={theme}
			owner={owner}
			runtime={runtime}
			edgeLeading={null}
			onReloadCurrent={retry}
			freshnessCheckRevision={0}
			presentation={presentation}
			backInterceptors={backInterceptors}
			document={{ prepared, title: props.title }}
			operationTargets={prepared.identity.operationTargets}
			chrome={{ ...chrome, triggerRef, safeAreaTop: 0, safeAreaBottom: 0 }}
			key={`${identity.pageId}:${identity.draftRevision}:${identity.definitionHash}:${identity.artifactHash}:${generation}`}
			navigation={{
				...entry,
				leading: "none",
				edgeBack: false,
				compact: edge.compact,
				location: { search: "", kind: "route", path: location.pathname },
			}}
		/>
	);
}
