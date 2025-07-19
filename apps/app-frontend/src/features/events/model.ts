import { dayjs } from "@ryot/ts-utils";

import type { ApiGetResponseData } from "~/lib/api/types";

type ApiEvent = ApiGetResponseData<"/events">[number];

export type AppEvent = Omit<ApiEvent, "createdAt" | "updatedAt"> & {
	createdAt: Date;
	updatedAt: Date;
};

export type EventListViewState = { type: "empty" } | { type: "list"; events: AppEvent[] };

export function sortEvents(events: AppEvent[]) {
	return events.toSorted((a, b) => {
		return dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf();
	});
}

export function getEventListViewState(events: AppEvent[]): EventListViewState {
	if (events.length === 0) {
		return { type: "empty" };
	}

	return { type: "list", events: sortEvents(events) };
}

export function getRecentEvents(events: AppEvent[], limit = 3) {
	return sortEvents(events).slice(0, limit);
}

export function toAppEvent(event: ApiEvent): AppEvent {
	return {
		...event,
		createdAt: dayjs(event.createdAt).toDate(),
		updatedAt: dayjs(event.updatedAt).toDate(),
	};
}
