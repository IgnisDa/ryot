import type { AssistantConversationStatus } from "@ryot-app/contract/modules/assistant/schemas";
import type { Message } from "@ryot-app/i18n/message";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, LoadMoreButton, Notice } from "@ryot-app/plugin-ui-sdk";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";

import { formatRelativeTime } from "#/modules/ui/run/run-status";
import { RELATIVE_TIME_REFRESH_MS, useNowMs } from "#/modules/ui/use-now-ms";

import { ASSISTANT_NAME } from "./presentation";
import { conversationsQuery } from "./service";
import { AssistantSprite, conversationMood } from "./sprite";

const initialCursor: string | undefined = undefined;
const statuses = {
	failed: {
		className: "text-danger",
		label: kernelMessage("client.assistant.conversations.status.failed"),
	},
	"awaiting-input": {
		className: "text-info",
		label: kernelMessage("client.assistant.activity.needs-answer"),
	},
	working: {
		className: "text-accent-text",
		label: kernelMessage("client.assistant.conversations.status.working"),
	},
	"awaiting-approval": {
		className: "text-warning",
		label: kernelMessage("client.assistant.conversations.status.awaiting-approval"),
	},
} as const satisfies Record<
	Exclude<AssistantConversationStatus, "idle">,
	{ readonly label: Message; readonly className: string }
>;

export function AssistantConversationList(props: {
	readonly compact: boolean;
	readonly activeId: null | string;
}) {
	const t = useT();
	const formatters = useFormatters();
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
		<nav
			className="grid content-start gap-0.5"
			aria-label={t(kernelMessage("client.assistant.conversations.label"))}
		>
			{conversations.isError ? (
				<Notice
					tone="danger"
					action={
						<Button onClick={conversations.refetch}>
							{t(kernelMessage("common.action.retry"))}
						</Button>
					}
				>
					{t(kernelMessage("client.assistant.conversations.load-failed"))}
				</Notice>
			) : null}
			{items.length === 0 && !conversations.isPending && !conversations.isError ? (
				<p className="px-2.5 py-4 text-label text-text-subtle">
					{t(kernelMessage("client.assistant.conversations.empty", { name: ASSISTANT_NAME }))}
				</p>
			) : null}
			{items.map((item) => {
				const status = item.status === "idle" ? null : statuses[item.status];
				const when = formatRelativeTime(formatters, t, item.updatedAt, nowMs);
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
									<AssistantSprite className="w-4" mood={conversationMood(item.status)} />
									<span className={clsx("font-medium", status.className)}>{t(status.label)}</span>
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
					onClick={conversations.fetchNextPage}
					isFetchingNextPage={conversations.isFetchingNextPage}
					label={t(kernelMessage("client.assistant.conversations.load-more"))}
				/>
			) : null}
		</nav>
	);
}
