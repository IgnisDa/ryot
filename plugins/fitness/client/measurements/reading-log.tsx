import type { TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import {
	nextPageCursor,
	paginationItems,
	useBackgroundSubmission,
	useFormatters,
	useRyotInfiniteQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Card,
	DestructiveConfirmation,
	LoadMoreButton,
	StatusMessage,
} from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";
import { Fragment, type RefObject, useMemo, useRef, useState } from "react";

import { sectionHeadingClass } from "../exercise/styles";
import { useFitnessMessages } from "../messages";
import { formatNumber } from "../workout/format";
import {
	formatDay,
	formatTime,
	formatValue,
	groupByMonth,
	groupReadings,
	type MonthSection,
	type RangeKey,
	type ReadingGroup,
	type ReadingValue,
} from "./model";
import {
	deleteReadingsSubmission,
	readingFailureMessage,
	updateReadingsSubmission,
} from "./mutations";
import { readingsQuery } from "./queries";
import { MeasurementDialog } from "./reading-composer";
import { tableHeaderClass } from "./styles";

type LogMetric = { readonly id: string; readonly name: string; readonly unit: null | string };

function ValueCell(props: { readonly reading: undefined | ReadingValue }) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { reading } = props;
	if (reading === undefined) {
		return <td className="px-3 py-2 text-right text-border-strong">—</td>;
	}
	const difference = reading.previous === null ? null : reading.value - reading.previous;
	return (
		<td className="px-3 py-2 text-right tabular-nums">
			{formatNumber(formatters, reading.value)}
			{difference === null ? null : (
				<span className="block text-[11.5px] text-text-subtle">
					{formatNumber(formatters, Math.abs(difference)) === "0"
						? text("client.measurements.no-change")
						: `${difference > 0 ? "▲" : "▼"} ${formatNumber(formatters, Math.abs(difference))}`}
				</span>
			)}
		</td>
	);
}

const actionButtonClass = "rounded-md border border-border px-2 py-0.5 text-[12px] text-text-muted";

export function ReadingLog(props: {
	readonly range: RangeKey;
	readonly timeZone: TimeZone;
	readonly columns: readonly LogMetric[];
	readonly metrics: readonly LogMetric[];
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { range, columns, metrics, timeZone } = props;
	const result = useRyotInfiniteQuery(
		readingsQuery,
		{ range, timeZone },
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
	const sections = useMemo(
		() => groupByMonth(formatters, groups, timeZone),
		[formatters, groups, timeZone],
	);
	return (
		<section
			className="flex min-w-0 flex-col gap-2.5 font-ui"
			aria-label={text("client.measurements.log-heading")}
		>
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<h2 className={sectionHeadingClass}>{text("client.measurements.log-heading")}</h2>
				{result.pages.length === 0 ? null : (
					<span className="text-[13px] text-text-muted tabular-nums">
						{text(
							result.hasNextPage
								? "client.measurements.log-count-more"
								: "client.measurements.log-count",
							{ range, count: groups.length },
						)}
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
							<StatusMessage tone="error">
								{text("client.measurements.log-more-failed")}
							</StatusMessage>
							<Button variant="secondary" onClick={result.retry} disabled={result.isFetching}>
								{text("common.action.try-again")}
							</Button>
						</div>
					) : null}
					{result.hasNextPage && !result.isError ? (
						<LoadMoreButton
							variant="secondary"
							className="self-center"
							disabled={result.isFetching}
							onClick={result.fetchNextPage}
							isFetchingNextPage={result.isFetchingNextPage}
							label={text("client.measurements.log-show-more")}
						/>
					) : null}
				</>
			)}
		</section>
	);
}

