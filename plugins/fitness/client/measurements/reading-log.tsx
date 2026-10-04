import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
	useRyotMutation,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Card,
	DestructiveConfirmation,
	LoadMoreButton,
	StatusMessage,
} from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";
import { Fragment, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { sectionHeadingClass } from "../exercise/styles";
import { formatNumber } from "../workout/format";
import {
	formatDay,
	formatTime,
	formatValue,
	groupByMonth,
	groupReadings,
	rangePhrase,
	type MonthSection,
	type RangeKey,
	type ReadingGroup,
	type ReadingValue,
} from "./model";
import { deleteReadingsMutation, readingFailureMessage, updateReadingsMutation } from "./mutations";
import { readingsQuery } from "./queries";
import { MeasurementDialog } from "./reading-composer";
import { tableHeaderClass } from "./styles";

type LogMetric = { readonly id: string; readonly name: string; readonly unit: string | null };

function ValueCell(props: { readonly reading: ReadingValue | undefined }) {
	const { reading } = props;
	if (reading === undefined) {
		return <td className="px-3 py-2 text-right text-border-strong">—</td>;
	}
	const difference = reading.previous === null ? null : reading.value - reading.previous;
	return (
		<td className="px-3 py-2 text-right tabular-nums">
			{formatNumber(reading.value)}
			{difference === null ? null : (
				<span className="block text-[11.5px] text-text-subtle">
					{formatNumber(Math.abs(difference)) === "0"
						? "no change"
						: `${difference > 0 ? "▲" : "▼"} ${formatNumber(Math.abs(difference))}`}
				</span>
			)}
		</td>
	);
}

const actionButtonClass = "rounded-md border border-border px-2 py-0.5 text-[12px] text-text-muted";

function EditMeasurementDialog(props: {
	readonly group: ReadingGroup;
	readonly onClose: () => void;
	readonly metrics: readonly LogMetric[];
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const { group, metrics, onClose } = props;
	const update = useRyotMutation(updateReadingsMutation);
	useEffect(() => {
		if (update.data !== undefined) {
			onClose();
		}
	}, [update.data, onClose]);
	const [initial] = useState(() => ({
		comment: group.comment,
		occurredAt: group.occurredAt,
		values: metrics.flatMap(({ id }) => {
			const reading = group.values.get(id);
			return reading === undefined ? [] : [{ metricId: id, value: reading.value }];
		}),
	}));
	return (
		<MeasurementDialog
			initial={initial}
			metrics={metrics}
			onClose={onClose}
			submitLabel="Save"
			pendingLabel="Saving…"
			onChange={update.reset}
			label="Edit measurement"
			pending={update.isPending}
			triggerRef={props.triggerRef}
			errorMessage={readingFailureMessage(update.error, "edit")}
			onSubmit={(readings) =>
				update.mutate({ ...readings, readingIds: [...group.values.values()].map(({ id }) => id) })
			}
		/>
	);
}

function DeleteMeasurementConfirmation(props: {
	readonly group: ReadingGroup;
	readonly takenAt: string;
	readonly onClose: () => void;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const { group, onClose, takenAt } = props;
	const remove = useRyotMutation(deleteReadingsMutation);
	useEffect(() => {
		if (remove.data !== undefined) {
			onClose();
		}
	}, [remove.data, onClose]);
	const count = group.values.size;
	return (
		<DestructiveConfirmation
			onClose={onClose}
			pendingLabel="Deleting…"
			pending={remove.isPending}
			title="Delete measurement?"
			triggerRef={props.triggerRef}
			actionLabel="Delete measurement"
			errorMessage={readingFailureMessage(remove.error, "delete")}
			onConfirm={() =>
				remove.mutate({ readingIds: [...group.values.values()].map(({ id }) => id) })
			}
			detail={`The ${count === 1 ? "reading" : `${count} readings`} taken on ${takenAt} will be removed permanently.`}
		/>
	);
}

function ReadingActions(props: {
	readonly timeZone: string;
	readonly group: ReadingGroup;
	readonly metrics: readonly LogMetric[];
}) {
	const { group, metrics, timeZone } = props;
	const editTrigger = useRef<HTMLButtonElement>(null);
	const deleteTrigger = useRef<HTMLButtonElement>(null);
	const [editing, setEditing] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const takenAt = `${formatDay(group.occurredAt, timeZone)} ${formatTime(group.occurredAt, timeZone)}`;
	return (
		<td className="px-3 py-2 text-right whitespace-nowrap">
			<button
				type="button"
				ref={editTrigger}
				onClick={() => setEditing(true)}
				className={clsx(actionButtonClass, "mr-1")}
				aria-label={`Edit measurement from ${takenAt}`}
			>
				Edit
			</button>
			<button
				type="button"
				ref={deleteTrigger}
				className={actionButtonClass}
				onClick={() => setConfirming(true)}
				aria-label={`Delete measurement from ${takenAt}`}
			>
				Delete
			</button>
			{confirming ? (
				<DeleteMeasurementConfirmation
					group={group}
					takenAt={takenAt}
					triggerRef={deleteTrigger}
					onClose={() => setConfirming(false)}
				/>
			) : null}
			{editing ? (
				<EditMeasurementDialog
					group={group}
					metrics={metrics}
					triggerRef={editTrigger}
					onClose={() => setEditing(false)}
				/>
			) : null}
		</td>
	);
}

export function ReadingLogTable(props: {
	readonly timeZone: string;
	readonly columns: readonly LogMetric[];
	readonly metrics: readonly LogMetric[];
	readonly sections: readonly MonthSection[];
}) {
	const { columns, metrics, sections, timeZone } = props;
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const columnIds = new Set(columns.map(({ id }) => id));
	const span = columns.length + 4;
	const toggle = (occurredAt: string) =>
		setExpanded((current) => {
			const next = new Set(current);
			if (!next.delete(occurredAt)) {
				next.add(occurredAt);
			}
			return next;
		});
	return (
		<Card padding="none" className="overflow-x-auto">
			<table className="w-full min-w-150 border-collapse text-[14px]">
				<thead>
					<tr>
						<th scope="col" className={tableHeaderClass}>
							Date
						</th>
						{columns.map(({ id, name, unit }) => (
							<th key={id} scope="col" className={clsx(tableHeaderClass, "text-right")}>
								{name}
								{unit === null || unit === "" ? null : (
									<span className="tracking-normal normal-case"> ({unit})</span>
								)}
							</th>
						))}
						<th scope="col" className={tableHeaderClass}>
							Other
						</th>
						<th scope="col" className={tableHeaderClass}>
							Note
						</th>
						<th scope="col" className={tableHeaderClass}>
							<span className="sr-only">Actions</span>
						</th>
					</tr>
				</thead>
				<tbody>
					{sections.map((section) => (
						<Fragment key={section.label}>
							<tr>
								<th
									colSpan={span}
									scope="colgroup"
									className="bg-bg px-3 py-1.75 text-left font-display text-[14px] font-semibold text-text"
								>
									{section.label}
									<span className="ml-2 font-ui text-[12.5px] font-normal text-text-muted">
										{section.groups.length} reading{section.groups.length === 1 ? "" : "s"}
									</span>
								</th>
							</tr>
							{section.groups.map((group) => {
								const others = metrics.filter(
									({ id }) => !columnIds.has(id) && group.values.has(id),
								);
								const open = expanded.has(group.occurredAt);
								return (
									<Fragment key={group.occurredAt}>
										<tr className="border-t border-border">
											<td className="px-3 py-2 whitespace-nowrap">
												{formatDay(group.occurredAt, timeZone)}{" "}
												<span className="text-[12.5px] text-text-muted tabular-nums">
													{formatTime(group.occurredAt, timeZone)}
												</span>
											</td>
											{columns.map(({ id }) => (
												<ValueCell key={id} reading={group.values.get(id)} />
											))}
											<td className="px-3 py-2">
												{others.length === 0 ? (
													<span className="text-text-subtle">—</span>
												) : (
													<button
														type="button"
														aria-expanded={open}
														onClick={() => toggle(group.occurredAt)}
														className="rounded-md border border-border px-2 py-0.5 text-[12px] whitespace-nowrap text-text-muted"
													>
														{open ? "Hide" : `+${others.length}`}
													</button>
												)}
											</td>
											<td className="px-3 py-2">{group.comment}</td>
											<ReadingActions group={group} metrics={metrics} timeZone={timeZone} />
										</tr>
										{open ? (
											<tr>
												<td />
												<td colSpan={span - 1} className="px-3 pb-2">
													<ul className="flex flex-wrap gap-1.5">
														{others.map(({ id, name, unit }) => (
															<li
																key={id}
																className="rounded-md bg-surface-2 px-2.25 py-0.75 text-[12.5px] tabular-nums"
															>
																<span className="mr-1.25 text-text-muted">{name}</span>
																{formatValue(group.values.get(id)?.value ?? 0, unit)}
															</li>
														))}
													</ul>
												</td>
											</tr>
										) : null}
									</Fragment>
								);
							})}
						</Fragment>
					))}
				</tbody>
			</table>
		</Card>
	);
}

function LogPlaceholder(props: { readonly failed: boolean; readonly onRetry: () => void }) {
	if (!props.failed) {
		return <StatusMessage tone="pending">Loading readings…</StatusMessage>;
	}
	return (
		<div className="flex flex-col items-start gap-3">
			<StatusMessage tone="error">The reading log couldn't be loaded.</StatusMessage>
			<Button variant="secondary" onClick={props.onRetry}>
				Try again
			</Button>
		</div>
	);
}

export function ReadingLog(props: {
	readonly range: RangeKey;
	readonly timeZone: string;
	readonly columns: readonly LogMetric[];
	readonly metrics: readonly LogMetric[];
}) {
	const { range, columns, metrics, timeZone } = props;
	const result = useRyotInfiniteQuery(
		readingsQuery,
		{ range },
		{
			initialPageParam: undefined,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, after: string | undefined) => ({ ...input, after }),
		},
	);
	const readings = useMemo(
		() =>
			paginationItems(
				result.pages,
				(page) => page.items,
				({ id }) => id,
			),
		[result.pages],
	);
	const groups = useMemo(() => groupReadings(readings), [readings]);
	const sections = useMemo(() => groupByMonth(groups, timeZone), [groups, timeZone]);
	return (
		<section aria-label="Log" className="flex min-w-0 flex-col gap-2.5 font-ui">
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<h2 className={sectionHeadingClass}>Log</h2>
				{result.pages.length === 0 ? null : (
					<span className="text-[13px] text-text-muted tabular-nums">
						{groups.length}
						{result.hasNextPage ? "+" : ""} reading{groups.length === 1 ? "" : "s"} in{" "}
						{range === "All" ? "your history" : `the last ${rangePhrase(range)}`}
					</span>
				)}
			</div>
			{result.pages.length === 0 ? (
				<LogPlaceholder onRetry={result.retry} failed={result.isError} />
			) : (
				<>
					<ReadingLogTable
						columns={columns}
						metrics={metrics}
						sections={sections}
						timeZone={timeZone}
					/>
					{result.isError ? (
						<div className="flex flex-col items-start gap-3">
							<StatusMessage tone="error">More readings couldn't be loaded.</StatusMessage>
							<Button variant="secondary" onClick={result.retry} disabled={result.isFetching}>
								Try again
							</Button>
						</div>
					) : null}
					{result.hasNextPage && !result.isError ? (
						<LoadMoreButton
							variant="secondary"
							className="self-center"
							label="Show more readings"
							disabled={result.isFetching}
							onClick={result.fetchNextPage}
							isFetchingNextPage={result.isFetchingNextPage}
						/>
					) : null}
				</>
			)}
		</section>
	);
}
