import { deviceTimeZone } from "@ryot-app/contract/schema/time-zone";
import { useRyotMutation, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { useEffect, useRef } from "react";

import { initializeReportingTimeZoneMutation, preferencesQuery } from "./preferences-service";

export function ReportingTimeZoneInitialization(props: { readonly disabled: boolean }) {
	const preferences = useRyotQuery(preferencesQuery);
	const initialize = useRyotMutation(initializeReportingTimeZoneMutation);
	const attempted = useRef(false);
	useEffect(() => {
		if (props.disabled || attempted.current || preferences.data?.reportingTimeZone !== null) {
			return;
		}
		attempted.current = true;
		initialize.mutate(deviceTimeZone());
	}, [props.disabled, preferences.data, initialize]);
	return null;
}
