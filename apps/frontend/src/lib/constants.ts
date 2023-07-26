export const ROUTES = {
	auth: {
		login: "/auth/login",
		register: "/auth/register",
	},
	settings: "/settings",
	imports: {
		new: "/imports",
		reports: "/imports/reports",
	},
	media: {
		collections: {
			list: "/collections/list",
			details: "/collections",
		},
		dashboard: "/",
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
