import { RyotClientError } from "@ryot-app/client-sdk";
import { Effect, Schema } from "@ryot-app/client-sdk/effect";
import { createRyotMutation, useRyotMutation, useRyotQuery } from "@ryot-app/client-sdk/react";
import { Button, DestructiveConfirmation, StatusMessage } from "@ryot-app/client-ui-sdk";
import clsx from "clsx";
import { Fragment, useMemo, useRef, useState } from "react";

import {
	MeasurementReadingDeleteInput,
	MeasurementReadingOutput,
	measurementReadingDeleteOperationSlug,
} from "../../shared/measurement-reading-operations";
import { sectionHeadingClass } from "../exercise/styles";
import {
	formatDay,
	formatNumber,
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
import { readingsQuery } from "./queries";

type LogMetric = { readonly id: string; readonly name: string; readonly unit: string | null };

const headerClass =
	"bg-surface-2 px-3 py-2 text-left text-[11.5px] font-medium tracking-wider whitespace-nowrap text-text-subtle uppercase";

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

const deleteReadingsMutation = createRyotMutation<
	{ readonly readings: typeof MeasurementReadingDeleteInput.Type; readonly onDeleted: () => void },
	typeof MeasurementReadingOutput.Type
>(({ client, input: { readings, onDeleted } }) =>
	Schema.encodeEffect(Schema.toCodecJson(MeasurementReadingDeleteInput))(readings).pipe(
		Effect.mapError(() => new RyotClientError("invalid-input")),
		Effect.flatMap((input) =>
			client.operations.invoke({
				input,
				pluginSlug: "fitness",
				output: MeasurementReadingOutput,
				slug: measurementReadingDeleteOperationSlug,
			}),
		),
		Effect.tap(() => Effect.sync(onDeleted)),
	),
);

const deleteFailureMessage = (error: Error | null) => {
	if (error === null) {
		return undefined;
	}
	return error instanceof RyotClientError && error.reason === "operation-failed"
		? "The server declined this change. Demo accounts can't delete measurements."
		: "The measurement couldn't be deleted. Try again.";
};

const actionButtonClass = "rounded-md border border-border px-2 py-0.5 text-[12px] text-text-muted";

function ReadingActions(props: { readonly timeZone: string; readonly group: ReadingGroup }) {
	const { group, timeZone } = props;
	const deleteTrigger = useRef<HTMLButtonElement>(null);
	const [confirming, setConfirming] = useState(false);
	const remove = useRyotMutation(deleteReadingsMutation);
	const takenAt = `${formatDay(group.occurredAt, timeZone)} ${formatTime(group.occurredAt, timeZone)}`;
	const count = group.values.size;
	return (
		<td className="px-3 py-2 text-right whitespace-nowrap">
			<button
				type="button"
				className={clsx(actionButtonClass, "mr-1")}
				onClick={() => console.log("TODO: edit measurement")}
			>
				Edit
			</button>
			<button
				type="button"
				ref={deleteTrigger}
				className={actionButtonClass}
				aria-label={`Delete measurement from ${takenAt}`}
				onClick={() => {
					remove.reset();
					setConfirming(true);
				}}
			>
				Delete
			</button>
			{confirming ? (
				<DestructiveConfirmation
					pendingLabel="Deleting…"
					pending={remove.isPending}
					triggerRef={deleteTrigger}
					title="Delete measurement?"
					actionLabel="Delete measurement"
					onClose={() => setConfirming(false)}
					errorMessage={deleteFailureMessage(remove.error)}
					detail={`The ${count === 1 ? "reading" : `${count} readings`} taken on ${takenAt} will be removed permanently.`}
					onConfirm={() =>
						remove.mutate({
							onDeleted: () => setConfirming(false),
							readings: { readingIds: [...group.values.values()].map(({ id }) => id) },
						})
					}
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
		<div className="overflow-x-auto rounded-xl border border-border">
			<table className="w-full min-w-150 border-collapse text-[14px]">
				<thead>
					<tr>
						<th scope="col" className={headerClass}>
							Date
						</th>
						{columns.map(({ id, name, unit }) => (
							<th key={id} scope="col" className={clsx(headerClass, "text-right")}>
								{name}
								{unit === null || unit === "" ? null : (
									<span className="tracking-normal normal-case"> ({unit})</span>
								)}
							</th>
						))}
						<th scope="col" className={headerClass}>
							Other
						</th>
						<th scope="col" className={headerClass}>
							Note
						</th>
						<th scope="col" className={headerClass}>
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
											<ReadingActions group={group} timeZone={timeZone} />
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
		</div>
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
	readonly startAt: string;
	readonly timeZone: string;
	readonly columns: readonly LogMetric[];
	readonly metrics: readonly LogMetric[];
}) {
	const { range, startAt, columns, metrics, timeZone } = props;
	const [pages, setPages] = useState(1);
	const result = useRyotQuery(readingsQuery, { pages, startAt });
	const [shown, setShown] = useState(result.data);
	if (result.data !== undefined && result.data !== shown) {
		setShown(result.data);
	}
	const groups = useMemo(() => groupReadings(shown?.items ?? []), [shown]);
	const sections = useMemo(() => groupByMonth(groups, timeZone), [groups, timeZone]);
	return (
		<section aria-label="Log" className="flex min-w-0 flex-col gap-2.5 font-ui">
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<h2 className={sectionHeadingClass}>Log</h2>
				{shown === undefined ? null : (
					<span className="text-[13px] text-text-muted tabular-nums">
						{groups.length}
						{shown.hasMore ? "+" : ""} reading{groups.length === 1 ? "" : "s"} in{" "}
						{range === "All" ? "your history" : `the last ${rangePhrase(range)}`}
					</span>
				)}
			</div>
			{shown === undefined ? (
				<LogPlaceholder failed={result.isError} onRetry={result.refetch} />
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
							<Button variant="secondary" onClick={result.refetch} disabled={result.isFetching}>
								Try again
							</Button>
						</div>
					) : null}
					{shown.hasMore && !result.isError ? (
						<Button
							variant="secondary"
							className="self-center"
							disabled={result.isFetching}
							onClick={() => setPages((current) => current + 1)}
						>
							Show more readings
						</Button>
					) : null}
				</>
			)}
		</section>
	);
}
