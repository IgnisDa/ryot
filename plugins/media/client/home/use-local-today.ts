import { useRyotSchedule } from "@ryot-app/client-sdk/react";
import { useEffect, useState } from "react";

import { formatLocalDateKey } from "../media/date";

const nextLocalMidnight = (now: number) => {
	const date = new Date(now);
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
};

/** The local `YYYY-MM-DD` date, re-rendering at each local midnight. */
export const useLocalToday = () => {
	const schedule = useRyotSchedule();
	const [now, setNow] = useState(() => schedule.now());
	useEffect(
		() => schedule.after(nextLocalMidnight(now) - now, () => setNow(schedule.now())),
		[schedule, now],
	);
	return formatLocalDateKey(new Date(now).toISOString());
};
