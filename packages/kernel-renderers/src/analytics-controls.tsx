import { Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	PluginLink,
	type ReportingSelection,
	ReportingSelection as ReportingSelectionSchema,
	resolveReportingSelection,
	type TimeZone,
} from "@ryot-app/plugin-client-sdk/plugin";
import { useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { Button, Select, TextField } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useId, useState } from "react";

const rangeChoices = [
	{ value: "rolling-7", label: "Last 7 days" },
	{ value: "rolling-30", label: "Last 30 days" },
	{ value: "rolling-90", label: "Last 90 days" },
	{ value: "rolling-365", label: "Last 365 days" },
	{ value: "this-week", label: "This week" },
	{ value: "previous-week", label: "Previous week" },
	{ value: "this-month", label: "This month" },
	{ value: "previous-month", label: "Previous month" },
	{ value: "this-year", label: "This year" },
	{ value: "previous-year", label: "Previous year" },
	{ value: "custom", label: "Custom dates" },
	{ value: "all-time", label: "All time" },
] as const;

type RangeChoice = (typeof rangeChoices)[number]["value"];

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

const rangeChoice = (range: ReportingSelection["range"]): RangeChoice => {
	if (range.kind === "rolling") {
		if (range.days === 7) {
			return "rolling-7";
		}
		if (range.days === 30) {
			return "rolling-30";
		}
		if (range.days === 90) {
			return "rolling-90";
		}
		return "rolling-365";
	}
	if (range.kind === "calendar") {
		const current = range.offset === 0;
		if (range.unit === "week") {
			return current ? "this-week" : "previous-week";
		}
		if (range.unit === "month") {
			return current ? "this-month" : "previous-month";
		}
		return current ? "this-year" : "previous-year";
	}
	return range.kind === "custom" ? "custom" : "all-time";
};

type CustomDateDraft = {
	readonly endDate: string;
	readonly startDate: string;
	readonly dateError: boolean;
	readonly selectionSearch: string;
};

const customDateDraft = (
	selection: ReportingSelection,
	selectionSearch: string,
	period: null | { readonly endDate: string; readonly startDate: string },
): CustomDateDraft => ({
	selectionSearch,
	dateError: false,
	endDate: selection.range.kind === "custom" ? selection.range.endDate : (period?.endDate ?? ""),
	startDate:
		selection.range.kind === "custom" ? selection.range.startDate : (period?.startDate ?? ""),
});

const rangeForChoice = (value: string): undefined | ReportingSelection["range"] => {
	if (value === "all-time") {
		return { kind: "all-time" };
	}
	if (value === "rolling-7") {
		return { days: 7, kind: "rolling" };
	}
	if (value === "rolling-30") {
		return { days: 30, kind: "rolling" };
	}
	if (value === "rolling-90") {
		return { days: 90, kind: "rolling" };
	}
	if (value === "rolling-365") {
		return { days: 365, kind: "rolling" };
	}
	if (value === "this-week") {
		return { offset: 0, unit: "week", kind: "calendar" };
	}
	if (value === "previous-week") {
		return { offset: -1, unit: "week", kind: "calendar" };
	}
	if (value === "this-month") {
		return { offset: 0, unit: "month", kind: "calendar" };
	}
	if (value === "previous-month") {
		return { offset: -1, unit: "month", kind: "calendar" };
	}
	if (value === "this-year") {
		return { offset: 0, unit: "year", kind: "calendar" };
	}
	if (value === "previous-year") {
		return { offset: -1, unit: "year", kind: "calendar" };
	}
	return undefined;
};

const periodCaption = (period: { readonly endDate: string; readonly startDate: string }) =>
	`${period.startDate} – ${period.endDate}`;

