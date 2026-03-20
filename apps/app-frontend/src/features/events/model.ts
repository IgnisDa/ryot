import type { ApiGetResponseData } from "#/lib/api/types";

type ApiEvent = ApiGetResponseData<"/events">[number];

export type AppEvent = Omit<
	ApiEvent,
	"createdAt" | "updatedAt" | "occurredAt"
> & {
	createdAt: Date;
	updatedAt: Date;
	occurredAt: Date;
};

export type EventListViewState =
	| { type: "empty" }
	| { type: "list"; events: AppEvent[] };

export function sortEvents(events: AppEvent[]) {
	return [...events].sort((a, b) => {
		const occurredAtDiff = b.occurredAt.getTime() - a.occurredAt.getTime();
		if (occurredAtDiff !== 0) {
			return occurredAtDiff;
		}

		return b.createdAt.getTime() - a.createdAt.getTime();
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
		createdAt: new Date(event.createdAt),
		updatedAt: new Date(event.updatedAt),
		occurredAt: new Date(event.occurredAt),
	};
}
