import type { TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import { useReportingPreferences } from "@ryot-app/plugin-client-sdk/react";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import type { ReactNode } from "react";

export function ReportingPreferences(props: {
	readonly children: (timeZone: TimeZone) => ReactNode;
}) {
	const preferences = useReportingPreferences();
	if (preferences.data !== undefined) {
		return props.children(preferences.data.timeZone);
	}
	if (preferences.isError) {
		return (
			<>
				<StatusMessage tone="error">Reporting preferences could not be loaded.</StatusMessage>
				<Button onClick={preferences.refetch}>Retry preferences</Button>
			</>
		);
	}
	return <StatusMessage tone="pending">Loading reporting preferences…</StatusMessage>;
}
