import { Schema } from "effect";

export const RECENT_DESTINATION_LIMIT = 8;

export const RecentDestination = Schema.Struct({
	icon: Schema.String,
	href: Schema.String,
	label: Schema.String,
	group: Schema.String,
});
export type RecentDestination = typeof RecentDestination.Type;

export const RecentDestinations = Schema.Array(RecentDestination);

export const recordRecent = (
	recents: readonly RecentDestination[],
	destination: RecentDestination,
) =>
	[destination, ...recents.filter(({ href }) => href !== destination.href)].slice(
		0,
		RECENT_DESTINATION_LIMIT,
	);
