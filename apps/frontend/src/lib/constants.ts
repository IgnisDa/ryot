export const ROUTES = {
	dashboard: "/",
	auth: {
		login: "/auth/login",
		register: "/auth/register",
	},
	settings: {
		main: "/settings",
		profile: "/settings/profile",
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
