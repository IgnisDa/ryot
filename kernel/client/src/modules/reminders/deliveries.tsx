import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, LoadMoreButton, Notice } from "@ryot-app/plugin-ui-sdk";

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
		<div aria-label="Channel outcomes" className="grid gap-2 text-sm">
			{query.isPending ? <p role="status">Loading channel outcomes...</p> : null}
			{query.isError ? (
				<Notice tone="danger">
					Channel outcomes could not be loaded.{" "}
					<Button onClick={query.retry}>Retry outcomes</Button>
				</Notice>
			) : null}
			{!query.isPending && items.length === 0 ? (
				<p>
					No retained channel details. Detailed outcomes expire after 30 days; the reminder's
					compact outcome remains.
				</p>
			) : null}
			<ul>
				{items.map((row) => (
					<li key={row.id}>
						{row.description || row.channel}: {statusLabels[row.status]}
						{row.reason ? ` · ${row.reason.replaceAll("-", " ")}` : ""}
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
