import { atom, useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useEffect } from "react";
import type { CallBackProps, Step } from "react-joyride";

export const OnboardingTourStepTargets = {
	One: "tour-step-1",
	Two: "tour-step-2",
} as const;

export const onboardingTourSteps = (
	[
		{
			disableBeacon: true,
			target: OnboardingTourStepTargets.One,
			content:
				"Welcome to Ryot! Let's get started by adding a movie to your watchlist. Click on the media section in the sidebar to see what all you can track.",
		},
		{
			target: OnboardingTourStepTargets.Two,
			content:
				"Now, click on the movies section to start tracking your favorite movies.",
		},
	] as Step[]
).map((step) => ({ ...step, target: `.${step.target}` }));

const onboardingTourAtom = atom<{ currentStepIndex: number } | undefined>();

export const handleJoyrideCallback = (data: CallBackProps) => {
	console.log(data);
};

const OnboardingTourCompletedKey = "OnboardingTourCompleted";

export const useOnboardingTour = () => {
	const [tourState, setTourState] = useAtom(onboardingTourAtom);
	const isTourStarted = !!tourState;

	const stopTour = () => setTourState(undefined);
	const startTour = () => setTourState({ currentStepIndex: 0 });

	useEffect(() => {
		const completed = localStorage.getItem(OnboardingTourCompletedKey);

		if (!completed && !isTourStarted) startTour();
	}, []);

	return {
		stopTour,
		startTour,
		isTourStarted,
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
