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
import { useNavigate } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
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

export const TOUR_EXERCISE_TARGET_ID = "Leg Press";
export const TOUR_MOVIE_TARGET_ID = "avengers";

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
	ClickOnAddAnExerciseButton = "tour-step-click-on-add-an-exercise-button",
	SearchForExercise = "tour-step-search-for-exercise",
	SelectExercise = "tour-step-select-exercise",
	AddSelectedExerciseToWorkout = "tour-step-add-selected-exercise-to-workout",
	AddWeightToExercise = "tour-step-add-weight-to-exercise",
	AddRepsToExercise = "tour-step-add-reps-to-exercise",
	OpenSetMenuDetails = "tour-step-open-set-menu-details",
	OpenExerciseMenuDetails = "tour-step-open-exercise-menu-details",
	ConfirmSetForExercise = "tour-step-confirm-set-for-exercise",
	FinishWorkout = "tour-step-finish-workout",
	OpenSettingsSidebar = "tour-step-open-settings-sidebar",
	OpenSettingsPreferences = "tour-step-open-settings-preferences",
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
	const navigate = useNavigate();
	const { setOpenedSidebarLinks } = useOpenedSidebarLinks();
	const isOnboardingTourInProgress =
		isNumber(tourState?.currentStepIndex) && !tourState?.isCompleted;
	const theme = useMantineTheme();
	const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

	const isOnboardingTourLoading = tourState?.isLoading;
	const canOnboardingTourBeStarted =
		typeof tourState === "undefined" || tourState.isCompleted;

	const deployBackgroundJobMutation = useMutation({
		mutationFn: async () => {
			await clientGqlService.request(DeployBackgroundJobDocument, {
				jobName: BackgroundJob.CalculateUserActivitiesAndSummary,
			});
		},
	});

	const startOnboardingTour = () => {
		setOpenedSidebarLinks(defaultSidebarLinksState);
		setTourState({ currentStepIndex: 0 });
	};

	const completeOnboardingTour = () => {
		setTourState(
			produce(tourState, (draft) => {
				if (draft) draft.isCompleted = true;
			}),
		);
		navigate($path("/"));
	};

	const advanceOnboardingTourStep = async (input?: {
		collapseSidebar?: true;
		skipSecondarySteps?: true;
	}) => {
		if (!isOnboardingTourInProgress) return;

		setTourState((ts) =>
			produce(ts, (draft) => {
				if (draft) draft.isLoading = true;
			}),
		);

		return new Promise<void>((resolve) => {
			if (input?.skipSecondarySteps || input?.collapseSidebar)
				setOpenedSidebarLinks(defaultSidebarLinksState);

			setTimeout(() => {
				setTourState((ts) =>
					produce(ts, (draft) => {
						if (draft) {
							draft.isLoading = undefined;
							const nextStepIndex = tourState.currentStepIndex + 1;
							const newIndex = match(input?.skipSecondarySteps)
								.with(undefined, () => nextStepIndex)
								.with(true, () => {
									const target = onboardingTourSteps.findIndex(
										(step, index) =>
											index > nextStepIndex && !step.data?.isSecondaryStep,
									);
									return target !== -1 ? target : nextStepIndex;
								})
								.exhaustive();
							draft.currentStepIndex = newIndex;
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
				<Group>
					{isOnboardingTourLoading ? <Loader size="xs" /> : null}
					<Button
						size="compact-xs"
						variant="default"
						onClick={() => {
							setTourState({ currentStepIndex: onboardingTourSteps.length });
						}}
					>
						Complete tour
					</Button>
				</Group>
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
				content: `You can find any movie here. Let us proceed by searching for "${TOUR_MOVIE_TARGET_ID}".`,
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
									advanceOnboardingTourStep({ collapseSidebar: true });
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
									advanceOnboardingTourStep({ skipSecondarySteps: true });
								}}
							>
								Skip fitness section
							</Button>
						</Button.Group>
					</Stack>
				),
			},
			{
				data: { isSecondaryStep: true },
				target: OnboardingTourStepTargets.OpenFitnessSidebar,
				content:
					"Let's move on to the fitness section. Click on the corresponding in the sidebar.",
			},
			{
				data: { isSecondaryStep: true },
				target: OnboardingTourStepTargets.OpenWorkoutsSection,
				content:
					"Click on the 'Workouts' section to see all your workouts and start a new one.",
			},
			{
				data: { isSecondaryStep: true },
				target: OnboardingTourStepTargets.AddNewWorkout,
				content:
					"This is the workouts section. Let's start by adding a new workout.",
			},
			{
				data: { isSecondaryStep: true },
				target: OnboardingTourStepTargets.ClickOnAddAnExerciseButton,
				content:
					"You have started with an empty workout. Let's add a new exercise to it.",
			},
			{
				data: { isSecondaryStep: true },
				target: OnboardingTourStepTargets.SearchForExercise,
				content: `Let's proceed by searching for "${TOUR_EXERCISE_TARGET_ID}".`,
			},
			{
				data: { isSecondaryStep: true },
				disableScrolling: false,
				target: OnboardingTourStepTargets.SelectExercise,
				content: `Let's proceed by selecting '${TOUR_EXERCISE_TARGET_ID}'. Please click on the checkbox to continue.`,
			},
			{
				data: { isSecondaryStep: true },
				target: OnboardingTourStepTargets.AddSelectedExerciseToWorkout,
				content:
					"Once you have selected the exercises you want, click on this button to add them to the active workout.",
			},
			{
				data: { isSecondaryStep: true },
				target: OnboardingTourStepTargets.AddWeightToExercise,
				content:
					"Let's associate some weight to the exercise. Please enter 20 to continue.",
			},
			{
				data: { isSecondaryStep: true },
				target: OnboardingTourStepTargets.AddRepsToExercise,
				content:
					"Let's associate some rep count to it. Please enter 10 to continue.",
			},
			{
				data: { isSecondaryStep: true },
				target: OnboardingTourStepTargets.OpenSetMenuDetails,
				content:
					"Click on the set number. Here you will get a menu with options to adjust the set details and add additional attributes to it.",
			},
			{
				data: { isSecondaryStep: true },
				target: OnboardingTourStepTargets.OpenExerciseMenuDetails,
				content:
					"Click on the three dots to open the exercise menu. You will get a menu with options to adjust the exercise details etc.",
			},
			{
				data: { isSecondaryStep: true },
				target: OnboardingTourStepTargets.ConfirmSetForExercise,
				content:
					"Once you have associated the correct inputs for a set, the confirm button will be enabled. Clicking on it will confirm the set, start the rest timer and collapse the exercise if it is the last set.",
			},
			{
				disableScrolling: false,
				data: { isSecondaryStep: true },
				target: OnboardingTourStepTargets.FinishWorkout,
				content:
					"Great! You have finished your workout tour. Once you are ready, click on the 'Finish' button to continue.",
			},
			{
				target: OnboardingTourStepTargets.OpenSettingsSidebar,
				content:
					"Let's move on to the settings section. Click on the corresponding section in the sidebar.",
			},
			{
				target: OnboardingTourStepTargets.OpenSettingsPreferences,
				content:
					"You can use the preferences settings to customize your experience.",
			},
		] as Step[]
	).map((step) => ({
		...step,
		hideFooter: true,
		disableBeacon: true,
		target: `.${step.target}`,
		content: <StepWrapper>{step.content}</StepWrapper>,
	}));
	const isOnLastOnboardingTourStep =
		tourState?.currentStepIndex === onboardingTourSteps.length &&
		!tourState?.isCompleted;

	useEffect(() => {
		if (typeof isMobile === "undefined" || isMobile) return;
		if (typeof tourState === "undefined") startOnboardingTour();
	}, [isMobile, tourState]);

	return {
		onboardingTourSteps,
		startOnboardingTour,
		completeOnboardingTour,
		advanceOnboardingTourStep,
		isOnLastOnboardingTourStep,
		canOnboardingTourBeStarted,
		isOnboardingTourInProgress,
		currentOnboardingTourStepIndex: tourState?.currentStepIndex,
	};
};
