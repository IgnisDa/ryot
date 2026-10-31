import { Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	type AnalyticsSectionProps,
	useDrillRequest,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import { usePluginUserSettings } from "@ryot-app/plugin-client-sdk/react";
import { QueryStatus, StatusMessage, tabId, Tabs } from "@ryot-app/plugin-ui-sdk";
import { type ReactNode, useId, useState } from "react";

import { WorkoutPreferenceSettingsSchema } from "../../shared/workout-editor-preferences";
import { AnalyticsMeasurements } from "./measurements";
import { AnalyticsRankings } from "./rankings";
import type {
	AnalyticsDisplayPreferences,
	AnalyticsScope,
	WorkoutDrillRequest,
} from "./reporting-model";
import { AnalyticsSummary } from "./summary";
import { AnalyticsWorkoutDrill } from "./workout-drill";
import { AnalyticsWorkouts } from "./workouts";

const decodeWorkoutPreferences = Schema.decodeUnknownResult(WorkoutPreferenceSettingsSchema);

export default function FitnessAnalyticsSection(props: AnalyticsSectionProps) {
	const settings = usePluginUserSettings(props.reference.pluginId);
	const { compact } = useRyotViewport();
	return (
		<QueryStatus query={settings} onRetry={settings.refetch} label="fitness display preferences">
			{(data) => {
				const decoded = decodeWorkoutPreferences(data);
				if (decoded._tag === "Failure") {
					return (
						<StatusMessage
							tone="error"
							action={{ onClick: settings.refetch, label: "Retry fitness display preferences" }}
						>
							Fitness display preferences are invalid.
						</StatusMessage>
					);
				}
				const preferences: AnalyticsDisplayPreferences = {
					unitSystem: decoded.success.unitSystem,
					energyUnit: decoded.success.energyUnit,
				};
				return <AnalyticsContent scope={props} compact={compact} preferences={preferences} />;
			}}
		</QueryStatus>
	);
}

function AnalyticsContent(props: {
	readonly compact: boolean;
	readonly scope: AnalyticsScope;
	readonly preferences: AnalyticsDisplayPreferences;
}) {
	const [tab, setTab] = useState<"workouts" | "rankings" | "measurements">("workouts");
	const [request, setRequest] = useDrillRequest<WorkoutDrillRequest>(props.scope);
	const panelId = useId();
	let panel: ReactNode;
	if (tab === "workouts") {
		panel = (
			<AnalyticsWorkouts
				scope={props.scope}
				compact={props.compact}
				onOpenWorkouts={setRequest}
				preferences={props.preferences}
			/>
		);
	} else if (tab === "rankings") {
		panel = (
			<AnalyticsRankings scope={props.scope} compact={props.compact} onOpenWorkouts={setRequest} />
		);
	} else {
		panel = <AnalyticsMeasurements scope={props.scope} compact={props.compact} />;
	}

	return (
		<div className={props.compact ? "grid min-w-0 gap-4" : "grid min-w-0 gap-6"}>
			<AnalyticsSummary
				scope={props.scope}
				compact={props.compact}
				preferences={props.preferences}
			/>
			<Tabs
				value={tab}
				panelId={panelId}
				onChange={setTab}
				label="Fitness analytics"
				options={[
					{ value: "workouts", label: "Workouts" },
					{ value: "rankings", label: "Rankings" },
					{ value: "measurements", label: "Measurements" },
				]}
			/>
			<div id={panelId} role="tabpanel" className="min-w-0" aria-labelledby={tabId(panelId, tab)}>
				{panel}
			</div>
			{request === null ? null : (
				<AnalyticsWorkoutDrill
					request={request}
					scope={props.scope}
					compact={props.compact}
					preferences={props.preferences}
					onClose={() => setRequest(null)}
				/>
			)}
		</div>
	);
}
