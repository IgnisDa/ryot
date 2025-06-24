import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Affix,
	Anchor,
	AppShell,
	Box,
	Burger,
	Button,
	Center,
	Code,
	Container,
	Drawer,
	Flex,
	Group,
	Image,
	List,
	Modal,
	ScrollArea,
	Stack,
	Text,
	Tooltip,
	UnstyledButton,
	rem,
	useMantineTheme,
} from "@mantine/core";
import { upperFirst, useDisclosure } from "@mantine/hooks";
import { MediaLot, UserLot } from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import {
	IconArchive,
	IconCalendar,
	IconChevronsLeft,
	IconChevronsRight,
	IconDeviceSpeaker,
	IconEyeglass,
	IconGraph,
	IconHome2,
	IconLogout,
	IconMoon,
	IconSettings,
	IconStretching,
	IconSun,
} from "@tabler/icons-react";
import { produce } from "immer";
import Cookies from "js-cookie";
import Joyride from "react-joyride";
import {
	Form,
	Link,
	Outlet,
	isRouteErrorResponse,
	useLoaderData,
	useLocation,
	useNavigate,
	useRevalidator,
	useRouteError,
} from "react-router";
import { ClientOnly } from "remix-utils/client-only";
import { $path } from "safe-routes";
import { joinURL, withQuery } from "ufo";
import { AddEntityToCollectionsForm } from "~/components/dashboard/forms/add-entity-to-collections-form";
import { CreateMeasurementForm } from "~/components/dashboard/forms/create-measurement-form";
import { ReviewEntityForm } from "~/components/dashboard/forms/review-entity-form";
import { MetadataProgressUpdateForm } from "~/components/dashboard/modals/metadata-progress-update-forms";
import { Footer } from "~/components/dashboard/navigation/footer";
import { LinksGroup } from "~/components/dashboard/navigation/links-group";
import {
	desktopSidebarCollapsedCookie,
	discordLink,
} from "~/components/dashboard/utils";
import {
	FitnessAction,
	LOGO_IMAGE_URL,
	forcedDashboardPath,
} from "~/lib/common";
import {
	useConfirmSubmit,
	useIsFitnessActionActive,
	useUserDetails,
	useUserPreferences,
} from "~/lib/hooks";
import { useMeasurementsDrawerOpen } from "~/lib/state/fitness";
import {
	OnboardingTourStepTargets,
	useOnboardingTour,
	useOpenedSidebarLinks,
} from "~/lib/state/general";
import {
	useAddEntityToCollections,
	useMetadataProgressUpdate,
	useReviewEntity,
} from "~/lib/state/media";
import {
	getCookieValue,
	getCoreDetails,
	getDecodedJwt,
	getEnhancedCookieName,
	getUserCollectionsList,
	getUserPreferences,
	redirectIfNotAuthenticatedOrUpdated,
} from "~/lib/utilities.server";
import { colorSchemeCookie } from "~/lib/utilities.server";
import classes from "~/styles/dashboard.module.css";
import type { Route } from "./+types/_dashboard";

export const loader = async ({ request }: Route.LoaderArgs) => {
	const userDetails = await redirectIfNotAuthenticatedOrUpdated(request);
	const [userPreferences, userCollections, coreDetails] = await Promise.all([
		getUserPreferences(request),
		getUserCollectionsList(request),
		getCoreDetails(),
	]);
	const desktopSidebarCollapsed = getCookieValue(
		request,
		desktopSidebarCollapsedCookie,
	);

	const currentColorScheme = await colorSchemeCookie.parse(
		request.headers.get("cookie") || "",
	);
	const onboardingTourCompletedCookie = await getEnhancedCookieName({
		name: "OnboardingCompleted",
		request,
	});
	const isOnboardingTourCompleted = getCookieValue(
		request,
		onboardingTourCompletedCookie,
	);

	const decodedCookie = getDecodedJwt(request);
	const isAccessLinkSession = Boolean(decodedCookie?.access_link_id);
	const isDemoInstance = coreDetails.isDemoInstance;

	const shouldHaveUmami =
		coreDetails.frontend.umami.scriptUrl &&
		coreDetails.frontend.umami.websiteId &&
		!coreDetails.disableTelemetry &&
		!isDemoInstance;

	return {
		userDetails,
		coreDetails,
		isDemoInstance,
		userPreferences,
		shouldHaveUmami,
		userCollections,
		currentColorScheme,
		isAccessLinkSession,
		desktopSidebarCollapsed,
		isOnboardingTourCompleted,
		onboardingTourCompletedCookie,
	};
};

