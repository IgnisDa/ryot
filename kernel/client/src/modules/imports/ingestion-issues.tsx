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
	return !("key" in reason) || reason.key === null
		? kernelMessage("client.imports.issues.reason", { kind, code: reason.code })
		: kernelMessage("client.imports.issues.reason-with-key", {
				kind,
				key: reason.key,
				code: reason.code,
			});
};

const readableIssueMessage = ({ reason, severity }: IngestionIssue) => {
	if ("message" in reason) {
		return reason.message;
	}
	if (reason.detail) {
		return reason.detail;
	}
	switch (reason.code) {
		case "event-policy-failed":
			return kernelMessage("client.imports.issues.explanation.event-policy-failed");
		case "source-fetch-failed":
			return kernelMessage("client.imports.issues.explanation.source-fetch-failed");
		case "database-commit-failed":
			return kernelMessage("client.imports.issues.explanation.database-commit-failed");
		case "provider-details-failed":
			return kernelMessage("client.imports.issues.explanation.provider-details-failed");
		case "provider-resolution-failed":
			return kernelMessage("client.imports.issues.explanation.provider-resolution-failed");
		case "input-transformation-failed":
			return kernelMessage("client.imports.issues.explanation.input-transformation-failed");
		default:
			return kernelMessage(
				severity === "warning"
					? "client.imports.issues.explanation.warning"
					: "client.imports.issues.explanation.error",
			);
	}
};

export function useIngestionIssues(runId: string, revision: string) {
	const query = useRyotInfiniteQuery(
		importIssuesQuery,
		{ runId },
		{
			initialPageParam: initialCursor,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, after: string | undefined) => ({ ...input, after, limit: 25 }),
		},
	);
	const refreshedRevision = useRef(revision);
	const { refetch } = query;
	useEffect(() => {
		const previous = refreshedRevision.current;
		refreshedRevision.current = revision;
		if (previous !== revision) {
			refetch();
		}
	}, [revision, refetch]);
	const issues = paginationItems(
		query.pages,
		(page) => page.items,
		(issue) => issue.id,
	);
	return { query, issues };
}

export function IngestionIssues(
	props: ReturnType<typeof useIngestionIssues> & {
		readonly children: ReactNode;
		readonly leadIssueId?: string | undefined;
	},
) {
	const { query, issues } = props;
	const t = useT();
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
		<section className="grid gap-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<h2 className="text-base font-semibold text-text">
					{t(kernelMessage("client.imports.issues.title"))}
				</h2>
				<div className="grid gap-2">{props.children}</div>
			</div>
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
					{props.leadIssueId === id ? null : (
						<p className="mt-1 text-sm text-text">{t(readableIssueMessage(issue))}</p>
					)}
					<details className="mt-2 text-xs">
						<summary className="cursor-pointer py-1">
							{t(kernelMessage("client.imports.report.technical-details"))}
						</summary>
						<p>{t(ingestionIssueReasonMessage(issue))}</p>
						{issue.operationId === null ? null : (
							<p className="break-all">
								{t(kernelMessage("client.imports.issues.operation", { id: issue.operationId }))}
							</p>
						)}
						{issue.attribution === null ? null : (
							<p className="break-all">
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
					</details>
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
	);
}
