import { Schema } from "@ryot-app/plugin-client-sdk/effect";
import { type AnalyticsSectionProps, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import { usePluginUserSettings } from "@ryot-app/plugin-client-sdk/react";
import { StatusMessage, tabId, Tabs, useValueChange } from "@ryot-app/plugin-ui-sdk";
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
	const settings = usePluginUserSettings(props.owner.pluginId);
	const { compact } = useRyotViewport();

	if (settings.data === undefined) {
		if (settings.isError) {
			return (
				<StatusMessage
					tone="error"
					action={{ onClick: settings.refetch, label: "Retry preferences" }}
				>
					Fitness display preferences could not be loaded.
				</StatusMessage>
			);
		}
		return <StatusMessage tone="pending">Loading fitness display preferences…</StatusMessage>;
	}

	const decoded = decodeWorkoutPreferences(settings.data);
	if (decoded._tag === "Failure") {
		return (
			<StatusMessage
				tone="error"
				action={{ onClick: settings.refetch, label: "Retry preferences" }}
			>
				Fitness display preferences are invalid.
			</StatusMessage>
		);
	}

	const preferences: AnalyticsDisplayPreferences = {
		unitSystem: decoded.success.unitSystem,
		energyUnit: decoded.success.energyUnit,
	};

	return (
		<div className="grid min-w-0 gap-4">
			{settings.isError ? (
				<StatusMessage
					tone="error"
					action={{ onClick: settings.refetch, label: "Retry preferences" }}
				>
					Fitness display preferences could not be refreshed. The last loaded preferences are being
					used.
				</StatusMessage>
			) : null}
			<AnalyticsContent
				scope={props}
				compact={compact}
				preferences={preferences}
				key={props.owner.pluginId}
			/>
		</div>
	);
}

function AnalyticsContent(props: {
	readonly compact: boolean;
	readonly scope: AnalyticsScope;
	readonly preferences: AnalyticsDisplayPreferences;
}) {
	const [tab, setTab] = useState<"workouts" | "rankings" | "measurements">("workouts");
	const [request, setRequest] = useState<null | WorkoutDrillRequest>(null);
	const panelId = useId();
	const scopeKey = JSON.stringify({
		timeZone: props.scope.timeZone,
		selection: props.scope.selection,
		owner: props.scope.owner.pluginId,
	});
	useValueChange(scopeKey, () => setRequest(null));
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
			<div id={panelId} role="tabpanel" aria-labelledby={tabId(panelId, tab)}>
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
