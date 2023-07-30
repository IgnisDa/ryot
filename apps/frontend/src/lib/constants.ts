export const LIMIT = 20;

export const ROUTES = {
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
	},
	imports: {
		new: "/imports",
		reports: "/imports/reports",
	},
	media: {
		collections: {
			list: "/collections/list",
			details: "/collections",
		},
		list: "/list",
		individualMedia: {
			commit: "/media/commit",
			create: "/media/create",
			details: "/media",
			postReview: "/media/post-review",
			updateProgress: "/media/update-progress",
		},
	},
	fitness: {
		home: "/fitness",
	},
} as const;
