import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, LoadMoreButton, Notice } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";

import { RUN_LIST_POLL_MS, useRunPolling } from "#/modules/ui/run/use-run-polling";

import { reminderReasonMessages } from "./presentation";
import { reminderDeliveriesQuery } from "./service";

const statusLabels = {
	queued: kernelMessage("client.reminders.delivery.queued"),
	failed: kernelMessage("client.reminders.delivery.failed"),
	sending: kernelMessage("client.reminders.delivery.sending"),
	skipped: kernelMessage("client.reminders.delivery.skipped"),
	unknown: kernelMessage("client.reminders.delivery.unknown"),
	accepted: kernelMessage("client.reminders.delivery.accepted"),
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
	const t = useT();
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
			aria-label={t(kernelMessage("client.reminders.channel-outcomes"))}
			className="grid gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-label text-text"
		>
			{query.isPending ? (
				<p role="status">{t(kernelMessage("client.reminders.delivery.loading"))}</p>
			) : null}
			{query.isError ? (
				<Notice
					tone="danger"
					action={
						<Button size="sm" variant="secondary" onClick={query.retry}>
							{t(kernelMessage("common.action.retry"))}
						</Button>
					}
				>
					{t(kernelMessage("client.reminders.delivery.load-failed"))}
				</Notice>
			) : null}
			{!query.isPending && items.length === 0 ? (
				<p className="text-text-muted">{t(kernelMessage("client.reminders.delivery.empty"))}</p>
			) : null}
			<ul className="grid gap-1.5">
				{items.map((row) => (
					<li key={row.id} className="flex items-center gap-2">
						<span
							aria-hidden="true"
							className={clsx("size-1.5 shrink-0 rounded-full", statusDots[row.status])}
						/>
						<span>
							{t(
								row.reason === null
									? kernelMessage("client.reminders.delivery.line", {
											status: statusLabels[row.status],
											channel: row.description || row.channel,
										})
									: kernelMessage("client.reminders.delivery.line-with-reason", {
											status: statusLabels[row.status],
											channel: row.description || row.channel,
											reason: reminderReasonMessages[row.reason],
										}),
							)}
						</span>
					</li>
				))}
			</ul>
			{query.hasNextPage ? (
				<LoadMoreButton
					onClick={() => query.fetchNextPage()}
					isFetchingNextPage={query.isFetchingNextPage}
					label={t(kernelMessage("client.reminders.delivery.load-more"))}
				/>
			) : null}
		</div>
	);
}
