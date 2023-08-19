export const APP_ROUTES = {
	dashboard: "/",
	auth: {
		login: "/auth/login",
		register: "/auth/register",
	},
	settings: {
		profile: "/settings/profile",
		preferences: "/settings/preferences",
		tokens: "/settings/tokens",
		integrations: "/settings/integrations",
		notifications: "/settings/notifications",
		miscellaneous: "/settings/miscellaneous",
		users: "/settings/users",
		imports: {
			new: "/settings/imports",
			reports: "/settings/imports/reports",
		},
	},
	media: {
		list: "/media/list",
		postReview: "/media/post-review",
		collections: {
			details: "/media/collections",
			list: "/media/collections/list",
		},
		people: {
			details: "/media/people",
			list: "/media/people/list",
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
			list: "/fitness/exercises",
			currentWorkout: "/fitness/exercises/current-workout",
		},
		measurements: "/fitness/measurements",
	},
} as const;