export function ErrorBoundary() {
	const error = useRouteError() as Error;
	const message = isRouteErrorResponse(error)
		? error.data.message
		: error.message;

	return (
		<Container size="sm" py={{ base: 100, md: 200 }}>
			<Stack p={{ base: "sm", md: "xl" }}>
				<Text c="red" fz={{ base: 30, md: 40 }}>
					We encountered an error
				</Text>
				{message ? (
					<Code mah={100} c="pink">
						{message}
					</Code>
				) : null}
				<Group wrap="nowrap">
					<Button
						fullWidth
						color="green"
						variant="outline"
						onClick={() => window.location.reload()}
					>
						Reload
					</Button>
					<Form
						replace
						method="POST"
						style={{ width: "100%" }}
						action={$path("/actions", { intent: "logout" })}
					>
						<Button type="submit" variant="outline" color="blue" fullWidth>
							Logout
						</Button>
					</Form>
				</Group>
				{isRouteErrorResponse(error) ? null : (
					<>
						<Text>This could be due to several reasons:</Text>
						<List>
							<List.Item>Your login session has expired/revoked.</List.Item>
							<List.Item>
								You don't have permission to perform this action.
							</List.Item>
							<List.Item>There was a backend server error.</List.Item>
						</List>
						<Text>
							In most cases, logging out and then logging back in should fix the
							issue.
						</Text>
						<Text>
							If the error still persists please contact the developer on{" "}
							<Anchor
								target="_blank"
								href={discordLink}
								rel="noreferrer noopener"
							>
								Discord
							</Anchor>{" "}
							or create an issue on{" "}
							<Anchor
								target="_blank"
								rel="noreferrer noopener"
								href="https://github.com/ignisda/ryot/issues"
							>
								Github
							</Anchor>
							.
						</Text>
					</>
				)}
			</Stack>
		</Container>
	);
}

