import { useRyotMutation, useRyotQuery } from "@ryot-app/client-sdk/react";
import type { AutomationHistoryRetryResult } from "@ryot-app/contract/modules/automations/history-schemas";
import { createFileRoute } from "@tanstack/react-router";
import { useEffectEvent, useState } from "react";

import { AutomationHistoryDetailView } from "#/modules/automation-history/detail-view";
import {
	automationHistoryDetailQuery,
	retryAutomationRunMutation,
} from "#/modules/automation-history/service";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { LoadErrorState } from "#/modules/ui/load-error-state";
import { RUN_POLL_MS, useRunPolling } from "#/modules/ui/run/use-run-polling";
import { StatusState } from "#/modules/ui/status-state";

export const Route = createFileRoute("/_authenticated/settings/automation-history/$runId")({
	component: AutomationHistoryDetailRoute,
});

function AutomationHistoryDetailRoute() {
	const { runId } = Route.useParams();
	const detail = useRyotQuery(automationHistoryDetailQuery, runId);
	const retry = useRyotMutation(retryAutomationRunMutation);
	const [retryResult, setRetryResult] = useState<AutomationHistoryRetryResult>();
	const displayed = detail.data;
	useRunPolling({
		intervalMs: RUN_POLL_MS,
		refresh: detail.refetch,
		enabled: displayed?.run.status === "queued" || displayed?.run.status === "running",
	});

	const retryRun = useEffectEvent(async () => {
		if (displayed === undefined || displayed.retryEligibility.reason !== null) {
			return;
		}
		retry.reset();
		setRetryResult(undefined);
		await retry
			.mutateAsync({ runId, expectedAttemptCount: displayed.run.attemptCount })
			.then(setRetryResult)
			.catch(() => undefined);
		detail.refetch();
	});

	let body;
	if (displayed !== undefined) {
		body = (
			<AutomationHistoryDetailView
				detail={displayed}
				retryResult={retryResult}
				isRetrying={retry.isPending}
				onRetry={() => void retryRun()}
				retryFailed={retry.status === "error"}
			/>
		);
	} else if (detail.isError) {
		body = (
			<LoadErrorState
				onRetry={detail.refetch}
				title="Unable to load this automation run"
				detail="This run could not be loaded. It may no longer be retained on your server."
			/>
		);
	} else {
		body = <StatusState className="py-16" detail="Loading this automation run..." />;
	}

	return (
		<SettingsFrame
			backFallbackHref="/settings/automation-history"
			title={displayed?.run.hookName ?? "Automation run"}
		>
			{body}
		</SettingsFrame>
	);
}
