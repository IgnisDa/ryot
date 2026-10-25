import type { TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import { useReportingPreferences } from "@ryot-app/plugin-client-sdk/react";
import { QueryStatus } from "@ryot-app/plugin-ui-sdk";
import type { ReactNode } from "react";

export function ReportingPreferences(props: {
	readonly children: (timeZone: TimeZone) => ReactNode;
}) {
	const preferences = useReportingPreferences();
	return (
		<QueryStatus query={preferences} label="reporting preferences" onRetry={preferences.refetch}>
			{(data) => props.children(data.timeZone)}
		</QueryStatus>
	);
}
