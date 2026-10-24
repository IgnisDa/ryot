import { isNamedTimeZone } from "@ryot-app/contract/schema/utils";
import { useRyotMutation, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { useEffect, useRef } from "react";

import { initializeReportingTimeZoneMutation, preferencesQuery } from "./preferences-service";

export const deviceReportingTimeZone = (read: () => string | undefined): string => {
	try {
		const zone = read();
		return zone !== undefined && isNamedTimeZone(zone) ? zone : "UTC";
	} catch {
		return "UTC";
	}
};

export function ReportingTimeZoneInitialization(props: { readonly disabled: boolean }) {
	const preferences = useRyotQuery(preferencesQuery);
	const initialize = useRyotMutation(initializeReportingTimeZoneMutation);
	const attempted = useRef(false);
	useEffect(() => {
		if (props.disabled || attempted.current || preferences.data?.reportingTimeZone !== null) {
			return;
		}
		attempted.current = true;
		initialize.mutate(
			deviceReportingTimeZone(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
		);
	}, [props.disabled, preferences.data, initialize]);
	return null;
}
