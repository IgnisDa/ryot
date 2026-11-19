import { ReminderConflict, type ReminderState } from "@ryot-app/contract/modules/reminders/schemas";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import type { Message } from "@ryot-app/i18n/message";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
	useRyotMutation,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Badge,
	Button,
	Card,
	EmptyState,
	LoadMoreButton,
	Notice,
	SegmentedControl,
	Skeleton,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { RemindersResult } from "@ryot-app/ryotql-recipes/reminders";
import { Link } from "@tanstack/react-router";
import { Effect, Schema } from "effect";
import { useRef, useState } from "react";

import { AuthenticatedApiError } from "#/api/authenticated";
import { RUN_LIST_POLL_MS, useRunPolling } from "#/modules/ui/run/use-run-polling";

import { ReminderDeliveries } from "./deliveries";
import { ReminderEditor } from "./editor";
import { reminderReasonMessages } from "./presentation";
import { ReminderReadiness } from "./readiness";
import { type ReminderCommand, reminderCommandMutation, remindersQuery } from "./service";

type Reminder = RemindersResult["items"][number];
const states: Readonly<Record<string, ReadonlyArray<ReminderState>>> = {
	needs: ["needs-scheduling"],
	history: ["settled", "cancelled"],
	upcoming: ["scheduled", "processing"],
};
const labels = {
	failed: kernelMessage("client.reminders.delivery.failed"),
	partial: kernelMessage("client.reminders.outcome.partial"),
	unknown: kernelMessage("client.reminders.delivery.unknown"),
	accepted: kernelMessage("client.reminders.outcome.accepted"),
	"not-sent": kernelMessage("client.reminders.delivery.skipped"),
};
const initialCursor: string | undefined = undefined;

const stateLabels = {
	settled: kernelMessage("client.reminders.state.settled"),
	cancelled: kernelMessage("client.reminders.state.cancelled"),
	scheduled: kernelMessage("client.reminders.state.scheduled"),
	processing: kernelMessage("client.reminders.state.processing"),
	"needs-scheduling": kernelMessage("client.reminders.state.needs-scheduling"),
};
const stateLabel = (row: Reminder) => (row.outcome ? labels[row.outcome] : stateLabels[row.state]);
const outcomeVariants = {
	failed: "danger",
	partial: "warning",
	unknown: "warning",
	accepted: "success",
	"not-sent": "warning",
} as const;
const stateVariants = {
	settled: "success",
	processing: "info",
	scheduled: "accent",
	cancelled: "neutral",
	"needs-scheduling": "warning",
} as const;
const statusVariant = (row: Reminder) =>
	row.outcome ? outcomeVariants[row.outcome] : stateVariants[row.state];
const emptyStates: Readonly<Record<string, { title: Message; description: Message }>> = {
	needs: {
		title: kernelMessage("client.reminders.empty.needs.title"),
		description: kernelMessage("client.reminders.empty.needs.description"),
	},
	history: {
		title: kernelMessage("client.reminders.empty.history.title"),
		description: kernelMessage("client.reminders.empty.history.description"),
	},
	upcoming: {
		title: kernelMessage("client.reminders.empty.upcoming.title"),
		description: kernelMessage("client.reminders.empty.upcoming.description"),
	},
};

