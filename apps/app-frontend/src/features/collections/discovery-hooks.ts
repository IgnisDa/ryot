import { useSavedViewsQuery } from "~/features/saved-views/hooks";

import { type CollectionsDestination, resolveCollectionsDestination } from "./model";

export function useCollectionsDestination(): {
	destination: CollectionsDestination;
	isLoading: boolean;
	isError: boolean;
} {
	const { savedViews, isLoading, isError } = useSavedViewsQuery();

	const destination = resolveCollectionsDestination(savedViews);

	return {
		destination,
		isLoading,
		isError,
	};
}
