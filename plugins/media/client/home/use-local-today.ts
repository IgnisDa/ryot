import {
	addCalendarDays,
	localDateOf,
	startOfLocalDay,
	UTC,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	usePageRefreshRequest,
	useRyotSchedule,
	useUserPreferences,
} from "@ryot-app/plugin-client-sdk/react";
import { useEffect, useState } from "react";

export const useLocalToday = () => {
	const timeZone = useUserPreferences().data?.timeZone ?? UTC;
	const schedule = useRyotSchedule();
	const requestPageRefresh = usePageRefreshRequest();
	const [now, setNow] = useState(() => schedule.now());
	const today = localDateOf(now, timeZone);
	useEffect(() => {
		const next = Date.parse(startOfLocalDay(addCalendarDays(today, 1), timeZone));
		return schedule.after(next - now, () => {
			setNow(schedule.now());
			requestPageRefresh();
		});
	}, [schedule, now, requestPageRefresh, timeZone, today]);
	return today;
};
