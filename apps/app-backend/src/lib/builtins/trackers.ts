export type BuiltinTracker = {
	readonly icon: string;
	readonly name: string;
	readonly slug: string;
	readonly accentColor: string;
	readonly description: string;
};

export const builtinTrackers = (): BuiltinTracker[] => [
	{
		icon: "film",
		name: "Media",
		slug: "media",
		accentColor: "#5B7FFF",
		description:
			"Track media across movies, shows, books, comic books, anime, manga, audiobooks, podcasts, video games, and music.",
	},
	{
		name: "Fitness",
		slug: "fitness",
		icon: "heart-pulse",
		accentColor: "#2DD4BF",
		description: "Track workouts, measurements, and progress.",
	},
];
