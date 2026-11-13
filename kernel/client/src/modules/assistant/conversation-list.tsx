import type { AssistantConversationStatus } from "@ryot-app/contract/modules/assistant/schemas";
import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	type ActivityTone,
	Button,
	LoadMoreButton,
	Notice,
	StatusDot,
} from "@ryot-app/plugin-ui-sdk";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";

import { formatRelativeTime } from "#/modules/ui/run/run-status";
import { RELATIVE_TIME_REFRESH_MS, useNowMs } from "#/modules/ui/use-now-ms";

import { conversationsQuery } from "./service";

const initialCursor: string | undefined = undefined;
const statuses = {
	failed: { tone: "error", label: "Failed", className: "text-danger" },
	working: { tone: "pending", label: "Working", className: "text-accent-text" },
	"awaiting-approval": { tone: "warning", label: "Needs approval", className: "text-warning" },
} as const satisfies Record<
	Exclude<AssistantConversationStatus, "idle">,
	{ readonly label: string; readonly className: string; readonly tone: ActivityTone }
>;

export function AssistantConversationList(props: {
	readonly compact: boolean;
	readonly activeId: null | string;
}) {
	const nowMs = useNowMs(RELATIVE_TIME_REFRESH_MS);
	const conversations = useRyotInfiniteQuery(
		conversationsQuery,
		{},
		{
			initialPageParam: initialCursor,
			getNextPageParam: nextPageCursor,
			getPageInput: (_input, after: string | undefined) => ({ after }),
		},
	);
	const items = paginationItems(
		conversations.pages,
		(page) => page.items,
		(item) => item.id,
	);
	return (
		<nav aria-label="Conversations" className="grid content-start gap-0.5">
			{conversations.isError ? (
				<Notice tone="danger" action={<Button onClick={conversations.refetch}>Retry</Button>}>
					Conversations could not be loaded.
				</Notice>
			) : null}
			{items.length === 0 && !conversations.isPending && !conversations.isError ? (
				<p className="px-2.5 py-4 text-label text-text-subtle">
					Your conversations with Ryobot appear here.
				</p>
			) : null}
			{items.map((item) => {
				const status = item.status === "idle" ? null : statuses[item.status];
				const when = formatRelativeTime(item.updatedAt, nowMs);
				return (
					<Link
						key={item.id}
						to="/assistant/$conversationId"
						params={{ conversationId: item.id }}
						aria-current={item.id === props.activeId ? "page" : undefined}
						className={clsx(
							"grid gap-0.5 rounded-md px-2.5 hover:bg-hover",
							props.compact ? "border-b border-border py-3" : "py-2",
							item.id === props.activeId && "bg-surface shadow-sm hover:bg-surface",
						)}
					>
						<span className="truncate text-label font-medium text-text">{item.title}</span>
						<span className="flex items-center gap-1.5 text-micro text-text-subtle">
							{status === null ? null : (
								<>
									<StatusDot tone={status.tone} />
									<span className={clsx("font-medium", status.className)}>{status.label}</span>
									<span aria-hidden="true">·</span>
								</>
							)}
							{when}
						</span>
					</Link>
				);
			})}
			{conversations.hasNextPage ? (
				<LoadMoreButton
					label="Load more conversations"
					onClick={conversations.fetchNextPage}
					isFetchingNextPage={conversations.isFetchingNextPage}
				/>
			) : null}
		</nav>
	);
}
