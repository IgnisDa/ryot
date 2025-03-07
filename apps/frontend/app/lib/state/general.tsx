import { isNumber } from "@ryot/ts-utils";
import { atom, useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useEffect } from "react";
import type { Step } from "react-joyride";

type OpenedSidebarLinks = {
	media: boolean;
	fitness: boolean;
	settings: boolean;
	collection: boolean;
};

export const defaultSidebarLinksState: OpenedSidebarLinks = {
	media: false,
	fitness: false,
	settings: false,
	collection: false,
};

const openedSidebarLinksAtom = atomWithStorage<OpenedSidebarLinks>(
	"OpenedSidebarLinks",
	defaultSidebarLinksState,
);

export const useOpenedSidebarLinks = () => {
	const [openedSidebarLinks, setOpenedSidebarLinks] = useAtom(
		openedSidebarLinksAtom,
	);
	return { openedSidebarLinks, setOpenedSidebarLinks };
};

export type TourControl = { target: string; onTargetInteract: () => void };

export const OnboardingTourStepTargets = {
	One: "tour-step-1",
	Two: "tour-step-2",
	Three: "tour-step-3",
	Four: "tour-step-4",
} as const;

export const onboardingTourSteps = (
	[
		{
			target: OnboardingTourStepTargets.One,
			content:
				"Welcome to Ryot! Let's get started by adding a movie to your watchlist. Click on the media section in the sidebar to see what all you can track.",
		},
		{
			target: OnboardingTourStepTargets.Two,
			content:
				"Now, click on the movies section to start tracking your favorite movies.",
		},
		{
			target: OnboardingTourStepTargets.Three,
			content:
				"Let's start by adding a movie to your watchlist. Click on the search tab to search for a movie.",
		},
		{
			target: OnboardingTourStepTargets.Four,
			content:
				"Now search for 'avengers'. Note: the tour will progress only when you search for 'avengers'.",
		},
	] as Step[]
).map((step) => ({
	...step,
	hideFooter: true,
	disableBeacon: true,
	spotlightClicks: true,
	target: `.${step.target}`,
}));

const onboardingTourAtom = atom<{ currentStepIndex: number } | undefined>();

const OnboardingTourCompletedKey = "OnboardingTourCompleted";

export const useOnboardingTour = () => {
	const [tourState, setTourState] = useAtom(onboardingTourAtom);
	const { setOpenedSidebarLinks } = useOpenedSidebarLinks();
	const isTourStarted = isNumber(tourState?.currentStepIndex);

	const startTour = () => {
		setOpenedSidebarLinks(defaultSidebarLinksState);
		setTourState({ currentStepIndex: 0 });
	};
	const setTourStep = (stepIndex: number) =>
		setTourState({ currentStepIndex: stepIndex });
	const incrementStep = () =>
		setTourState((prev) => ({
			currentStepIndex: (prev?.currentStepIndex || 0) + 1,
		}));

	useEffect(() => {
		const completed = localStorage.getItem(OnboardingTourCompletedKey);

		if (!completed && !isTourStarted) startTour();
	}, []);

	return {
		setTourStep,
		isTourStarted,
		incrementStep,
		stepIndex: tourState?.currentStepIndex,
	};
};
