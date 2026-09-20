import { useRyotQuery } from "@ryot-app/client-sdk/react";
import { Button } from "@ryot-app/client-ui-sdk";
import type { ImportIssuesPage } from "@ryot-app/ryotql-recipes/import-runs";
import { useEffect, useRef, useState } from "react";

import { importIssuesQuery } from "./service";

export function IngestionIssues(props: { readonly runId: string; readonly revision: string }) {
	const [after, setAfter] = useState<string | undefined>();
	const [previous, setPrevious] = useState<ImportIssuesPage["items"]>([]);
	const query = useRyotQuery(importIssuesQuery, { after, limit: 25, runId: props.runId });
	const refreshedRevision = useRef<string | undefined>(undefined);
	const { refetch } = query;
	const { revision } = props;
	useEffect(() => {
		if (refreshedRevision.current !== revision) {
			refreshedRevision.current = revision;
			refetch();
		}
	}, [revision, refetch]);
	if (query.status === "error") {
		return (
			<div role="alert" className="text-sm text-danger">
				Could not load record issues.{" "}
				<Button variant="secondary" onClick={query.refetch}>
					Try again
				</Button>
			</div>
		);
	}
	if (query.data === undefined || (query.data.items.length === 0 && previous.length === 0)) {
		return null;
	}
	return (
		<section className="flex flex-col gap-3">
			<h2 className="text-base font-semibold text-text">Record issues</h2>
			<p className="text-xs text-text-muted">
				Warnings and record errors are separate from a run failure. Expected skips appear in the
				outcome summary.
			</p>
			{[...previous, ...query.data.items].map(({ id, data: issue }) => (
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
			{query.data.pageInfo.nextCursor === null ? null : (
				<Button
					variant="secondary"
					onClick={() => {
						if (query.data === undefined || query.data.pageInfo.nextCursor === null) {
							return;
						}
						setPrevious([...previous, ...query.data.items]);
						setAfter(query.data.pageInfo.nextCursor);
					}}
				>
					Show more record issues
				</Button>
			)}
		</section>
	);
}
