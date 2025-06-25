import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Affix,
	AppShell,
	Box,
	Burger,
	Button,
	Center,
	Flex,
	Group,
	Image,
	ScrollArea,
	Text,
	Tooltip,
	UnstyledButton,
	rem,
	useMantineTheme,
} from "@mantine/core";
import { upperFirst, useDisclosure } from "@mantine/hooks";
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
	IconSettings,
	IconStretching,
} from "@tabler/icons-react";
import { produce } from "immer";
import Cookies from "js-cookie";
import Joyride from "react-joyride";
import {
	Form,
	Link,
	Outlet,
	useLoaderData,
	useLocation,
	useNavigate,
	useRevalidator,
} from "react-router";
import { ClientOnly } from "remix-utils/client-only";
import { $path } from "safe-routes";
import { withQuery } from "ufo";
import {
	Footer,
	LayoutModals,
	LinksGroup,
	desktopSidebarCollapsedCookie,
	getFitnessLinks,
	getMediaLinks,
	getSettingsLinks,
	getThemeIcon,
} from "~/components/dashboard";
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
import {
	OnboardingTourStepTargets,
	useOnboardingTour,
	useOpenedSidebarLinks,
} from "~/lib/state/general";
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
	const {
		onboardingTourSteps,
		completeOnboardingTour,
		isOnboardingTourInProgress,
		isOnLastOnboardingTourStep,
		currentOnboardingTourStepIndex,
	} = useOnboardingTour();

	const mediaLinks = getMediaLinks(userPreferences, isOnboardingTourInProgress);
	const Icon = getThemeIcon(loaderData.currentColorScheme);
	const fitnessLinks = getFitnessLinks(
		userPreferences,
		isOnboardingTourInProgress,
	);
	const settingsLinks = getSettingsLinks(userDetails);

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
			<LayoutModals
				isOnLastOnboardingTourStep={isOnLastOnboardingTourStep}
				completeOnboardingTour={completeOnboardingTour}
			/>
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

export { ErrorBoundary } from "~/components/dashboard/error-boundary";
