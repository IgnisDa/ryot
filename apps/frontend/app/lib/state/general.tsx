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
	Welcome = "tour-step-welcome",
	FirstSidebar = "tour-step-first-sidebar",
	GoToMoviesSection = "tour-step-go-to-movies-section",
	SearchMovie = "tour-step-search-movie",
	AddMovieToWatchlist = "tour-step-add-movie-to-watchlist",
	OpenMetadataProgressForm = "tour-step-open-metadata-progress-form",
	AddMovieToWatchedHistory = "tour-step-add-movie-to-watched-history",
	GoToMoviesSectionAgain = "tour-step-go-to-movies-section-again",
	MetadataDetailsActionsTab = "tour-step-metadata-details-actions-tab",
	GoBackToMoviesSection = "tour-step-go-back-to-movies-section",
	RefreshMoviesListPage = "tour-step-refresh-movies-list-page",
	ShowMoviesListPage = "tour-step-show-movies-list-page",
	OpenFitnessSidebar = "tour-step-open-fitness-sidebar",
	OpenWorkoutsSection = "tour-step-open-workouts-section",
	AddNewWorkout = "tour-step-add-new-workout",
}

const onboardingTourAtom = atomWithStorage<
	| undefined
	| {
			isLoading?: true;
			isCompleted?: true;
			currentStepIndex: number;
	  }
>("OnboardingTour", undefined);

export const useOnboardingTour = () => {
	const [tourState, setTourState] = useAtom(onboardingTourAtom);
	const { setOpenedSidebarLinks } = useOpenedSidebarLinks();
	const isTourInProgress =
		isNumber(tourState?.currentStepIndex) && !tourState?.isCompleted;
	const theme = useMantineTheme();
	const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

	const isTourLoading = tourState?.isLoading;
	const canTourBeStarted =
		typeof tourState === "undefined" || tourState.isCompleted;

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
		setTourState(
			produce(tourState, (draft) => {
				if (draft) draft.isCompleted = true;
			}),
		);
		window.location.href = "/";
	};

	const advanceTourStep = async () => {
		if (!isTourInProgress) return;

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
				target: OnboardingTourStepTargets.Welcome,
				content:
					"Welcome to Ryot! Let's get started by adding a movie to your watchlist. Click on the media section in the sidebar to see what all you can track.",
			},
			{
				target: OnboardingTourStepTargets.FirstSidebar,
				content:
					"Now, click on the movies section to start tracking your favorite movies.",
			},
			{
				target: OnboardingTourStepTargets.GoToMoviesSection,
				content:
					"Let's start by adding a movie to your watchlist. Click on the search tab to search for a movie.",
			},
			{
				target: OnboardingTourStepTargets.SearchMovie,
				content:
					"You can find any movie here. Let us proceed by searching for 'avengers'.",
			},
			{
				target: OnboardingTourStepTargets.AddMovieToWatchlist,
				content:
					"Now, add this movie to your watchlist. Note: you can remove it later.",
			},
			{
				target: OnboardingTourStepTargets.OpenMetadataProgressForm,
				content:
					"Great! You've added your first movie to your watchlist. Now, let's add it to your watched history.",
			},
			{
				target: OnboardingTourStepTargets.AddMovieToWatchedHistory,
				content:
					"Select a desired date that you watched the movie and click on the 'Submit' button.",
			},
			{
				target: OnboardingTourStepTargets.GoToMoviesSectionAgain,
				content:
					"Great! Now, let's view some more details about the movie. Click on the movie to continue.",
			},
			{
				target: OnboardingTourStepTargets.MetadataDetailsActionsTab,
				content:
					"The most important tab is the 'Actions' tab. Here you can add the movie to your collection, mark it as watched, etc.",
			},
			{
				target: OnboardingTourStepTargets.GoBackToMoviesSection,
				content:
					"Great! Let's go back to the movies section and see your library.",
			},
			{
				target: OnboardingTourStepTargets.RefreshMoviesListPage,
				content:
					"When you have added a new item to the library, you can refresh it using this button.",
			},
			{
				target: OnboardingTourStepTargets.ShowMoviesListPage,
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
				target: OnboardingTourStepTargets.OpenFitnessSidebar,
				content:
					"Let's move on to the fitness section. Click on the corresponding in the sidebar.",
			},
			{
				target: OnboardingTourStepTargets.OpenWorkoutsSection,
				content:
					"Click on the 'Workouts' section to see all your workouts and start a new one.",
			},
			{
				target: OnboardingTourStepTargets.AddNewWorkout,
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
		tourState?.currentStepIndex === onboardingTourSteps.length &&
		!tourState?.isCompleted;

	useEffect(() => {
		if (typeof isMobile === "undefined" || isMobile) return;
		if (typeof tourState === "undefined") startTour();
	}, [isMobile, tourState]);

	return {
		startTour,
		completeTour,
		advanceTourStep,
		isOnLastTourStep,
		canTourBeStarted,
		isTourInProgress,
		onboardingTourSteps,
		currentTourStepIndex: tourState?.currentStepIndex,
	};
};
