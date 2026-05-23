// TODO: Delete this module once app-frontend is removed. app-client does not consume any of these routes.
export type {
	BuiltInMediaOverviewContinueResponse,
	BuiltInMediaOverviewLibraryResponse,
	BuiltInMediaOverviewRateTheseResponse,
	BuiltInMediaOverviewRecentActivityResponse,
	BuiltInMediaOverviewUpNextResponse,
	BuiltInMediaOverviewWeekActivityResponse,
} from "./schemas";
export {
	getContinueItems,
	getLibraryStats,
	getRateTheseItems,
	getRecentActivityItems,
	getUpNextItems,
	getWeekActivity,
} from "./service";