export function ReminderManager(props: {
	readonly disabled?: boolean;
	readonly onChanged?: () => void;
	readonly entityId?: EntityId | undefined;
	readonly parentEntityId?: null | EntityId | undefined;
}) {
	const t = useT();
	const formatters = useFormatters();
	const [tab, setTab] = useState("upcoming");
	const [editor, setEditor] = useState<null | "new" | Reminder>(null);
	const [notice, setNotice] = useState<null | { text: Message; tone: "danger" | "success" }>(null);
	const [stale, setStale] = useState(false);
	const [detail, setDetail] = useState<null | string>(null);
	const writesDisabled = props.disabled === true || stale;
	const submissions = useRef(new Map<string, ReminderCommand>());
	const mutation = useRyotMutation(reminderCommandMutation);
	const query = useRyotInfiniteQuery(
		remindersQuery,
		{ entityId: props.entityId, states: states[tab] ?? [] },
		{
			initialPageParam: initialCursor,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, after: string | undefined) => ({ ...input, after, limit: 20 }),
		},
	);
	const reminders = paginationItems(
		query.pages,
		(page) => page.items,
		(row) => row.id,
	);
	useRunPolling({
		refresh: query.refetch,
		intervalMs: RUN_LIST_POLL_MS,
		enabled: reminders.some((row) => row.state === "processing"),
	});
	const reload = () => {
		submissions.current.clear();
		setStale(false);
		setNotice(null);
		setEditor(null);
		query.refetch();
	};
	const change = (row: Reminder, action: "cancel" | "remove") => {
		const key = `${action}:${row.id}`;
		const command = submissions.current.get(key) ?? {
			action,
			request: { params: { reminderId: row.id }, payload: { revision: row.revision } },
		};
		submissions.current.set(key, command);
		void Effect.runPromise(
			mutation.mutateEffect(command).pipe(
				Effect.match({
					onFailure: (error) => {
						const cause = error instanceof AuthenticatedApiError ? error.cause : undefined;
						const changed = Schema.is(ReminderConflict)(cause);
						setStale(changed);
						setNotice({
							tone: "danger",
							text: changed
								? kernelMessage("client.reminders.changed")
								: kernelMessage("client.reminders.notice.unconfirmed"),
						});
					},
					onSuccess: (result) => {
						props.onChanged?.();
						submissions.current.delete(key);
						let message = kernelMessage(
							action === "cancel"
								? "client.reminders.notice.cancelled"
								: "client.reminders.notice.removed",
						);
						if (result.sendStarted) {
							message = kernelMessage("client.reminders.notice.send-started");
						}
						setNotice({ text: message, tone: "success" });
					},
				}),
			),
		);
	};
	const selected = typeof editor === "object" ? editor : undefined;
	const editorEntityId = selected?.entityId ?? props.entityId;
	return (
		<div className="grid gap-5">
			<ReminderReadiness disabled={props.disabled} />
			<div className="flex flex-wrap items-center justify-between gap-3">
				<SegmentedControl
					value={tab}
					onChange={setTab}
					optionClassName="px-3"
					label={t(kernelMessage("client.reminders.view"))}
					options={[
						{
							value: "upcoming",
							label: t(kernelMessage("client.reminders.tab.upcoming")),
							content: t(kernelMessage("client.reminders.tab.upcoming")),
						},
						{
							value: "needs",
							label: t(kernelMessage("client.reminders.state.needs-scheduling")),
							content: t(kernelMessage("client.reminders.state.needs-scheduling")),
						},
						{
							value: "history",
							label: t(kernelMessage("client.reminders.tab.history")),
							content: t(kernelMessage("client.reminders.tab.history")),
						},
					]}
				/>
				{props.entityId ? (
					<Button size="sm" disabled={writesDisabled} onClick={() => setEditor("new")}>
						<AppIcon size={14} name="plus" />
						{t(kernelMessage("client.reminders.new"))}
					</Button>
				) : null}
			</div>
			{notice ? (
				<Notice
					tone={notice.tone}
					action={
						stale ? (
							<Button size="sm" onClick={reload} variant="secondary">
								{t(kernelMessage("common.action.reload"))}
							</Button>
						) : null
					}
				>
					{t(notice.text)}
				</Notice>
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
					{t(kernelMessage("client.reminders.load-failed"))}
				</Notice>
			) : null}
			{query.isPending ? (
				<div
					role="status"
					className="grid gap-3"
					aria-label={t(kernelMessage("client.reminders.loading"))}
				>
					<Skeleton className="h-24 rounded-lg" />
					<Skeleton className="h-24 rounded-lg" />
				</div>
			) : null}
			{!query.isPending && !query.isError && reminders.length === 0 ? (
				<EmptyState
					title={t(emptyStates[tab].title)}
					icon={<AppIcon size={18} name="clock" />}
					description={t(emptyStates[tab].description)}
					className="rounded-lg border border-dashed border-border"
				/>
			) : null}
			<ul className="grid gap-3">
				{reminders.map((row) => {
					const status = t(stateLabel(row));
					const reason = row.reason === null ? undefined : t(reminderReasonMessages[row.reason]);
					return (
						<li key={row.id}>
							<Card className="grid gap-3">
								<div className="flex items-start justify-between gap-3">
									<div className="grid min-w-0 gap-1">
										{props.entityId ? null : <ReminderEntity row={row} />}
										<p className="text-body font-medium whitespace-pre-wrap text-text">
											{row.message}
										</p>
									</div>
									<Badge dot variant={statusVariant(row)}>
										{status}
									</Badge>
								</div>
								<div className="grid gap-1 text-label text-text-muted">
									<p className="flex items-center gap-1.5">
										<AppIcon size={14} name="calendar" />
										<span>
											{row.dueAt
												? formatters
														.dateTime({
															timeStyle: "short",
															dateStyle: "medium",
															timeZone: row.timezone ?? "UTC",
														})
														.format(new Date(row.dueAt))
												: t(
														kernelMessage("client.reminders.original-schedule", {
															schedule:
																row.originalSchedule?.date ??
																row.originalSchedule?.dueAt ??
																t(kernelMessage("client.reminders.not-available")),
														}),
													)}
										</span>
										{row.dueAt && row.timezone ? (
											<span className="text-text-subtle">· {row.timezone}</span>
										) : null}
									</p>
									{reason && reason !== status ? <p>{reason}</p> : null}
									{row.processingAt &&
									row.dueAt &&
									Date.parse(row.processingAt) > Date.parse(row.dueAt) ? (
										<p>
											{t(
												kernelMessage("client.reminders.processed-late", {
													time: formatters
														.dateTime({
															timeStyle: "short",
															dateStyle: "medium",
															timeZone: row.timezone ?? "UTC",
														})
														.format(new Date(row.processingAt)),
												}),
											)}
										</p>
									) : null}
									{row.outcome === "unknown" ? (
										<p>{t(kernelMessage("client.reminders.unknown-detail"))}</p>
									) : null}
									{row.outcome === "accepted" || row.outcome === "partial" ? (
										<p>{t(kernelMessage("client.reminders.accepted-detail"))}</p>
									) : null}
								</div>
								<div className="-mx-1 flex flex-wrap items-center gap-1 border-t border-border pt-2">
									{row.state === "needs-scheduling" && row.entityId ? (
										<Button size="sm" disabled={writesDisabled} onClick={() => setEditor(row)}>
											{t(kernelMessage("client.reminders.schedule"))}
										</Button>
									) : null}
									{row.state === "scheduled" && row.entityId ? (
										<Button
											size="sm"
											variant="ghost"
											disabled={writesDisabled}
											onClick={() => setEditor(row)}
										>
											<AppIcon size={14} name="pencil" />
											{t(kernelMessage("client.reminders.edit"))}
										</Button>
									) : null}
									{row.state === "scheduled" ||
									row.state === "processing" ||
									row.state === "needs-scheduling" ? (
										<Button
											size="sm"
											variant="dangerGhost"
											onClick={() => change(row, "cancel")}
											disabled={writesDisabled || mutation.isPending}
										>
											<AppIcon size={14} name="circle-x" />
											{t(kernelMessage("client.reminders.cancel"))}
										</Button>
									) : (
										<>
											{row.entityId && row.replacementId === null ? (
												<Button
													size="sm"
													variant="ghost"
													disabled={writesDisabled}
													onClick={() => setEditor(row)}
												>
													<AppIcon size={14} name="rotate-ccw" />
													{t(kernelMessage("client.reminders.schedule-again"))}
												</Button>
											) : null}
											<Button
												size="sm"
												variant="ghost"
												onClick={() => change(row, "remove")}
												disabled={writesDisabled || mutation.isPending}
											>
												<AppIcon size={14} name="archive" />
												{t(kernelMessage("client.reminders.remove-history"))}
											</Button>
										</>
									)}
									{row.processingAt !== null ? (
										<Button
											size="sm"
											variant="ghost"
											className="ml-auto"
											aria-expanded={detail === row.id}
											onClick={() => setDetail(detail === row.id ? null : row.id)}
										>
											{t(kernelMessage("client.reminders.channel-outcomes"))}
											<AppIcon size={14} name={detail === row.id ? "chevron-up" : "chevron-down"} />
										</Button>
									) : null}
								</div>
								{detail === row.id ? (
									<ReminderDeliveries reminderId={row.id} processing={row.state === "processing"} />
								) : null}
							</Card>
						</li>
					);
				})}
			</ul>
			{query.hasNextPage ? (
				<LoadMoreButton
					onClick={() => query.fetchNextPage()}
					isFetchingNextPage={query.isFetchingNextPage}
				/>
			) : null}
			{editor !== null && editorEntityId ? (
				<ReminderEditor
					onReload={reload}
					entityId={editorEntityId}
					initial={selected ?? undefined}
					onClose={() => setEditor(null)}
					parentEntityId={selected?.parentEntityId ?? props.parentEntityId ?? null}
					onSaved={() => {
						props.onChanged?.();
						setEditor(null);
						query.refetch();
					}}
				/>
			) : null}
		</div>
	);
}

function ReminderEntity(props: { readonly row: Reminder }) {
	const t = useT();
	return props.row.entityId ? (
		<Link
			to="/e/$entityId"
			params={{ entityId: props.row.entityId }}
			className="truncate text-label font-medium text-text-muted hover:text-text hover:underline"
		>
			{props.row.entityTitle ?? t(kernelMessage("client.reminders.entity"))}
		</Link>
	) : (
		<span className="truncate text-label font-medium text-text-muted">
			{props.row.entityTitle ?? t(kernelMessage("client.reminders.entity-unavailable"))}
		</span>
	);
}
