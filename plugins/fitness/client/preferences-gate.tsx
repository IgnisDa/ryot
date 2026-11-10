import type { PluginUserPreferences } from "@ryot-app/plugin-client-sdk";
import { useUserPreferences } from "@ryot-app/plugin-client-sdk/react";
import { QueryStatus } from "@ryot-app/plugin-ui-sdk";
import type { ReactNode } from "react";

export function PreferencesGate(props: {
	readonly children: (preferences: PluginUserPreferences) => ReactNode;
}) {
	const preferences = useUserPreferences();
	return (
		<QueryStatus query={preferences} label="preferences" onRetry={preferences.refetch}>
			{props.children}
		</QueryStatus>
	);
}
