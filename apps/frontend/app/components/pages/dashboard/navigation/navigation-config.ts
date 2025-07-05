import { MediaLot, UserLot } from "@ryot/generated/graphql/backend/graphql";
import type { UserPreferences } from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { $path } from "safe-routes";
import { joinURL } from "ufo";
import type { useUserDetails } from "~/lib/shared/hooks";
import { OnboardingTourStepTargets } from "~/lib/state/general";

export const getMediaLinks = (
	userPreferences: UserPreferences,
	isOnboardingTourInProgress: boolean,
) =>
	[
		...userPreferences.featuresEnabled.media.specific.map((f) => {
			return {
				label: changeCase(f),
				link: $path("/media/:action/:lot", { action: "list", lot: f }),
				tourControlTarget:
					isOnboardingTourInProgress && f === MediaLot.AudioBook
						? `${OnboardingTourStepTargets.FirstSidebar} ${OnboardingTourStepTargets.GoBackToAudiobooksSection}`
						: undefined,
			};
		}),
		userPreferences.featuresEnabled.media.groups
			? {
					label: "Groups",
					link: $path("/media/groups/:action", { action: "list" }),
				}
			: undefined,
		userPreferences.featuresEnabled.media.people
			? {
					label: "People",
					link: $path("/media/people/:action", { action: "list" }),
				}
			: undefined,
		userPreferences.featuresEnabled.media.genres
			? {
					label: "Genres",
					link: $path("/media/genre/list"),
				}
			: undefined,
	].filter((link) => link !== undefined);

export const getFitnessLinks = (
	userPreferences: UserPreferences,
	isOnboardingTourInProgress: boolean,
) =>
	[
		...(Object.entries(userPreferences.featuresEnabled.fitness || {})
			.filter(([v, _]) => !["enabled"].includes(v))
			.map(([name, enabled]) => ({ name, enabled }))
			?.filter((f) => f.enabled)
			.map((f) => ({
				label: changeCase(f.name.toString()),
				link: joinURL("/fitness", f.name, "list"),
				tourControlTarget:
					isOnboardingTourInProgress && f.name === "workouts"
						? OnboardingTourStepTargets.OpenWorkoutsSection
						: f.name === "templates"
							? OnboardingTourStepTargets.ClickOnTemplatesSidebarSection
							: f.name === "measurements"
								? OnboardingTourStepTargets.ClickOnMeasurementSidebarSection
								: undefined,
			})) || []),
		{ label: "Exercises", link: $path("/fitness/exercises/list") },
	].filter((link) => link !== undefined);

export const getSettingsLinks = (
	userDetails: ReturnType<typeof useUserDetails>,
) =>
	[
		{
			label: "Preferences",
			link: $path("/settings/preferences"),
			tourControlTarget: OnboardingTourStepTargets.OpenSettingsPreferences,
		},
		{
			label: "Imports and Exports",
			link: $path("/settings/imports-and-exports"),
		},
		{
			label: "Profile and Sharing",
			link: $path("/settings/profile-and-sharing"),
		},
		{ label: "Integrations", link: $path("/settings/integrations") },
		{ label: "Notifications", link: $path("/settings/notifications") },
		{ label: "Miscellaneous", link: $path("/settings/miscellaneous") },
		userDetails.lot === UserLot.Admin
			? { label: "Users", link: $path("/settings/users") }
			: undefined,
	].filter((link) => link !== undefined);

export const getThemeIcon = (currentColorScheme: string) =>
	currentColorScheme === "dark" ? IconSun : IconMoon;
