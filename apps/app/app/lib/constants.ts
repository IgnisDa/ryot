export const APP_ROUTES = {
	dashboard: "/",
	generalActions: "/actions",
	calendar: "/calendar",
	auth: {
		login: "/auth/login",
		register: "/auth/register",
	},
	settings: {
		profile: "/settings/profile",
		preferences: "/settings/preferences",
		integrations: "/settings/integrations",
		notifications: "/settings/notifications",
		miscellaneous: "/settings/miscellaneous",
		users: "/settings/users",
		imports: {
			new: "/settings/imports-and-exports",
			reports: "/settings/imports-and-exports/reports",
		},
	},
	collections: {
		list: "/collections/list",
		details: "/collections",
	},
	media: {
		list: "/media/list",
		search: "/media/search",
		postReview: "/media/post-review",
		genres: {
			list: "/media/genres/list",
			details: "/media/genres",
		},
		groups: {
			list: "/media/groups/list",
			details: "/media/groups",
		},
		people: {
			list: "/media/people/list",
			details: "/media/people",
		},
		individualMediaItem: {
			details: "/media/item",
			create: "/media/item/create",
			updateProgress: "/media/item/update-progress",
		},
	},
	fitness: {
		exercises: {
			currentWorkout: "/fitness/exercises/current-workout",
			list: "/fitness/exercises/list",
			details: "/fitness/exercises/details",
			createOrEdit: "/fitness/exercises/create-or-edit",
		},
		measurements: "/fitness/measurements",
		workouts: "/fitness/exercises/workouts/list",
		workoutDetails: "/fitness/exercises/workouts/details",
	},
} as const;

export const COOKIES_KEYS = {
	auth: "0",
	colorScheme: "1",
};

export const LOCAL_STORAGE_KEYS = {
	colorScheme: "mantine-color-scheme",
	currentWorkout: "currentWorkout",
	savedCalendarDay: "1",
	savedMeasurementsDisplaySelectedStats: "2",
	savedMeasurementsDisplaySelectedTimespan: "3",
	savedActiveExerciseDetailsTab: "4",
	savedExercisesPage: "5",
	savedExercisesQuery: "6",
	savedExerciseFilters: "7",
	savedExerciseSortBy: "8",
	savedWorkoutListPage: "9",
	savedMineMediaSortOrder: "10",
	savedMineMediaSortBy: "11",
	savedMineMediaGeneralFilter: "12",
	savedMineMediaCollectionFilter: "13",
	savedMediaSearchPage: "14",
	savedMediaQuery: "15",
	savedMediaSearchSource: "16",
	savedMediaMinePage: "17",
	savedMediaActiveTab: "18",
	savedCollectionPage: "19",
	savedGroupsQuery: "20",
	savedGroupsPage: "21",
	savedActiveItemDetailsTab: "22",
	savedActiveCreatorDetailsTab: "23",
	savedCreatorsQuery: "24",
	savedCreatorPage: "25",
	savedCreatorSortBy: "26",
	savedCreatorSortOrder: "27",
	savedPreferencesTab: "28",
	savedActiveMetadataGroupDetailsTab: "29",
	savedActiveCollectionDetailsTab: "30",
	savedCollectionContentsQuery: "31",
	savedCollectionContentsSortBy: "32",
	savedCollectionContentsSortOrder: "33",
	savedCollectionContentsEntityLotFilter: "34",
	savedCollectionContentsMetadataLotFilter: "35",
	savedOpenedLinkGroups: "36",
	savedGenreListQuery: "37",
	savedGenreListPage: "38",
	savedGenreContentsPage: "39",
	savedWorkoutListQuery: "40",
	savedMeasurementsActiveTab: "41",
} as const;
