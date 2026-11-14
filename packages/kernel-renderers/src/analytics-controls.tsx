import { Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	periodCaption,
	PluginLink,
	ReportingGrouping,
	reportingRangeOptions,
	reportingRangeValue,
	ReportingSelection,
	resolveReportingSelection,
	type TimeZone,
} from "@ryot-app/plugin-client-sdk/plugin";
import { useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { Button, MenuSelect, TextField } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { type ReactNode, useId, useState } from "react";

const groupingChoices = [
	{ value: "auto", label: "Auto" },
	{ value: "day", label: "Day" },
	{ value: "week", label: "Week" },
	{ value: "month", label: "Month" },
	{ value: "year", label: "Year" },
] as const;

const comparisonChoices = [
	{ label: "Off", value: "none" },
	{ value: "previous-period", label: "Previous period" },
] as const;

type CustomDateDraft = {
	readonly endDate: string;
	readonly startDate: string;
	readonly dateError: boolean;
};

/** Remount with a key derived from `selection` so an unapplied custom-date draft resets on navigation. */
export function AnalyticsControls({
	leading,
	compact,
	timeZone,
	selection,
	onSelectionChange,
}: {
	readonly compact: boolean;
	readonly timeZone: TimeZone;
	readonly leading?: ReactNode;
	readonly selection: ReportingSelection;
	readonly onSelectionChange: (selection: ReportingSelection) => void;
}) {
	const schedule = useRyotSchedule();
	const id = useId();
	const [customDraft, setCustomDraft] = useState<null | CustomDateDraft>(null);
	const resolved = resolveReportingSelection(selection, { timeZone, now: schedule.now() });
	const allTime = selection.range.kind === "all-time";
	const draft: CustomDateDraft = customDraft ?? {
		dateError: false,
		endDate:
			selection.range.kind === "custom"
				? selection.range.endDate
				: (resolved.current?.endDate ?? ""),
		startDate:
			selection.range.kind === "custom"
				? selection.range.startDate
				: (resolved.current?.startDate ?? ""),
	};
	const selectedRange = customDraft === null ? reportingRangeValue(selection.range) : "custom";
	const icons = {
		checkIcon: <AppIcon size={14} name="check" />,
		chevronIcon: <AppIcon size={14} name="chevron-down" />,
	};

	const changeRange = (value: string) => {
		const range = reportingRangeOptions.find((option) => option.value === value)?.range;
		if (value === "custom") {
			setCustomDraft(draft);
		} else if (range) {
			onSelectionChange({
				...selection,
				range,
				comparison: range.kind === "all-time" ? "none" : selection.comparison,
			});
		}
	};

	const applyCustomDates = () => {
		const decoded = Schema.decodeResult(ReportingSelection)({
			...selection,
			range: { kind: "custom", endDate: draft.endDate, startDate: draft.startDate },
		});
		if (Result.isFailure(decoded)) {
			setCustomDraft({ ...draft, dateError: true });
		} else {
			onSelectionChange(decoded.success);
		}
	};

	return (
		<section aria-label="Analytics controls" className="flex min-w-0 flex-col gap-3">
			<div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
				{leading}
				<div className={`flex min-w-0 flex-wrap items-center gap-2 ${compact ? "" : "ml-auto"}`}>
					<MenuSelect
						{...icons}
						label="Range"
						value={selectedRange}
						onChange={changeRange}
						choices={reportingRangeOptions}
					/>
					<MenuSelect
						{...icons}
						label="Compare"
						disabled={allTime}
						choices={comparisonChoices}
						value={allTime ? "none" : selection.comparison}
						onChange={(value) => onSelectionChange({ ...selection, comparison: value })}
					/>
					<MenuSelect
						{...icons}
						label="Group by"
						disabled={allTime}
						choices={groupingChoices}
						value={allTime ? "year" : selection.grouping}
						onChange={(value) => {
							if (Schema.is(ReportingGrouping)(value)) {
								onSelectionChange({ ...selection, grouping: value });
							}
						}}
					/>
				</div>
			</div>
			{selectedRange === "custom" && (
				<div className="flex min-w-0 flex-wrap items-end gap-3">
					<div className="grid min-w-0 gap-1.5">
						<label htmlFor={`${id}-start-date`} className="text-label font-medium text-text">
							Start date
						</label>
						<TextField
							type="date"
							id={`${id}-start-date`}
							value={draft.startDate}
							invalid={draft.dateError}
							aria-describedby={draft.dateError ? `${id}-date-error` : undefined}
							onChange={(event) =>
								setCustomDraft({ ...draft, startDate: event.currentTarget.value })
							}
						/>
					</div>
					<div className="grid min-w-0 gap-1.5">
						<label htmlFor={`${id}-end-date`} className="text-label font-medium text-text">
							End date
						</label>
						<TextField
							type="date"
							id={`${id}-end-date`}
							value={draft.endDate}
							invalid={draft.dateError}
							aria-describedby={draft.dateError ? `${id}-date-error` : undefined}
							onChange={(event) => setCustomDraft({ ...draft, endDate: event.currentTarget.value })}
						/>
					</div>
					<Button type="button" variant="secondary" onClick={applyCustomDates}>
						Apply dates
					</Button>
					{draft.dateError && (
						<p
							role="alert"
							id={`${id}-date-error`}
							className="w-full text-xs font-medium text-danger"
						>
							Enter valid dates with the start date on or before the end date.
						</p>
					)}
				</div>
			)}
			<p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-label text-text-muted">
				<span className="font-medium text-text">{periodCaption(resolved.current)}</span>
				{resolved.previous === null ? null : (
					<span>· compared with {periodCaption(resolved.previous)}</span>
				)}
				{selection.grouping !== "auto" && !allTime && selection.grouping !== resolved.grouping && (
					<span>· grouped by {resolved.grouping} to stay within the chart limit</span>
				)}
				<span>· times in {resolved.timeZone}</span>
				<PluginLink
					to={{ kind: "kernel-page", page: "preferences" }}
					className="font-medium text-accent-text underline-offset-4 hover:underline"
				>
					Change
				</PluginLink>
			</p>
		</section>
	);
}
