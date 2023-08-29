export const APP_ROUTES = {
	dashboard: "/",
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
	media: {
		list: "/media/list",
		postReview: "/media/post-review",
		collections: {
			list: "/media/collections/list",
			details: "/media/collections",
		},
		people: {
			list: "/media/people/list",
			details: "/media/people",
		},
		individualMediaItem: {
			details: "/media/item",
			commit: "/media/item/commit",
			create: "/media/item/create",
			updateProgress: "/media/item/update-progress",
		},
	},
	fitness: {
		exercises: {
			currentWorkout: "/fitness/exercises/current-workout",
			list: "/fitness/exercises/list",
			details: "/fitness/exercises/details",
		},
		measurements: "/fitness/measurements",
	},
} as const;
