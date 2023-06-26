export const ROUTES = {
	auth: {
		login: "/auth/login",
		register: "/auth/register",
	},
	dashboard: "/",
	list: "/list",
	media: {
		commit: "/media/commit",
		create: "/media/create",
		details: "/media",
		postReview: "/media/post-review",
		updateProgress: "/media/update-progress",
	},
	settings: "/settings",
} as const;
