import { atom, useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useEffect } from "react";
import type { CallBackProps, Step } from "react-joyride";

export const TourStepTargets = {
	One: "tour-step-1",
	Two: "tour-step-2",
} as const;

export const tourSteps = (
	[
		{
			disableBeacon: true,
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

const onboardingTourAtom = atom<{ currentStepIndex: number } | undefined>();

export const handleJoyrideCallback = (data: CallBackProps) => {
	console.log(data);
};

export const useOnboardingTour = () => {
	const [tourState, setTourState] = useAtom(onboardingTourAtom);

	const stopTour = () => setTourState(undefined);
	const startTour = () => setTourState({ currentStepIndex: 0 });

	useEffect(() => {
		console.log(new Date().toISOString());
	}, []);

	return {
		stopTour,
		startTour,
		isTourStarted: !!tourState,
		stepIndex: tourState?.currentStepIndex,
	};
};

type OpenedSidebarLinks = {
	media: boolean;
	fitness: boolean;
	settings: boolean;
	collection: boolean;
};

const openedSidebarLinksAtom = atomWithStorage<OpenedSidebarLinks>(
	"OpenedSidebarLinks",
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
