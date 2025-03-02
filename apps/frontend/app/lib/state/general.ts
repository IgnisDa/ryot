import type { OnboardingTourStep } from "@gfazioli/mantine-onboarding-tour";
import { atom, useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export const tourSteps = [
	{
		id: "step-1",
		content:
			"Welcome to Ryot! Let's get started by adding a movie to your watchlist. Click on the media section in the sidebar to see what all you can track.",
	},
] as OnboardingTourStep[];

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