export default function Layout() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const userDetails = useUserDetails();
	const [parent] = useAutoAnimate();
	const { revalidate } = useRevalidator();
	const submit = useConfirmSubmit();
	const isFitnessActionActive = useIsFitnessActionActive();
	const { openedSidebarLinks, setOpenedSidebarLinks } = useOpenedSidebarLinks();
	const [mobileNavbarOpened, { toggle: toggleMobileNavbar }] =
		useDisclosure(false);
	const theme = useMantineTheme();
	const navigate = useNavigate();
	const location = useLocation();
	const [metadataToUpdate, setMetadataToUpdate] = useMetadataProgressUpdate();
	const closeMetadataProgressUpdateModal = () => setMetadataToUpdate(null);
	const [entityToReview, setEntityToReview] = useReviewEntity();
	const closeReviewEntityModal = () => setEntityToReview(null);
	const [addEntityToCollectionsData, setAddEntityToCollectionsData] =
		useAddEntityToCollections();
	const closeAddEntityToCollectionsDrawer = () =>
		setAddEntityToCollectionsData(null);
	const [measurementsDrawerOpen, setMeasurementsDrawerOpen] =
		useMeasurementsDrawerOpen();
	const closeMeasurementsDrawer = () => setMeasurementsDrawerOpen(false);
	const {
		onboardingTourSteps,
		completeOnboardingTour,
		isOnboardingTourInProgress,
		isOnLastOnboardingTourStep,
		currentOnboardingTourStepIndex,
	} = useOnboardingTour();

	const mediaLinks = [
		...userPreferences.featuresEnabled.media.specific.map((f) => {
			return {
				label: changeCase(f),
				link: $path("/media/:action/:lot", { action: "list", lot: f }),
				tourControlTarget:
					isOnboardingTourInProgress && f === MediaLot.Movie
						? `${OnboardingTourStepTargets.FirstSidebar} ${OnboardingTourStepTargets.GoBackToMoviesSection}`
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
	const Icon = loaderData.currentColorScheme === "dark" ? IconSun : IconMoon;
	const fitnessLinks = [
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
	const settingsLinks = [
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

	return (
		<>
			<ClientOnly>
				{() => {
					if (!isOnboardingTourInProgress) return null;
					return (
						<Joyride
							hideBackButton
							hideCloseButton
							spotlightClicks
							disableScrolling
							disableCloseOnEsc
							disableOverlayClose
							spotlightPadding={0}
							steps={onboardingTourSteps}
							run={isOnboardingTourInProgress}
							stepIndex={currentOnboardingTourStepIndex}
							styles={{
								overlay: { zIndex: 120 },
								tooltipContent: { padding: 0 },
							}}
						/>
					);
				}}
			</ClientOnly>
			{isFitnessActionActive &&
			!Object.values(FitnessAction)
				.map((action) => $path("/fitness/:action", { action }))
				.includes(location.pathname) ? (
				<Tooltip label="You have an active workout" position="left">
					<Affix
						style={{ transition: "all 0.3s" }}
						position={{
							bottom: rem(40),
							right: rem(
								location.pathname === $path("/fitness/exercises/list") ||
									location.pathname.includes("/fitness/exercises/item")
									? 90
									: 40,
							),
						}}
					>
						<ActionIcon
							size="xl"
							radius="xl"
							color="orange"
							variant="filled"
							onClick={() =>
								navigate(
									$path("/fitness/:action", {
										action: FitnessAction.LogWorkout,
									}),
								)
							}
						>
							<IconStretching size={32} />
						</ActionIcon>
					</Affix>
				</Tooltip>
			) : null}
			<Modal
				centered
				withCloseButton={false}
				opened={metadataToUpdate !== null}
				onClose={closeMetadataProgressUpdateModal}
			>
				<MetadataProgressUpdateForm
					closeMetadataProgressUpdateModal={closeMetadataProgressUpdateModal}
				/>
			</Modal>
			<Modal
				centered
				withCloseButton={false}
				onClose={completeOnboardingTour}
				opened={isOnLastOnboardingTourStep}
				title="You've completed the onboarding tour!"
			>
				<Stack>
					<Text>
						These are just the basics to get you up and running. Ryot has a lot
						more to offer and I encourage you to explore the app and see what it
						can do for you.
					</Text>
					<Text size="sm" c="dimmed">
						You can restart the tour at any time from the profile settings.
					</Text>
					<Button variant="outline" onClick={completeOnboardingTour}>
						Start using Ryot!
					</Button>
				</Stack>
			</Modal>
			<Modal
				centered
				withCloseButton={false}
				opened={entityToReview !== null}
				onClose={() => setEntityToReview(null)}
				title={`Reviewing "${entityToReview?.entityTitle}"`}
			>
				<ReviewEntityForm closeReviewEntityModal={closeReviewEntityModal} />
			</Modal>
			<Drawer
				withCloseButton={false}
				onClose={closeAddEntityToCollectionsDrawer}
				opened={addEntityToCollectionsData !== null}
			>
				<AddEntityToCollectionsForm
					closeAddEntityToCollectionsModal={closeAddEntityToCollectionsDrawer}
				/>
			</Drawer>
			<Drawer
				title="Add new measurement"
				opened={measurementsDrawerOpen}
				onClose={closeMeasurementsDrawer}
			>
				<CreateMeasurementForm
					closeMeasurementModal={closeMeasurementsDrawer}
				/>
			</Drawer>

			<AppShell
				w="100%"
				padding={0}
				layout="alt"
				navbar={{
					breakpoint: "sm",
					width: { sm: 220, lg: 250 },
					collapsed: {
						mobile: !mobileNavbarOpened,
						desktop: loaderData.desktopSidebarCollapsed === "true",
					},
				}}
			>
				{loaderData.desktopSidebarCollapsed ? (
					<ActionIcon
						left={0}
						size="lg"
						top="50%"
						pos="fixed"
						visibleFrom="sm"
						variant="default"
						style={{ zIndex: 20 }}
						onClick={() => {
							Cookies.remove(desktopSidebarCollapsedCookie);
							revalidate();
						}}
					>
						<IconChevronsRight size={30} />
					</ActionIcon>
				) : null}
				<AppShell.Navbar py="md" px="md" className={classes.navbar}>
					<Flex justify="end" hiddenFrom="sm">
						<Burger
							opened={mobileNavbarOpened}
							onClick={toggleMobileNavbar}
							color={theme.colors.gray[6]}
						/>
					</Flex>
					<Box component={ScrollArea} style={{ flexGrow: 1 }}>
						<LinksGroup
							opened={false}
							icon={IconHome2}
							label="Dashboard"
							setOpened={() => {}}
							href={forcedDashboardPath}
							toggle={toggleMobileNavbar}
						/>
						{loaderData.userPreferences.featuresEnabled.media.enabled ? (
							<LinksGroup
								label="Media"
								links={mediaLinks}
								icon={IconDeviceSpeaker}
								toggle={toggleMobileNavbar}
								opened={openedSidebarLinks.media || false}
								tourControlTarget={OnboardingTourStepTargets.Welcome}
								setOpened={(k) =>
									setOpenedSidebarLinks(
										produce(openedSidebarLinks, (draft) => {
											if (draft) draft.media = k;
										}),
									)
								}
							/>
						) : null}
						{loaderData.userPreferences.featuresEnabled.fitness.enabled ? (
							<LinksGroup
								label="Fitness"
								links={fitnessLinks}
								icon={IconStretching}
								toggle={toggleMobileNavbar}
								opened={openedSidebarLinks.fitness || false}
								tourControlTarget={OnboardingTourStepTargets.OpenFitnessSidebar}
								setOpened={(k) =>
									setOpenedSidebarLinks(
										produce(openedSidebarLinks, (draft) => {
											if (draft) draft.fitness = k;
										}),
									)
								}
							/>
						) : null}
						{loaderData.userPreferences.featuresEnabled.analytics.enabled ? (
							<LinksGroup
								opened={false}
								icon={IconGraph}
								label="Analytics"
								setOpened={() => {}}
								toggle={toggleMobileNavbar}
								href={$path("/analytics")}
								tourControlTarget={
									OnboardingTourStepTargets.ClickOnAnalyticsSidebarSection
								}
							/>
						) : null}
						{loaderData.userPreferences.featuresEnabled.others.calendar ? (
							<LinksGroup
								opened={false}
								label="Calendar"
								icon={IconCalendar}
								setOpened={() => {}}
								toggle={toggleMobileNavbar}
								href={$path("/calendar")}
							/>
						) : null}
						{loaderData.userPreferences.featuresEnabled.others.collections ? (
							<LinksGroup
								opened={false}
								icon={IconArchive}
								label="Collections"
								setOpened={() => {}}
								toggle={toggleMobileNavbar}
								href={$path("/collections/list")}
								tourControlTarget={
									OnboardingTourStepTargets.ClickOnCollectionsSidebarSection
								}
							/>
						) : null}
						{loaderData.isAccessLinkSession &&
						!loaderData.isDemoInstance ? null : (
							<LinksGroup
								label="Settings"
								icon={IconSettings}
								links={settingsLinks}
								toggle={toggleMobileNavbar}
								opened={openedSidebarLinks.settings || false}
								tourControlTarget={
									OnboardingTourStepTargets.OpenSettingsSidebar
								}
								setOpened={(k) =>
									setOpenedSidebarLinks(
										produce(openedSidebarLinks, (draft) => {
											if (draft) draft.settings = k;
										}),
									)
								}
							/>
						)}
					</Box>
					<Flex direction="column" justify="center" gap="md">
						<Button
							color="gray"
							visibleFrom="sm"
							variant="subtle"
							leftSection={<IconChevronsLeft />}
							onClick={() => {
								Cookies.set(desktopSidebarCollapsedCookie, "true");
								revalidate();
							}}
						>
							Collapse
						</Button>
						{loaderData.isAccessLinkSession ? (
							<Tooltip label={`You are viewing ${userDetails.name}'s data.`}>
								<Button leftSection={<IconEyeglass />} disabled>
									Visitor
								</Button>
							</Tooltip>
						) : null}
						<Form
							method="POST"
							onSubmit={submit}
							action={withQuery("/actions", { intent: "toggleColorScheme" })}
						>
							<Group justify="center">
								<UnstyledButton
									type="submit"
									aria-label="Toggle theme"
									className={classes.control2}
								>
									<Center className={classes.iconWrapper}>
										<Icon size={16.8} stroke={1.5} />
									</Center>
									<Text size="sm" className={classes.value}>
										{upperFirst(
											loaderData.currentColorScheme === "dark"
												? "light"
												: "dark",
										)}{" "}
										theme
									</Text>
								</UnstyledButton>
							</Group>
						</Form>
						<Form
							method="POST"
							style={{ display: "flex" }}
							action={withQuery("/actions", { intent: "logout" })}
						>
							<UnstyledButton
								mx="auto"
								type="submit"
								className={classes.oldLink}
							>
								<Group>
									<IconLogout size={19.2} />
									<Text>Logout</Text>
								</Group>
							</UnstyledButton>
						</Form>
					</Flex>
				</AppShell.Navbar>
				<Flex direction="column" h="90%">
					<Flex justify="space-between" p="md" hiddenFrom="sm">
						<Link to={forcedDashboardPath} style={{ all: "unset" }}>
							<Group>
								<Image
									h={40}
									w={40}
									darkHidden
									radius="md"
									src={LOGO_IMAGE_URL}
								/>
								<Image
									h={40}
									w={40}
									radius="md"
									lightHidden
									src="/logo-light.png"
								/>
								<Text size="xl" className={classes.logoText}>
									Ryot
								</Text>
							</Group>
						</Link>
						<Burger
							opened={mobileNavbarOpened}
							onClick={toggleMobileNavbar}
							color={theme.colors.gray[6]}
						/>
					</Flex>
					<AppShell.Main py={{ sm: "xl" }}>
						<Box
							mt="md"
							pb={40}
							mih="90%"
							style={{ flexGrow: 1 }}
							ref={
								loaderData.userPreferences.general.disableNavigationAnimation
									? undefined
									: parent
							}
						>
							<Outlet />
						</Box>
						<Box className={classes.shellFooter}>
							<Footer />
						</Box>
					</AppShell.Main>
				</Flex>
			</AppShell>
			{loaderData.shouldHaveUmami ? (
				<script
					defer
					src={loaderData.coreDetails.frontend.umami.scriptUrl}
					data-domains={loaderData.coreDetails.frontend.umami.domains}
					data-website-id={loaderData.coreDetails.frontend.umami.websiteId}
				/>
			) : null}
		</>
	);
}
