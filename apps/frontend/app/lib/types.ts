export enum FitnessEntity {
	Workouts = "workouts",
	Templates = "templates",
}

export enum TimeSpan {
	Last7Days = "Last 7 days",
	Last30Days = "Last 30 days",
	Last90Days = "Last 90 days",
	Last365Days = "Last 365 days",
	AllTime = "All Time",
}

export enum ThreePointSmileyRating {
	Happy = "Happy",
	Neutral = "Neutral",
	Sad = "Sad",
}

export enum FitnessAction {
	LogWorkout = "log-workout",
	UpdateWorkout = "update-workout",
	CreateTemplate = "create-template",
}

export enum Verb {
	Read = 0,
}

export enum ApplicationTimeRange {
	Yesterday = "Yesterday",
	Past7Days = "Past 7 Days",
	Past30Days = "Past 30 Days",
	Past6Months = "Past 6 Months",
	Past12Months = "Past 12 Months",
	ThisWeek = "This Week",
	ThisMonth = "This Month",
	ThisYear = "This Year",
	AllTime = "All Time",
	Custom = "Custom",
}

export type AppServiceWorkerNotificationTag = "timer-completed";

export type AppServiceWorkerNotificationData = {
	event: "open-link";
	link?: string;
};

export type AppServiceWorkerMessageData = {
	event: "remove-timer-completed-notification";
};

export interface SendNotificationProps {
	body: string;
	title: string;
	tag?: AppServiceWorkerNotificationTag;
	data?: AppServiceWorkerNotificationData;
}

export type TimestampToStringResult<T> = T extends Date | string
	? string
	: null;

export type FilterUpdateFunction<T> = <K extends keyof T>(
	key: K,
	value: T[K] | null,
) => void;
