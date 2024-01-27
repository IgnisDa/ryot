export default {
	updateProgress: (title: string) => {
		window.umami?.track("Update Progress", { title });
	},
};
