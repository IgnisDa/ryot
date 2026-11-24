import type { IngestionIssue } from "@ryot-app/contract/modules/imports/ingestion";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, LoadMoreButton } from "@ryot-app/plugin-ui-sdk";
import { type ReactNode, useEffect, useRef } from "react";

import { importIssuesQuery } from "./service";

const initialCursor: string | undefined = undefined;

const ingestionIssueReasonMessage = ({ reason, recordKind: kind }: IngestionIssue) => {
	if ("message" in reason) {
		return kernelMessage("client.imports.issues.policy-reason", { kind, reason: reason.message });
	}
	return reason.key === null
		? kernelMessage("client.imports.issues.reason", { kind, code: reason.code })
		: kernelMessage("client.imports.issues.reason-with-key", {
				kind,
				key: reason.key,
				code: reason.code,
			});
};

export function IngestionIssues(props: {
	readonly runId: string;
	readonly revision: string;
	readonly children: ReactNode;
}) {
	const t = useT();
	const query = useRyotInfiniteQuery(
		importIssuesQuery,
		{ runId: props.runId },
		{
			initialPageParam: initialCursor,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, after: string | undefined) => ({ ...input, after, limit: 25 }),
		},
	);
	const refreshedRevision = useRef({ runId: props.runId, revision: props.revision });
	const { revision } = props;
	const { refetch } = query;
	useEffect(() => {
		const previous = refreshedRevision.current;
		refreshedRevision.current = { revision, runId: props.runId };
		if (previous.runId === props.runId && previous.revision !== revision) {
			refetch();
		}
	}, [revision, props.runId, refetch]);
	const issues = paginationItems(
		query.pages,
		(page) => page.items,
		(issue) => issue.id,
	);
	if (query.isError && query.pages.length === 0) {
		return (
			<div role="alert" className="text-sm text-danger">
				{t(kernelMessage("client.imports.issues.load-failed"))}{" "}
				<Button variant="secondary" onClick={query.refetch}>
					{t(kernelMessage("common.action.try-again"))}
				</Button>
			</div>
		);
	}
	if (query.pages.length === 0 || issues.length === 0) {
		return null;
	}
	const appendFailed = query.errorOperation === "append";
	return (
		<>
			<section className="flex flex-col gap-3">
				<h2 className="text-base font-semibold text-text">
					{t(kernelMessage("client.imports.issues.title"))}
				</h2>
				<p className="text-xs text-text-muted">{t(kernelMessage("client.imports.issues.note"))}</p>
				{query.errorOperation === "refresh" ? (
					<div role="alert" className="text-sm text-danger">
						{t(kernelMessage("client.imports.issues.refresh-failed"))}{" "}
						<Button variant="secondary" onClick={query.refetch}>
							{t(kernelMessage("common.action.try-again"))}
						</Button>
					</div>
				) : null}
				{issues.map(({ id, data: issue }) => (
					<div key={id} className="border-b border-border py-3 text-sm text-text-muted">
						<p className="font-medium text-text">
							{t(
								kernelMessage("client.imports.issues.heading", {
									severity: issue.severity,
									subject:
										issue.attribution?.sourceLabel ??
										issue.attribution?.recordId ??
										t(kernelMessage("client.imports.issues.run-issue")),
								}),
							)}
						</p>
						{"detail" in issue.reason && issue.reason.detail !== undefined ? (
							<p>{t(issue.reason.detail)}</p>
						) : null}
						<p className="text-xs">{t(ingestionIssueReasonMessage(issue))}</p>
						{issue.operationId === null ? null : (
							<p className="text-xs">
								{t(kernelMessage("client.imports.issues.operation", { id: issue.operationId }))}
							</p>
						)}
						{issue.attribution === null ? null : (
							<p className="text-xs">
								{t(
									issue.attribution.sourceIdentifier === null
										? kernelMessage("client.imports.issues.record", {
												id: issue.attribution.recordId,
											})
										: kernelMessage("client.imports.issues.record-with-source", {
												id: issue.attribution.recordId,
												source: issue.attribution.sourceIdentifier,
											}),
								)}
							</p>
						)}
					</div>
				))}
				{query.hasNextPage ? (
					<LoadMoreButton
						variant="secondary"
						disabled={query.isFetching}
						isFetchingNextPage={query.isFetchingNextPage}
						onClick={appendFailed ? query.retry : query.fetchNextPage}
						label={t(
							appendFailed
								? kernelMessage("common.action.try-again")
								: kernelMessage("client.imports.issues.show-more"),
						)}
					/>
				) : null}
			</section>
			{props.children}
		</>
	);
}
