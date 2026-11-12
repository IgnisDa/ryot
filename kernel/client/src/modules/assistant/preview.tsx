import type { PageDraftBuildIdentity } from "@ryot-app/contract/modules/pages/identity";
import type { AssistantConversationId, AssistantTurnId } from "@ryot-app/contract/schema/brands";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, Card, Notice } from "@ryot-app/plugin-ui-sdk";
import { useRouteContext, useRouterState } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";

import { historyEntry } from "#/modules/navigation/history-entry";
import { PageDocumentHost } from "#/modules/pages/runtime/page-document-host";
import {
	createClientPagePresentationController,
	useEdge,
	useShellChrome,
} from "#/modules/shell/authenticated-shell-context";

import { AssistantPageActions } from "./page-actions";
import { previewQuery } from "./service";

export function AssistantPagePreview(props: {
	readonly disabled: boolean;
	readonly turnId: AssistantTurnId;
	readonly identity: PageDraftBuildIdentity;
	readonly conversationId: AssistantConversationId;
}) {
	const preview = useRyotQuery(previewQuery, props.identity);

	const { scope, theme, runtime, backInterceptors } = useRouteContext({ from: "/_authenticated" });
	const chrome = useShellChrome();
	const edge = useEdge();
	const location = useRouterState({ select: (state) => state.location });
	const triggerRef = useRef<null | HTMLElement>(null);
	const presentation = useMemo(() => createClientPagePresentationController(() => undefined), []);
	const entry = historyEntry(location.state);
	const [requestId] = useState(() => crypto.randomUUID());
	const [retryGeneration, setRetryGeneration] = useState(0);
	const retry = () => {
		preview.refetch();
		setRetryGeneration((generation) => generation + 1);
	};

	const prepared = preview.data;
	return (
		<Card className="grid gap-4">
			<p className="text-sm text-text-muted">Read-only preview</p>
			{preview.isError ? (
				<Notice tone="danger" action={<Button onClick={retry}>Retry</Button>}>
					This preview is unavailable or has changed. Ask Ryobot to prepare it again.
				</Notice>
			) : null}
			{(prepared === undefined || preview.isFetching) && !preview.isError ? (
				<p role="status">Loading preview…</p>
			) : null}
			{prepared !== undefined && !preview.isError && !preview.isFetching ? (
				<div className="h-96 overflow-hidden rounded-lg border border-border">
					<PageDocumentHost
						active
						embedded
						scope={scope}
						theme={theme}
						owner={requestId}
						runtime={runtime}
						edgeLeading={null}
						onReloadCurrent={retry}
						freshnessCheckRevision={0}
						presentation={presentation}
						backInterceptors={backInterceptors}
						document={{ prepared, title: "Page preview" }}
						operationTargets={prepared.identity.operationTargets}
						chrome={{ ...chrome, triggerRef, safeAreaTop: 0, safeAreaBottom: 0 }}
						key={`${props.identity.pageId}:${props.identity.draftRevision}:${props.identity.definitionHash}:${props.identity.artifactHash}:${retryGeneration}`}
						navigation={{
							...entry,
							leading: "none",
							edgeBack: false,
							compact: edge.compact,
							location: { search: "", kind: "route", path: location.pathname },
						}}
					/>
				</div>
			) : null}
			<AssistantPageActions
				{...props}
				ready={prepared !== undefined && !preview.isError && !preview.isFetching}
			/>
		</Card>
	);
}
