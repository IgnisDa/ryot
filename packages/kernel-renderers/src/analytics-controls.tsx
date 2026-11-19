import { kernelMessage } from "@ryot-app/kernel-messages/message";
import type { PluginUserPreferences } from "@ryot-app/plugin-client-sdk";
import { Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	PluginLink,
	ReportingGrouping,
	reportingRangeOptions,
	reportingRangeValue,
	ReportingSelection,
	resolveReportingSelection,
	type TimeZone,
	usePeriodCaption,
} from "@ryot-app/plugin-client-sdk/plugin";
import { useEntitlement, useRyotSchedule, useT } from "@ryot-app/plugin-client-sdk/react";
import { Button, entitlementActionLabel, MenuSelect, TextField } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { type ReactNode, useId, useState } from "react";

const groupings = ["auto", "day", "week", "month", "year"] as const;

const comparisons = [
	{ code: "none", value: "none" },
	{ code: "previous", value: "previous-period" },
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
	weekStart,
	selection,
	onSelectionChange,
}: {
	readonly compact: boolean;
	readonly timeZone: TimeZone;
	readonly leading?: ReactNode;
	readonly selection: ReportingSelection;
	readonly weekStart: PluginUserPreferences["weekStart"];
	readonly onSelectionChange: (selection: ReportingSelection) => void;
}) {
	const t = useT();
	const periodCaption = usePeriodCaption();
	const schedule = useRyotSchedule();
	const pro = useEntitlement("pro");
	const id = useId();
	const [customDraft, setCustomDraft] = useState<null | CustomDateDraft>(null);
	const resolved = resolveReportingSelection(selection, {
		timeZone,
		weekStart,
		now: schedule.now(),
	});
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
	const rangeChoices = reportingRangeOptions.map((option) => {
		const granted = option.entitlement === undefined || pro.granted;
		return {
			disabled: !granted,
			value: option.value,
			label:
				option.entitlement === undefined
					? t(option.label)
					: entitlementActionLabel(t, t(option.label), option.entitlement, granted),
		};
	});
	const groupingChoices = groupings.map((value) => ({
		value,
		label: t(kernelMessage("renderer.analytics.grouping", { grouping: value })),
	}));
	const comparisonChoices = comparisons.map(({ code, value }) => ({
		value,
		label: t(kernelMessage("renderer.analytics.comparison", { comparison: code })),
	}));
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
		<section
			className="flex min-w-0 flex-col gap-3"
			aria-label={t(kernelMessage("renderer.analytics.controls"))}
		>
			<div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
				{leading}
				<div className={`flex min-w-0 flex-wrap items-center gap-2 ${compact ? "" : "ml-auto"}`}>
					<MenuSelect
						{...icons}
						value={selectedRange}
						onChange={changeRange}
						choices={rangeChoices}
						label={t(kernelMessage("renderer.analytics.range"))}
					/>
					<MenuSelect
						{...icons}
						disabled={allTime}
						choices={comparisonChoices}
						value={allTime ? "none" : selection.comparison}
						label={t(kernelMessage("renderer.analytics.compare"))}
						onChange={(value) => onSelectionChange({ ...selection, comparison: value })}
					/>
					<MenuSelect
						{...icons}
						disabled={allTime}
						choices={groupingChoices}
						value={allTime ? "year" : selection.grouping}
						label={t(kernelMessage("renderer.analytics.group-by"))}
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
							{t(kernelMessage("renderer.analytics.start-date"))}
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
							{t(kernelMessage("renderer.analytics.end-date"))}
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
						{t(kernelMessage("renderer.analytics.apply-dates"))}
					</Button>
					{draft.dateError && (
						<p
							role="alert"
							id={`${id}-date-error`}
							className="w-full text-xs font-medium text-danger"
						>
							{t(kernelMessage("renderer.analytics.invalid-dates"))}
						</p>
					)}
				</div>
			)}
			<p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-label text-text-muted">
				<span className="font-medium text-text">{periodCaption(resolved.current)}</span>
				{resolved.previous === null ? null : (
					<span>
						{t(
							kernelMessage("renderer.analytics.compared-with", {
								period: periodCaption(resolved.previous),
							}),
						)}
					</span>
				)}
				{selection.grouping !== "auto" && !allTime && selection.grouping !== resolved.grouping && (
					<span>
						{t(kernelMessage("renderer.analytics.coarsened", { grouping: resolved.grouping }))}
					</span>
				)}
				<span>{t(kernelMessage("renderer.analytics.times-in", { zone: resolved.timeZone }))}</span>
				<PluginLink
					to={{ kind: "kernel-page", page: "preferences" }}
					className="font-medium text-accent-text underline-offset-4 hover:underline"
				>
					{t(kernelMessage("renderer.analytics.change-preferences"))}
				</PluginLink>
			</p>
		</section>
	);
}
