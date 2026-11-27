import type { PluginUserPreferences } from "@ryot-app/plugin-client-contract";
import { QueryStatus } from "@ryot-app/plugin-ui-sdk";
import type { ReactNode } from "react";

import { useUserPreferences } from "./account";

export function PreferencesGate(props: {
	readonly children: (preferences: PluginUserPreferences) => ReactNode;
}) {
	const preferences = useUserPreferences();
	return (
		<QueryStatus query={preferences} onRetry={preferences.refetch}>
			{props.children}
		</QueryStatus>
	);
}
