import { PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { ProgressBar } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";

import { fitnessRoute } from "../../shared/workout-editor-routes";
import { useMeasurementLogger } from "../measurements/measurement-logger";
import { summaryQuery } from "../measurements/queries";
import { LogMeasurementButton } from "./measurements-card";
import { setupSteps } from "./model";
import { homeTemplatesQuery } from "./queries";
import {
	compactLinkClass,
	goalPreferencesTarget,
	HomeCard,
	primaryLinkClass,
	SavedViewLink,
	secondaryLinkClass,
} from "./section";

const importSources = [
	{ label: "Hevy export", description: "Workouts from a Hevy CSV export" },
	{ label: "Strong App export", description: "Workouts from a Strong CSV export" },
	{ label: "OpenScale export", description: "Measurements from an OpenScale CSV export" },
] as const;

const importPage = { kind: "kernel-page", page: "import-data" } as const;

const heatCells = Array.from({ length: 13 * 7 }, (_cell, index) => ({
	index,
	level: (index * 37 + 11) % 17 < 9 - (index / 91) * 6 ? 0 : 1 + (index % 4),
}));

const levelClasses = [
	"bg-surface-2",
	"bg-chart-seq-2",
	"bg-chart-seq-3",
	"bg-chart-seq-4",
	"bg-chart-seq-5",
] as const;

export function FirstRun(props: { readonly goalSet: boolean }) {
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<Welcome />
			<div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
				<SetupChecklist goalSet={props.goalSet} />
				<BringHistory />
			</div>
		</div>
	);
}

function Welcome() {
	return (
		<section
			aria-labelledby="welcome-heading"
			className="flex flex-wrap items-center justify-between gap-6 rounded-xl border border-border bg-surface p-6 font-ui"
		>
			<div className="flex max-w-xl flex-col gap-3">
				<h2 id="welcome-heading" className="font-display text-[22px] font-semibold text-text">
					Your training starts here
				</h2>
				<p className="text-[14px] text-text-muted">
					Log a workout or bring in your history. Home then shows your week, your templates, which
					muscles you&apos;ve trained and your newest personal bests.
				</p>
				<div className="flex flex-wrap gap-2">
					<PluginLink className={primaryLinkClass} to={fitnessRoute("/workouts/new")}>
						Start your first workout
					</PluginLink>
					<PluginLink to={importPage} className={secondaryLinkClass}>
						Import history
					</PluginLink>
				</div>
			</div>
			<div aria-hidden="true" className="grid grid-flow-col grid-rows-7 gap-0.75 max-sm:hidden">
				{heatCells.map(({ index, level }) => (
					<span key={index} className={clsx("size-2.75 rounded-xs", levelClasses[level])} />
				))}
			</div>
		</section>
	);
}

function BringHistory() {
	return (
		<HomeCard
			label="Bring your history"
			title="Bring your history"
			hint="Imports add to your history and can't be undone. Importing the same file twice creates duplicates."
		>
			<div className="flex flex-col divide-y divide-border">
				{importSources.map((source) => (
					<div key={source.label} className="flex items-center gap-3 py-2.5">
						<span
							aria-hidden="true"
							className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-muted"
						>
							<AppIcon size={15} name="upload" />
						</span>
						<span className="flex min-w-0 flex-1 flex-col">
							<span className="text-[14px] font-medium text-text">{source.label}</span>
							<span className="text-[12.5px] text-text-muted">{source.description}</span>
						</span>
						<PluginLink
							to={importPage}
							className={compactLinkClass}
							aria-label={`Upload CSV for ${source.label}`}
						>
							Upload CSV
						</PluginLink>
					</div>
				))}
			</div>
			<p className="text-[13px] text-text-muted">
				Or <SavedViewLink slug="all-exercises">browse the exercise library</SavedViewLink> to plan
				your first session.
			</p>
		</HomeCard>
	);
}

function SetupChecklist(props: { readonly goalSet: boolean }) {
	const logger = useMeasurementLogger();
	const templates = useRyotQuery(homeTemplatesQuery);
	const metrics = useRyotQuery(summaryQuery, { range: "All" });
	const steps = setupSteps({
		goalSet: props.goalSet,
		hasMetric: (metrics.data?.length ?? 0) > 0,
		hasTemplate: (templates.data?.templates.length ?? 0) > 0,
	});
	const done = steps.filter((step) => step.done).length;
	const action = (key: string, label: string) => {
		if (key === "metric") {
			return <LogMeasurementButton label={label} measurement={logger} />;
		}
		const target =
			key === "goal"
				? goalPreferencesTarget
				: fitnessRoute(key === "workout" ? "/workouts/new" : "/templates/new");
		return (
			<PluginLink to={target} className={compactLinkClass}>
				{label}
			</PluginLink>
		);
	};
	return (
		<HomeCard label="Get set up" title="Get set up" hint={`${done} of ${steps.length} done`}>
			<ProgressBar value={done} tone="success" max={steps.length} label="Setup progress" />
			<div className="flex flex-col divide-y divide-border">
				{steps.map((step) => (
					<div key={step.key} className="flex items-center gap-3 py-2.5">
						<span
							aria-hidden="true"
							className={clsx(
								"flex size-5 shrink-0 items-center justify-center rounded-full border",
								step.done ? "border-success bg-success text-success-ink" : "border-border-emphasis",
							)}
						>
							{step.done ? <AppIcon size={12} name="check" /> : null}
						</span>
						<span className="flex min-w-0 flex-1 flex-col">
							<span
								className={clsx(
									"text-[14px] font-medium",
									step.done ? "text-text-muted line-through" : "text-text",
								)}
							>
								{step.title}
							</span>
							<span className="text-[12.5px] text-text-muted">{step.hint}</span>
						</span>
						{step.done ? null : action(step.key, step.action)}
					</div>
				))}
			</div>
		</HomeCard>
	);
}
