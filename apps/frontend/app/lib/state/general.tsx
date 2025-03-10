import {
	Box,
	Button,
	Group,
	Loader,
	Stack,
	Text,
	useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
	BackgroundJob,
	DeployBackgroundJobDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { isNumber } from "@ryot/ts-utils";
import { useMutation } from "@tanstack/react-query";
import { produce } from "immer";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { type ReactNode, useEffect } from "react";
import type { Step } from "react-joyride";
import { clientGqlService } from "../generals";

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

export enum OnboardingTourStepTargets {
	Zero = "tour-step-0",
	One = "tour-step-1",
	Two = "tour-step-2",
	Three = "tour-step-3",
	Four = "tour-step-4",
	Five = "tour-step-5",
	Six = "tour-step-6",
	Seven = "tour-step-7",
	Eight = "tour-step-8",
	Nine = "tour-step-9",
	Ten = "tour-step-10",
	Eleven = "tour-step-11",
	Twelve = "tour-step-12",
	Thirteen = "tour-step-13",
}

const onboardingTourAtom = atomWithStorage<
	| {
			isLoading?: true;
			currentStepIndex: number;
	  }
	| undefined
>("OnboardingTour", undefined);

export const OnboardingTourCompletedKey = "OnboardingTourCompleted";

export const useOnboardingTour = () => {
	const [tourState, setTourState] = useAtom(onboardingTourAtom);
	const { setOpenedSidebarLinks } = useOpenedSidebarLinks();
	const isTourStarted = isNumber(tourState?.currentStepIndex);
	const theme = useMantineTheme();
	const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
	const isTourLoading = tourState?.isLoading;

	const deployBackgroundJobMutation = useMutation({
		mutationFn: async () => {
			await clientGqlService.request(DeployBackgroundJobDocument, {
				jobName: BackgroundJob.CalculateUserActivitiesAndSummary,
			});
		},
	});

	const startTour = () => {
		setOpenedSidebarLinks(defaultSidebarLinksState);
		setTourState({ currentStepIndex: 0 });
	};

	const completeTour = () => {
		setTourState(undefined);
		localStorage.setItem(OnboardingTourCompletedKey, "true");
		window.location.href = "/";
	};

	const advanceTourStep = async () => {
		if (!isTourStarted) return;

		setTourState((ts) =>
			produce(ts, (draft) => {
				if (draft) draft.isLoading = true;
			}),
		);

		return new Promise<void>((resolve) => {
			setTimeout(() => {
				setTourState((ts) =>
					produce(ts, (draft) => {
						if (draft) {
							draft.isLoading = undefined;
							draft.currentStepIndex = tourState.currentStepIndex + 1;
						}
					}),
				);
				resolve();
			}, 2000);
		});
	};

	const StepWrapper = ({ children }: { children: ReactNode }) => (
		<Stack>
			<Box>{children}</Box>
			<Group justify="space-between">
				{isTourLoading ? <Loader size="xs" /> : <Box />}
				<Text size="sm" c="dimmed">
					Step {(tourState?.currentStepIndex || 0) + 1} of{" "}
					{onboardingTourSteps.length}
				</Text>
			</Group>
		</Stack>
	);

	const onboardingTourSteps = (
		[
			{
				target: OnboardingTourStepTargets.Zero,
				content:
					"Welcome to Ryot! Let's get started by adding a movie to your watchlist. Click on the media section in the sidebar to see what all you can track.",
			},
			{
				target: OnboardingTourStepTargets.One,
				content:
					"Now, click on the movies section to start tracking your favorite movies.",
			},
			{
				target: OnboardingTourStepTargets.Two,
				content:
					"Let's start by adding a movie to your watchlist. Click on the search tab to search for a movie.",
			},
			{
				target: OnboardingTourStepTargets.Three,
				content:
					"You can find any movie here. Let us proceed by searching for 'avengers'.",
			},
			{
				target: OnboardingTourStepTargets.Four,
				content:
					"Now, add this movie to your watchlist. Note: you can remove it later.",
			},
			{
				target: OnboardingTourStepTargets.Five,
				content:
					"Great! You've added your first movie to your watchlist. Now, let's add it to your watched history.",
			},
			{
				target: OnboardingTourStepTargets.Six,
				content:
					"Select a desired date that you watched the movie and click on the 'Submit' button.",
			},
			{
				target: OnboardingTourStepTargets.Seven,
				content:
					"Great! Now, let's view some more details about the movie. Click on the movie to continue.",
			},
			{
				target: OnboardingTourStepTargets.Eight,
				content:
					"The most important tab is the 'Actions' tab. Here you can add the movie to your collection, mark it as watched, etc.",
			},
			{
				target: OnboardingTourStepTargets.Nine,
				content:
					"Great! Let's go back to the movies section and see your library.",
			},
			{
				target: OnboardingTourStepTargets.Ten,
				content: (
					<Stack>
						<Text>
							Here are all the movies in your library. Click on the next button
							to continue to the fitness section.
						</Text>
						<Button.Group>
							<Button
								size="xs"
								fullWidth
								loading={deployBackgroundJobMutation.isPending}
								onClick={async () => {
									await deployBackgroundJobMutation.mutateAsync();
									advanceTourStep();
								}}
							>
								Next
							</Button>
							<Button
								fullWidth
								size="xs"
								variant="outline"
								loading={deployBackgroundJobMutation.isPending}
								onClick={async () => {
									await deployBackgroundJobMutation.mutateAsync();
									completeTour();
								}}
							>
								Skip fitness section
							</Button>
						</Button.Group>
					</Stack>
				),
			},
			{
				target: OnboardingTourStepTargets.Eleven,
				content:
					"Let's move on to the fitness section. Click on the corresponding in the sidebar.",
			},
			{
				target: OnboardingTourStepTargets.Twelve,
				content:
					"Click on the 'Workouts' section to see all your workouts and start a new one.",
			},
			{
				target: OnboardingTourStepTargets.Thirteen,
				content:
					"This is the workouts section. Let's start by adding a new workout.",
			},
		] as Step[]
	).map((step) => ({
		...step,
		hideFooter: true,
		disableBeacon: true,
		target: `.${step.target}`,
		content: <StepWrapper>{step.content}</StepWrapper>,
	}));
	const isOnLastTourStep =
		tourState?.currentStepIndex === onboardingTourSteps.length;

	useEffect(() => {
		if (typeof isMobile === "undefined" || isMobile) return;

		const completed = localStorage.getItem(OnboardingTourCompletedKey);
		if (!completed && !isTourStarted) startTour();
	}, [isMobile]);

	return {
		completeTour,
		isTourStarted,
		advanceTourStep,
		isOnLastTourStep,
		onboardingTourSteps,
		currentTourStepIndex: tourState?.currentStepIndex,
	};
};
