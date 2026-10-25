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
import { Button, Select, TextField } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useId, useState } from "react";

const groupingChoices = [
	{ value: "auto", label: "Automatic" },
	{ value: "day", label: "Day" },
	{ value: "week", label: "Week" },
	{ value: "month", label: "Month" },
	{ value: "year", label: "Year" },
] as const;

const comparisonChoices = [
	{ value: "none", label: "None" },
	{ value: "previous-period", label: "Previous period" },
] as const;

type CustomDateDraft = {
	readonly endDate: string;
	readonly startDate: string;
	readonly dateError: boolean;
};

/** Remount with a key derived from `selection` so an unapplied custom-date draft resets on navigation. */
export function AnalyticsControls({
	compact,
	timeZone,
	selection,
	onSelectionChange,
}: {
	readonly compact: boolean;
	readonly timeZone: TimeZone;
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
	let previousCaption = "No comparison selected.";
	if (resolved.previous !== null) {
		previousCaption = `Previous period: ${periodCaption(resolved.previous)}`;
	} else if (allTime) {
		previousCaption = "No comparison for all time.";
	}

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
		<section
			aria-label="Analytics controls"
			className="grid gap-4 rounded-lg border border-border p-4"
		>
			<div className={`grid gap-3 ${compact ? "grid-cols-1" : "grid-cols-3"}`}>
				<div className="min-w-0">
					<Select
						label="Date range"
						value={selectedRange}
						onChange={changeRange}
						choices={reportingRangeOptions}
						checkIcon={<AppIcon size={14} name="check" />}
						chevronIcon={<AppIcon size={14} name="chevron-down" />}
					/>
				</div>
				<div className="min-w-0">
					<Select
						disabled={allTime}
						label="Compare with"
						choices={comparisonChoices}
						checkIcon={<AppIcon size={14} name="check" />}
						value={allTime ? "none" : selection.comparison}
						chevronIcon={<AppIcon size={14} name="chevron-down" />}
						onChange={(value) => {
							if (Schema.is(ReportingSelection.fields.comparison)(value)) {
								onSelectionChange({ ...selection, comparison: value });
							}
						}}
					/>
				</div>
				<div className="min-w-0">
					<Select
						label="Group by"
						disabled={allTime}
						choices={groupingChoices}
						value={allTime ? "year" : selection.grouping}
						checkIcon={<AppIcon size={14} name="check" />}
						chevronIcon={<AppIcon size={14} name="chevron-down" />}
						onChange={(value) => {
							if (Schema.is(ReportingGrouping)(value)) {
								onSelectionChange({ ...selection, grouping: value });
							}
						}}
					/>
				</div>
			</div>
			{selectedRange === "custom" && (
				<div className={`grid gap-3 ${compact ? "grid-cols-1" : "grid-cols-2"}`}>
					<div className="grid content-start gap-1.5">
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
					<div className="grid content-start gap-1.5">
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
					{draft.dateError && (
						<p role="alert" id={`${id}-date-error`} className="text-xs font-medium text-danger">
							Enter valid dates with the start date on or before the end date.
						</p>
					)}
					<Button type="button" variant="outline" onClick={applyCustomDates}>
						Apply dates
					</Button>
				</div>
			)}
			<div className="grid gap-1 text-sm text-text-subtle">
				<p>Current period: {periodCaption(resolved.current)}</p>
				<p>{previousCaption}</p>
				{selection.grouping !== "auto" && !allTime && selection.grouping !== resolved.grouping && (
					<p>Grouped by {resolved.grouping} to keep charts within their bucket limit.</p>
				)}
			</div>
			<p className="flex flex-wrap items-center gap-2 text-sm text-text-subtle">
				<span>Reporting time zone: {resolved.timeZone}</span>
				<PluginLink
					to={{ kind: "kernel-page", page: "preferences" }}
					className="font-medium text-accent-text underline-offset-4 hover:underline"
				>
					Preferences
				</PluginLink>
			</p>
		</section>
	);
}
