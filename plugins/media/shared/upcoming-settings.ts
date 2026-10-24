export const UPCOMING_DAYS_AHEAD_SETTING = "upcomingDaysAhead";

export const UPCOMING_ONE_PER_TITLE_SETTING = "upcomingOnePerTitle";

export const DEFAULT_UPCOMING_DAYS_AHEAD = 14;

export const MAX_UPCOMING_DAYS_AHEAD = 365;

export const upcomingSettings = (settings: undefined | Readonly<Record<string, unknown>>) => {
	const days = settings?.[UPCOMING_DAYS_AHEAD_SETTING];
	const onePerTitle = settings?.[UPCOMING_ONE_PER_TITLE_SETTING];
	return {
		onePerTitle: typeof onePerTitle === "boolean" ? onePerTitle : true,
		daysAhead:
			typeof days === "number" && Number.isInteger(days) && days >= 1
				? Math.min(days, MAX_UPCOMING_DAYS_AHEAD)
				: DEFAULT_UPCOMING_DAYS_AHEAD,
	};
};
