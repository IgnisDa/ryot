import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, LoadMoreButton, Notice } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";

import { RUN_LIST_POLL_MS, useRunPolling } from "#/modules/ui/run/use-run-polling";

import { reminderDeliveriesQuery } from "./service";

const statusLabels = {
	queued: "Queued",
	failed: "Failed",
	sending: "Sending",
	skipped: "Not sent",
	unknown: "Delivery unknown",
	accepted: "Accepted by provider",
};
const statusDots = {
	sending: "bg-info",
	failed: "bg-danger",
	skipped: "bg-warning",
	unknown: "bg-warning",
	accepted: "bg-success",
	queued: "bg-text-subtle",
};
const initialCursor: string | undefined = undefined;

export function ReminderDeliveries(props: {
	readonly reminderId: string;
	readonly processing: boolean;
}) {
	const query = useRyotInfiniteQuery(
		reminderDeliveriesQuery,
		{ reminderId: props.reminderId },
		{
			initialPageParam: initialCursor,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, after: string | undefined) => ({ ...input, after, limit: 20 }),
		},
	);
	const items = paginationItems(
		query.pages,
		(page) => page.items,
		(row) => row.id,
	);
	useRunPolling({
		refresh: query.refetch,
		enabled: props.processing,
		intervalMs: RUN_LIST_POLL_MS,
	});
	return (
		<div
			aria-label="Channel outcomes"
			className="grid gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-label text-text"
		>
			{query.isPending ? <p role="status">Loading channel outcomes...</p> : null}
			{query.isError ? (
				<Notice
					tone="danger"
					action={
						<Button size="sm" variant="secondary" onClick={query.retry}>
							Retry outcomes
						</Button>
					}
				>
					Channel outcomes could not be loaded.
				</Notice>
			) : null}
			{!query.isPending && items.length === 0 ? (
				<p className="text-text-muted">
					No retained channel details. Detailed outcomes expire after 30 days; the reminder's
					compact outcome remains.
				</p>
			) : null}
			<ul className="grid gap-1.5">
				{items.map((row) => (
					<li key={row.id} className="flex items-center gap-2">
						<span
							aria-hidden="true"
							className={clsx("size-1.5 shrink-0 rounded-full", statusDots[row.status])}
						/>
						<span>
							{row.description || row.channel}: {statusLabels[row.status]}
							{row.reason ? ` · ${row.reason.replaceAll("-", " ")}` : ""}
						</span>
					</li>
				))}
			</ul>
			{query.hasNextPage ? (
				<LoadMoreButton
					label="Load more channel outcomes"
					onClick={() => query.fetchNextPage()}
					isFetchingNextPage={query.isFetchingNextPage}
				/>
			) : null}
		</div>
	);
}