export function AnalyticsControls({
	compact,
	timeZone,
	selection,
	locationSearch,
	onSelectionChange,
}: {
	readonly compact: boolean;
	readonly timeZone: TimeZone;
	readonly locationSearch: string;
	readonly selection: ReportingSelection;
	readonly onSelectionChange: (selection: ReportingSelection) => void;
}) {
	const schedule = useRyotSchedule();
	const id = useId();
	const selectionSearch = locationSearch;
	const [customDraft, setCustomDraft] = useState<null | CustomDateDraft>(null);
	const activeCustomDraft = customDraft?.selectionSearch === selectionSearch ? customDraft : null;
	if (customDraft !== null && activeCustomDraft === null) {
		setCustomDraft(null);
	}

	const resolved = resolveReportingSelection(selection, { timeZone, now: schedule.now() });
	const selectedRange = activeCustomDraft === null ? rangeChoice(selection.range) : "custom";
	const customDates = selectedRange === "custom";
	const startDate =
		activeCustomDraft?.startDate ??
		(selection.range.kind === "custom" ? selection.range.startDate : "");
	const endDate =
		activeCustomDraft?.endDate ??
		(selection.range.kind === "custom" ? selection.range.endDate : "");
	const updateCustomDraft = (update: Partial<Omit<CustomDateDraft, "selectionSearch">>) => {
		const draft =
			activeCustomDraft ?? customDateDraft(selection, selectionSearch, resolved.current);
		setCustomDraft({ ...draft, ...update, selectionSearch });
	};
	const currentCaption = resolved.current === null ? "All time" : periodCaption(resolved.current);
	let previousCaption: string;
	if (resolved.previous !== null) {
		previousCaption = `Previous period: ${periodCaption(resolved.previous)}`;
	} else if (selection.range.kind === "all-time") {
		previousCaption = "No comparison for all time.";
	} else {
		previousCaption = "No comparison selected.";
	}

	const changeRange = (value: string) => {
		if (value === "custom") {
			setCustomDraft(customDateDraft(selection, selectionSearch, resolved.current));
			return;
		}
		const range = rangeForChoice(value);
		if (range === undefined) {
			return;
		}
		setCustomDraft(null);
		onSelectionChange({
			...selection,
			range,
			comparison: range.kind === "all-time" ? "none" : selection.comparison,
		});
	};

	const applyCustomDates = () => {
		const draft =
			activeCustomDraft ?? customDateDraft(selection, selectionSearch, resolved.current);
		const decoded = Schema.decodeResult(ReportingSelectionSchema)({
			...selection,
			range: { kind: "custom", endDate: draft.endDate, startDate: draft.startDate },
		});
		if (Result.isFailure(decoded)) {
			updateCustomDraft({ dateError: true });
			return;
		}
		setCustomDraft(null);
		onSelectionChange(decoded.success);
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
						choices={rangeChoices}
						onChange={changeRange}
						checkIcon={<AppIcon size={14} name="check" />}
						chevronIcon={<AppIcon size={14} name="chevron-down" />}
					/>
				</div>
				<div className="min-w-0">
					<Select
						label="Compare with"
						choices={comparisonChoices}
						disabled={selection.range.kind === "all-time"}
						checkIcon={<AppIcon size={14} name="check" />}
						chevronIcon={<AppIcon size={14} name="chevron-down" />}
						value={selection.range.kind === "all-time" ? "none" : selection.comparison}
						onChange={(value) => {
							if (value === "none" || value === "previous-period") {
								onSelectionChange({ ...selection, comparison: value });
							}
						}}
					/>
				</div>
				<div className="min-w-0">
					<Select
						label="Group by"
						choices={groupingChoices}
						value={selection.grouping}
						checkIcon={<AppIcon size={14} name="check" />}
						chevronIcon={<AppIcon size={14} name="chevron-down" />}
						onChange={(value) => {
							if (
								value === "auto" ||
								value === "day" ||
								value === "week" ||
								value === "month" ||
								value === "year"
							) {
								onSelectionChange({
									...selection,
									grouping: value,
									comparison: selection.range.kind === "all-time" ? "none" : selection.comparison,
								});
							}
						}}
					/>
				</div>
			</div>
			{customDates && (
				<div className={`grid gap-3 ${compact ? "grid-cols-1" : "grid-cols-2"}`}>
					<div className="grid content-start gap-1.5">
						<label htmlFor={`${id}-start-date`} className="text-label font-medium text-text">
							Start date
						</label>
						<TextField
							type="date"
							value={startDate}
							id={`${id}-start-date`}
							invalid={activeCustomDraft?.dateError ?? false}
							aria-describedby={activeCustomDraft?.dateError ? `${id}-date-error` : undefined}
							onChange={(event) => updateCustomDraft({ startDate: event.currentTarget.value })}
						/>
					</div>
					<div className="grid content-start gap-1.5">
						<label htmlFor={`${id}-end-date`} className="text-label font-medium text-text">
							End date
						</label>
						<TextField
							type="date"
							value={endDate}
							id={`${id}-end-date`}
							invalid={activeCustomDraft?.dateError ?? false}
							onChange={(event) => updateCustomDraft({ endDate: event.currentTarget.value })}
							aria-describedby={activeCustomDraft?.dateError ? `${id}-date-error` : undefined}
						/>
					</div>
					{activeCustomDraft?.dateError && (
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
				<p>Current period: {currentCaption}</p>
				<p>{previousCaption}</p>
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
