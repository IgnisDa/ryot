import { useMantineTheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
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

export enum OnboardingTourStepTargets {
	One = "tour-step-1",
	Two = "tour-step-2",
	Three = "tour-step-3",
	Four = "tour-step-4",
	Five = "tour-step-5",
	Six = "tour-step-6",
	Seven = "tour-step-7",
	Eight = "tour-step-8",
	Nine = "tour-step-9",
}

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
		{
			target: OnboardingTourStepTargets.Five,
			content:
				"Now, add this movie to your watchlist. Note: you can remove it later.",
		},
		{
			target: OnboardingTourStepTargets.Six,
			content:
				"Great! You've added your first movie to your watchlist. Now, let's add it to your watched history.",
		},
		{
			target: OnboardingTourStepTargets.Seven,
			content:
				"Select a desired date that you watched the movie and click on the 'Submit' button.",
		},
		{
			target: OnboardingTourStepTargets.Eight,
			content:
				"Great! Now, let's view some more details about the movie. Click on the movie to continue.",
		},
		{
			target: OnboardingTourStepTargets.Nine,
			content:
				"The most important tab is the 'Actions' tab. Here you can add the movie to your collection, mark it as watched, etc.",
		},
	] as Step[]
).map((step) => ({
	...step,
	hideFooter: true,
	disableBeacon: true,
	target: `.${step.target}`,
}));

const onboardingTourAtom = atom<{ currentStepIndex: number } | undefined>();

export const OnboardingTourCompletedKey = "OnboardingTourCompleted";

export const useOnboardingTour = () => {
	const [tourState, setTourState] = useAtom(onboardingTourAtom);
	const { setOpenedSidebarLinks } = useOpenedSidebarLinks();
	const isTourStarted = isNumber(tourState?.currentStepIndex);
	const theme = useMantineTheme();
	const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

	const startTour = () => {
		setOpenedSidebarLinks(defaultSidebarLinksState);
		setTourState({ currentStepIndex: 0 });
	};

	const completeTour = () => {
		setTourState(undefined);
		localStorage.setItem(OnboardingTourCompletedKey, "true");
		window.location.href = "/";
	};

	const advanceTourStep = () => {
		if (!isTourStarted) return;

		const nextStepIndex = tourState.currentStepIndex + 1;

		setTimeout(() => setTourState({ currentStepIndex: nextStepIndex }), 2000);
	};

	useEffect(() => {
		if (typeof isMobile === "undefined" || isMobile) return;

		const completed = localStorage.getItem(OnboardingTourCompletedKey);
		if (!completed && !isTourStarted) startTour();
	}, [isMobile]);

	return {
		completeTour,
		isTourStarted,
		advanceTourStep,
		stepIndex: tourState?.currentStepIndex,
	};
};
