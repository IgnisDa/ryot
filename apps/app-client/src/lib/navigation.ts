import { atom, useAtomValue, useSetAtom } from "jotai";

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

const trackersAtom = atom<Tracker[]>(HARDCODED_TRACKERS);

const navSheetOpenAtom = atom(false);
const searchOpenAtom = atom(false);

export const useTrackers = () => useAtomValue(trackersAtom);
export const useNavSheetOpen = () => useAtomValue(navSheetOpenAtom);
export const useSetNavSheetOpen = () => useSetAtom(navSheetOpenAtom);
export const useSearchOpen = () => useAtomValue(searchOpenAtom);
export const useSetSearchOpen = () => useSetAtom(searchOpenAtom);
