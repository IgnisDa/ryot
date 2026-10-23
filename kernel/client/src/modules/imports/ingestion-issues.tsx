import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, LoadMoreButton } from "@ryot-app/plugin-ui-sdk";
import { useEffect, useRef } from "react";

import { importIssuesQuery } from "./service";

const initialCursor: string | undefined = undefined;

export function IngestionIssues(props: { readonly runId: string; readonly revision: string }) {
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
				Could not load record issues.{" "}
				<Button variant="secondary" onClick={query.refetch}>
					Try again
				</Button>
			</div>
		);
	}
	if (query.pages.length === 0 || issues.length === 0) {
		return null;
	}
	const appendFailed = query.errorOperation === "append";
	return (
		<section className="flex flex-col gap-3">
			<h2 className="text-base font-semibold text-text">Record issues</h2>
			<p className="text-xs text-text-muted">
				Warnings and record errors are separate from a run failure. Expected skips appear in the
				outcome summary.
			</p>
			{query.errorOperation === "refresh" ? (
				<div role="alert" className="text-sm text-danger">
					Could not refresh record issues.{" "}
					<Button variant="secondary" onClick={query.refetch}>
						Try again
					</Button>
				</div>
			) : null}
			{issues.map(({ id, data: issue }) => (
				<div key={id} className="border-b border-border py-3 text-sm text-text-muted">
					<p className="font-medium text-text">
						{issue.attribution?.sourceLabel ?? issue.attribution?.recordId ?? "Run issue"} ·{" "}
						{issue.severity}
					</p>
					<p>
						{issue.recordKind} · {issue.reason.code}
						{issue.reason.key === null ? "" : ` · ${issue.reason.key}`}
					</p>
					{issue.operationId === null ? null : (
						<p className="text-xs">Operation: {issue.operationId}</p>
					)}
					{issue.attribution === null ? null : (
						<p className="text-xs">
							Record: {issue.attribution.recordId}
							{issue.attribution.sourceIdentifier === null
								? ""
								: ` · Source: ${issue.attribution.sourceIdentifier}`}
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
					label={appendFailed ? "Try again" : "Show more record issues"}
				/>
			) : null}
		</section>
	);
}