export function ReadingLogTable(props: {
	readonly timeZone: TimeZone;
	readonly columns: readonly LogMetric[];
	readonly metrics: readonly LogMetric[];
	readonly sections: readonly MonthSection[];
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
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
							{text("client.workouts.column-date")}
						</th>
						{columns.map(({ id, name, unit }) => (
							<th key={id} scope="col" className={clsx(tableHeaderClass, "text-right")}>
								{name}
								{unit === null || unit === "" ? null : (
									<span className="tracking-normal normal-case">
										{" "}
										{text("client.measurements.unit-parenthesized", { unit })}
									</span>
								)}
							</th>
						))}
						<th scope="col" className={tableHeaderClass}>
							{text("client.measurements.column-other")}
						</th>
						<th scope="col" className={tableHeaderClass}>
							{text("property.note")}
						</th>
						<th scope="col" className={tableHeaderClass}>
							<span className="sr-only">{text("client.measurements.column-actions")}</span>
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
										{text("client.measurements.reading-count", { count: section.groups.length })}
									</span>
								</th>
							</tr>
							{section.groups.map((group) => {
								const others = metrics.filter(
									({ id }) => !columnIds.has(id) && group.values.has(id),
								);
								const open = expanded.has(group.id);
								return (
									<Fragment key={group.id}>
										<tr className="border-t border-border">
											<td className="px-3 py-2 whitespace-nowrap">
												{formatDay(formatters, group.occurredAt, timeZone)}{" "}
												<span className="text-[12.5px] text-text-muted tabular-nums">
													{formatTime(formatters, group.occurredAt, timeZone)}
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
														onClick={() => toggle(group.id)}
														className="rounded-md border border-border px-2 py-0.5 text-[12px] whitespace-nowrap text-text-muted"
													>
														{open
															? text("client.measurements.hide")
															: text("client.measurements.more-count", { count: others.length })}
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
																{formatValue(
																	formatters,
																	text,
																	group.values.get(id)?.value ?? 0,
																	unit,
																)}
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
	const text = useFitnessMessages();
	if (!props.failed) {
		return <StatusMessage tone="pending">{text("client.measurements.log-loading")}</StatusMessage>;
	}
	return (
		<div className="flex flex-col items-start gap-3">
			<StatusMessage tone="error">{text("client.measurements.log-failed")}</StatusMessage>
			<Button variant="secondary" onClick={props.onRetry}>
				{text("common.action.try-again")}
			</Button>
		</div>
	);
}

function DeleteMeasurementConfirmation(props: {
	readonly takenAt: string;
	readonly group: ReadingGroup;
	readonly onClose: () => void;
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const text = useFitnessMessages();
	const { group, onClose, takenAt } = props;
	const remove = useBackgroundSubmission(deleteReadingsSubmission);
	return (
		<DestructiveConfirmation
			onClose={onClose}
			pending={remove.isSending}
			triggerRef={props.triggerRef}
			pendingLabel={text("common.status.deleting")}
			title={text("client.measurements.delete-title")}
			actionLabel={text("client.measurements.delete-action")}
			errorMessage={readingFailureMessage(text, remove.error, "delete")}
			detail={text("client.measurements.delete-detail", { takenAt, count: group.values.size })}
			onConfirm={() => remove.submit({ remove: { entryId: group.id } }, { onAccepted: onClose })}
		/>
	);
}

function EditMeasurementDialog(props: {
	readonly group: ReadingGroup;
	readonly onClose: () => void;
	readonly metrics: readonly LogMetric[];
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const text = useFitnessMessages();
	const { group, metrics, onClose } = props;
	const update = useBackgroundSubmission(updateReadingsSubmission);
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
			pending={update.isSending}
			triggerRef={props.triggerRef}
			submitLabel={text("common.action.save")}
			pendingLabel={text("common.status.saving")}
			label={text("client.measurements.edit-title")}
			closeLabel={text("client.measurements.edit-close")}
			errorMessage={readingFailureMessage(text, update.error, "edit")}
			onSubmit={(readings) =>
				update.submit({ update: { ...readings, entryId: group.id } }, { onAccepted: onClose })
			}
		/>
	);
}

function ReadingActions(props: {
	readonly timeZone: TimeZone;
	readonly group: ReadingGroup;
	readonly metrics: readonly LogMetric[];
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { group, metrics, timeZone } = props;
	const editTrigger = useRef<HTMLButtonElement>(null);
	const deleteTrigger = useRef<HTMLButtonElement>(null);
	const [editing, setEditing] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const takenAt = text("client.measurements.taken-at", {
		day: formatDay(formatters, group.occurredAt, timeZone),
		time: formatTime(formatters, group.occurredAt, timeZone),
	});
	return (
		<td className="px-3 py-2 text-right whitespace-nowrap">
			<button
				type="button"
				ref={editTrigger}
				onClick={() => setEditing(true)}
				className={clsx(actionButtonClass, "mr-1")}
				aria-label={text("client.measurements.edit-from", { takenAt })}
			>
				{text("common.action.edit")}
			</button>
			<button
				type="button"
				ref={deleteTrigger}
				className={actionButtonClass}
				onClick={() => setConfirming(true)}
				aria-label={text("client.measurements.delete-from", { takenAt })}
			>
				{text("common.action.delete")}
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
