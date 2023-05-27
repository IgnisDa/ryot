export const ROUTES = {
	auth: {
		register: "/auth/register",
		login: "/auth/login",
	},
	dashboard: "/",
	list: "/list",
	media: {
		details: "/media",
		updateProgress: "/media/update-progress",
		postReview: "/media/post-review",
	},
	collections: "/collections",
	settings: "/settings",
} as const;
