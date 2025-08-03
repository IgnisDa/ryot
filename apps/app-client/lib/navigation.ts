import { atom } from "jotai";
import { atomWithPlatformStorage } from "./atoms";

export type Tracker = {
	id: string;
	name: string;
	subItems?: string[];
};

// TODO: replace with server-derived data once trackers API is available
const HARDCODED_TRACKERS: Tracker[] = [
	{ id: "home", name: "Home" },
	{
		id: "media",
		name: "Media",
		subItems: [
			"Movies",
			"TV Shows",
			"Books",
			"Anime",
			"Manga",
			"Games",
			"Podcasts",
		],
	},
	{ id: "fitness", name: "Fitness" },
	{ id: "whiskey", name: "Whiskey" },
];

export const trackersAtom = atom<Tracker[]>(HARDCODED_TRACKERS);

export const activeTrackerIdAtom = atomWithPlatformStorage<string | null>(
	"nav-active-tracker",
	"home",
);

export const activeSubItemAtom = atomWithPlatformStorage<string | null>(
	"nav-active-sub-item",
	null,
);

export const railOpenAtom = atom(false);
export const subFlyoutOpenAtom = atom(false);
export const searchOpenAtom = atom(false);
