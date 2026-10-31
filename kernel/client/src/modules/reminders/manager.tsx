import { ReminderConflict, type ReminderState } from "@ryot-app/contract/modules/reminders/schemas";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
	useRyotMutation,
	useRyotSchedule,
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
import { ReminderReadiness } from "./readiness";
import { type ReminderCommand, reminderCommandMutation, remindersQuery } from "./service";

type Reminder = RemindersResult["items"][number];
const states: Readonly<Record<string, ReadonlyArray<ReminderState>>> = {
	needs: ["needs-scheduling"],
	history: ["settled", "cancelled"],
	upcoming: ["scheduled", "processing"],
};
const labels = {
	failed: "Failed",
	"not-sent": "Not sent",
	unknown: "Delivery unknown",
	partial: "Partially accepted",
	accepted: "Accepted by providers",
};
const initialCursor: string | undefined = undefined;

const stateLabels = {
	settled: "Completed",
	cancelled: "Cancelled",
	scheduled: "Scheduled",
	processing: "Processing",
	"needs-scheduling": "Needs scheduling",
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
const emptyStates: Readonly<Record<string, { title: string; description: string }>> = {
	history: {
		title: "No reminder history",
		description: "Sent and cancelled reminders appear here.",
	},
	upcoming: {
		title: "No upcoming reminders",
		description: "Scheduled reminders appear here until they are sent.",
	},
	needs: {
		title: "Nothing needs scheduling",
		description: "Reminders that need a new time before they can be sent appear here.",
	},
};

export function ReminderManager(props: {
	readonly disabled?: boolean;
	readonly onChanged?: () => void;
	readonly entityId?: EntityId | undefined;
	readonly parentEntityId?: null | EntityId | undefined;
}) {
	const schedule = useRyotSchedule();
	const [tab, setTab] = useState("upcoming");
	const [editor, setEditor] = useState<null | "new" | Reminder>(null);
	const [notice, setNotice] = useState<null | { text: string; tone: "danger" | "success" }>(null);
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
			request: {
				params: { reminderId: row.id },
				payload: {
					revision: row.revision,
					idempotencyKey: crypto.randomUUID(),
					submittedAt: new Date(schedule.now()).toISOString(),
				},
			},
		};
		submissions.current.set(key, command);
		void Effect.runPromise(
			mutation.mutateEffect(command).pipe(
				Effect.match({
					onSuccess: (result) => {
						props.onChanged?.();
						submissions.current.delete(key);
						let message = action === "cancel" ? "Reminder cancelled." : "Reminder history removed.";
						if (result.sendStarted) {
							message = "Cancelled unsent work. A send already started and cannot be recalled.";
						}
						setNotice({ text: message, tone: "success" });
					},
					onFailure: (error) => {
						const cause = error instanceof AuthenticatedApiError ? error.cause : undefined;
						const changed = Schema.is(ReminderConflict)(cause);
						setStale(changed);
						setNotice({
							tone: "danger",
							text: changed
								? "This reminder changed. Reload before you continue."
								: "The result could not be confirmed. Retry the same action to reuse its submission.",
						});
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
					label="Reminder view"
					optionClassName="px-3"
					options={[
						{ value: "upcoming", label: "Upcoming", content: "Upcoming" },
						{ value: "needs", label: "Needs scheduling", content: "Needs scheduling" },
						{ value: "history", label: "History", content: "History" },
					]}
				/>
				{props.entityId ? (
					<Button size="sm" disabled={writesDisabled} onClick={() => setEditor("new")}>
						<AppIcon size={14} name="plus" />
						New reminder
					</Button>
				) : null}
			</div>
			{notice ? (
				<Notice
					tone={notice.tone}
					action={
						stale ? (
							<Button size="sm" onClick={reload} variant="secondary">
								Reload
							</Button>
						) : null
					}
				>
					{notice.text}
				</Notice>
			) : null}
			{query.isError ? (
				<Notice
					tone="danger"
					action={
						<Button size="sm" variant="secondary" onClick={query.retry}>
							Retry
						</Button>
					}
				>
					Reminders could not be loaded.
				</Notice>
			) : null}
			{query.isPending ? (
				<div role="status" className="grid gap-3" aria-label="Loading reminders">
					<Skeleton className="h-24 rounded-lg" />
					<Skeleton className="h-24 rounded-lg" />
				</div>
			) : null}
			{!query.isPending && !query.isError && reminders.length === 0 ? (
				<EmptyState
					title={emptyStates[tab].title}
					icon={<AppIcon size={18} name="clock" />}
					description={emptyStates[tab].description}
					className="rounded-lg border border-dashed border-border"
				/>
			) : null}
			<ul className="grid gap-3">
				{reminders.map((row) => {
					const status = stateLabel(row);
					const reason = row.reason?.replaceAll("-", " ");
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
												? new Intl.DateTimeFormat(undefined, {
														timeStyle: "short",
														dateStyle: "medium",
														timeZone: row.timezone ?? "UTC",
													}).format(new Date(row.dueAt))
												: `Original schedule: ${row.originalSchedule?.date ?? row.originalSchedule?.dueAt ?? "Not available"}`}
										</span>
										{row.dueAt && row.timezone ? (
											<span className="text-text-subtle">· {row.timezone}</span>
										) : null}
									</p>
									{reason && reason !== status.toLowerCase() ? (
										<p className="first-letter:uppercase">{reason}</p>
									) : null}
									{row.processingAt &&
									row.dueAt &&
									Date.parse(row.processingAt) > Date.parse(row.dueAt) ? (
										<p>Processed after its scheduled time at {row.processingAt}.</p>
									) : null}
									{row.outcome === "unknown" ? (
										<p>
											A request may have reached a provider. It will not be resent automatically.
										</p>
									) : null}
									{row.outcome === "accepted" || row.outcome === "partial" ? (
										<p>Provider acceptance does not confirm that the recipient read the message.</p>
									) : null}
								</div>
								<div className="-mx-1 flex flex-wrap items-center gap-1 border-t border-border pt-2">
									{row.state === "needs-scheduling" && row.entityId ? (
										<Button size="sm" disabled={writesDisabled} onClick={() => setEditor(row)}>
											Schedule reminder
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
											Edit
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
											Cancel reminder
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
													Schedule again
												</Button>
											) : null}
											<Button
												size="sm"
												variant="ghost"
												onClick={() => change(row, "remove")}
												disabled={writesDisabled || mutation.isPending}
											>
												<AppIcon size={14} name="archive" />
												Remove history
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
											Channel outcomes
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
					label="Load more"
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
	return props.row.entityId ? (
		<Link
			to="/e/$entityId"
			params={{ entityId: props.row.entityId }}
			className="truncate text-label font-medium text-text-muted hover:text-text hover:underline"
		>
			{props.row.entityTitle ?? "Entity"}
		</Link>
	) : (
		<span className="truncate text-label font-medium text-text-muted">
			{props.row.entityTitle ?? "Entity no longer available"}
		</span>
	);
}
