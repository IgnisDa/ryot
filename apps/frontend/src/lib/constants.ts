export const LIMIT = 20;

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
		collections: {
			details: "/media/collections",
			list: "/media/collections/list",
		},
		creators: {
			details: "/media/creators",
			list: "/media/creators/list",
		},
		individualMediaItem: {
			details: "/media/item",
			commit: "/media/item/commit",
			create: "/media/item/create",
			postReview: "/media/item/post-review",
			updateProgress: "/media/item/update-progress",
		},
	},
	fitness: {
		home: "/fitness",
	},
} as const;
