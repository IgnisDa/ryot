import { atom, useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { Step } from "react-joyride";

export const TourStepTargets = {
	One: "tour-step-1",
	Two: "tour-step-2",
} as const;

export const tourSteps = (
	[
		{
			target: TourStepTargets.One,
			content:
				"Welcome to Ryot! Let's get started by adding a movie to your watchlist. Click on the media section in the sidebar to see what all you can track.",
		},
		{
			target: TourStepTargets.Two,
			content:
				"Now, click on the movies section to start tracking your favorite movies.",
		},
	] as Step[]
).map((step) => ({ ...step, target: `.${step.target}` }));

const onboardingTourAtom = atom<
	| {
			currentStepIndex: number;
	  }
	| undefined
>();

export const useOnboardingTour = () => {
	const [tourState, setTourState] = useAtom(onboardingTourAtom);

	return {
		isTourStarted: !!tourState,
		stepIndex: tourState?.currentStepIndex,
		stopTour: () => setTourState(undefined),
		startTour: () => setTourState({ currentStepIndex: 0 }),
	};
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
