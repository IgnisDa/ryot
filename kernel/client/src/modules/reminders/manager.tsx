import { ReminderConflict, type ReminderState } from "@ryot-app/contract/modules/reminders/schemas";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
	useRyotMutation,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, LoadMoreButton, Notice, SegmentedControl } from "@ryot-app/plugin-ui-sdk";
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

export function ReminderManager(props: {
	readonly disabled?: boolean;
	readonly onChanged?: () => void;
	readonly entityId?: EntityId | undefined;
	readonly parentEntityId?: null | EntityId | undefined;
}) {
	const schedule = useRyotSchedule();
	const [tab, setTab] = useState("upcoming");
	const [editor, setEditor] = useState<null | "new" | Reminder>(null);
	const [notice, setNotice] = useState<null | string>(null);
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
						setNotice(message);
					},
					onFailure: (error) => {
						const cause = error instanceof AuthenticatedApiError ? error.cause : undefined;
						const changed = Schema.is(ReminderConflict)(cause);
						setStale(changed);
						setNotice(
							changed
								? "This reminder changed. Reload before you continue."
								: "The result could not be confirmed. Retry the same action to reuse its submission.",
						);
					},
				}),
			),
		);
	};
	const selected = typeof editor === "object" ? editor : undefined;
	const editorEntityId = selected?.entityId ?? props.entityId;
	return (
		<div className="grid gap-4">
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
					<Button disabled={writesDisabled} onClick={() => setEditor("new")}>
						New reminder
					</Button>
				) : null}
			</div>
			<p className="text-sm text-text-muted">Reminders do not change library membership.</p>
			<ReminderReadiness disabled={props.disabled} />
			{notice ? (
				<Notice tone="info">
					{notice}
					{stale ? <Button onClick={reload}>Reload</Button> : null}
				</Notice>
			) : null}
			{query.isError ? (
				<Notice tone="danger">
					Reminders could not be loaded. <Button onClick={query.retry}>Retry</Button>
				</Notice>
			) : null}
			{query.isPending ? <p role="status">Loading reminders...</p> : null}
			{!query.isPending && reminders.length === 0 ? <p>No reminders in this view.</p> : null}
			<ul className="grid gap-3">
				{reminders.map((row) => (
					<li key={row.id} className="grid gap-2 rounded-lg border border-border p-4">
						{row.entityId ? (
							<Link
								to="/e/$entityId"
								className="font-medium underline"
								params={{ entityId: row.entityId }}
							>
								{row.entityTitle ?? "Entity"}
							</Link>
						) : (
							<span className="font-medium">{row.entityTitle ?? "Entity no longer available"}</span>
						)}
						<p className="whitespace-pre-wrap">{row.message}</p>
						<p className="text-sm text-text-muted">
							{row.dueAt
								? `${new Intl.DateTimeFormat(undefined, { timeStyle: "long", dateStyle: "medium", timeZone: row.timezone ?? "UTC" }).format(new Date(row.dueAt))} (${row.timezone})`
								: `Original schedule: ${row.originalSchedule?.date ?? row.originalSchedule?.dueAt ?? "Not available"}`}
						</p>
						<p className="text-sm">
							{stateLabel(row)}
							{row.reason ? ` · ${row.reason.replaceAll("-", " ")}` : ""}
						</p>
						{row.processingAt &&
						row.dueAt &&
						Date.parse(row.processingAt) > Date.parse(row.dueAt) ? (
							<p className="text-sm text-text-muted">
								Processed after its scheduled time at {row.processingAt}.
							</p>
						) : null}
						{row.outcome === "unknown" ? (
							<p className="text-sm">
								A request may have reached a provider. It will not be resent automatically.
							</p>
						) : null}
						{row.outcome === "accepted" || row.outcome === "partial" ? (
							<p className="text-sm text-text-muted">
								Provider acceptance does not confirm that the recipient read the message.
							</p>
						) : null}
						<div className="flex flex-wrap gap-2">
							{row.processingAt !== null ? (
								<Button
									variant="ghost"
									aria-expanded={detail === row.id}
									onClick={() => setDetail(detail === row.id ? null : row.id)}
								>
									Channel outcomes
								</Button>
							) : null}
							{row.state === "scheduled" && row.entityId ? (
								<Button
									variant="secondary"
									disabled={writesDisabled}
									onClick={() => setEditor(row)}
								>
									Edit
								</Button>
							) : null}
							{row.state === "scheduled" ||
							row.state === "processing" ||
							row.state === "needs-scheduling" ? (
								<Button
									variant="secondary"
									onClick={() => change(row, "cancel")}
									disabled={writesDisabled || mutation.isPending}
								>
									Cancel reminder
								</Button>
							) : (
								<>
									{row.entityId && row.replacementId === null ? (
										<Button
											variant="secondary"
											disabled={writesDisabled}
											onClick={() => setEditor(row)}
										>
											Schedule again
										</Button>
									) : null}
									<Button
										variant="ghost"
										onClick={() => change(row, "remove")}
										disabled={writesDisabled || mutation.isPending}
									>
										Remove history
									</Button>
								</>
							)}
							{row.state === "needs-scheduling" && row.entityId ? (
								<Button disabled={writesDisabled} onClick={() => setEditor(row)}>
									Schedule reminder
								</Button>
							) : null}
						</div>
						{detail === row.id ? (
							<ReminderDeliveries reminderId={row.id} processing={row.state === "processing"} />
						) : null}
					</li>
				))}
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
