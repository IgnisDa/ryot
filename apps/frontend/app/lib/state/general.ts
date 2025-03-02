import { atom, useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

const onboardingTourAtom = atom<boolean>(false);

export const useOnboardingTour = () => {
	const [isTourStarted, setIsTourStarted] = useAtom(onboardingTourAtom);
	return { isTourStarted, setIsTourStarted };
};

type OpenedSidebarLinks = {
	media: boolean;
	fitness: boolean;
	settings: boolean;
	collection: boolean;
};

const openedSidebarLinksAtom = atomWithStorage<OpenedSidebarLinks>(
	"openedSidebarLinks",
	{
		media: false,
		fitness: false,
		settings: false,
		collection: false,
	},
);

export const useOpenedSidebarLinks = () => {
	const [openedSidebarLinks, setOpenedSidebarLinks] = useAtom(
		openedSidebarLinksAtom,
	);
	return { openedSidebarLinks, setOpenedSidebarLinks };
};
