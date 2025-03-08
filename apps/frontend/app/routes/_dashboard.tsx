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
	Checkbox,
	Code,
	Collapse,
	Container,
	Drawer,
	Flex,
	Group,
	Image,
	Input,
	List,
	Loader,
	Modal,
	NumberInput,
	Paper,
	Rating,
	ScrollArea,
	SegmentedControl,
	Select,
	SimpleGrid,
	Slider,
	Stack,
	Text,
	TextInput,
	Textarea,
	ThemeIcon,
	Title,
	Tooltip,
	UnstyledButton,
	rem,
	useDirection,
	useMantineTheme,
} from "@mantine/core";
import { DateInput, DatePickerInput, DateTimePicker } from "@mantine/dates";
import { upperFirst, useCounter, useDisclosure } from "@mantine/hooks";
import {
	CollectionExtraInformationLot,
	EntityLot,
	MediaLot,
	type MetadataDetailsQuery,
	type UserCollectionsListQuery,
	UserLot,
	type UserMetadataDetailsQuery,
	UserReviewScale,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	formatDateToNaiveDate,
	groupBy,
	isNumber,
	snakeCase,
} from "@ryot/ts-utils";
import {
	IconArchive,
	IconBook,
	IconBrandPagekit,
	IconCalendar,
	IconCancel,
	IconChevronLeft,
	IconChevronRight,
	IconChevronsLeft,
	IconChevronsRight,
	IconClock,
	IconDeviceSpeaker,
	IconDeviceTv,
	IconEyeglass,
	IconGraph,
	IconHome2,
	IconLogout,
	IconMoodEmpty,
	IconMoodHappy,
	IconMoodSad,
	IconMoon,
	IconPercentage,
	IconSettings,
	IconStretching,
	IconSun,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { produce } from "immer";
import Cookies from "js-cookie";
import { type FC, type FormEvent, type ReactNode, useState } from "react";
import Joyride from "react-joyride";
import {
	Form,
	Link,
	NavLink,
	Outlet,
	isRouteErrorResponse,
	useLoaderData,
	useLocation,
	useNavigate,
	useRevalidator,
	useRouteError,
} from "react-router";
import { Fragment } from "react/jsx-runtime";
import { ClientOnly } from "remix-utils/client-only";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { joinURL, withQuery } from "ufo";
import {
	FitnessAction,
	LOGO_IMAGE_URL,
	ThreePointSmileyRating,
	Verb,
	convertDecimalToThreePointSmiley,
	getMetadataDetailsQuery,
	getVerb,
	refreshUserMetadataDetails,
} from "~/lib/generals";
import {
	useApplicationEvents,
	useConfirmSubmit,
	useCoreDetails,
	useGetWatchProviders,
	useIsFitnessActionActive,
	useMetadataDetails,
	useNonHiddenUserCollections,
	useUserDetails,
	useUserMetadataDetails,
	useUserPreferences,
} from "~/lib/hooks";
import { useBulkEditCollection } from "~/lib/state/collection";
import { useMeasurementsDrawerOpen } from "~/lib/state/fitness";
import {
	OnboardingTourStepTargets,
	type TourControl,
	onboardingTourSteps,
	useOnboardingTour,
	useOpenedSidebarLinks,
} from "~/lib/state/general";
import {
	type UpdateProgressData,
	useAddEntityToCollection,
	useMetadataProgressUpdate,
	useReviewEntity,
} from "~/lib/state/media";
import {
	getCookieValue,
	getCoreDetails,
	getDecodedJwt,
	getUserCollectionsList,
	getUserPreferences,
	redirectIfNotAuthenticatedOrUpdated,
} from "~/lib/utilities.server";
import { colorSchemeCookie } from "~/lib/utilities.server";
import classes from "~/styles/dashboard.module.css";
import type { Route } from "./+types/_dashboard";

const discordLink = "https://discord.gg/D9XTg2a7R8";
const desktopSidebarCollapsedCookie = "DesktopSidebarCollapsed";

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

	const fitnessLinks = [
		...(Object.entries(userPreferences.featuresEnabled.fitness || {})
			.filter(([v, _]) => !["enabled"].includes(v))
			.map(([name, enabled]) => ({ name, enabled }))
			?.filter((f) => f.enabled)
			.map((f) => ({
				label: changeCase(f.name.toString()),
				href: joinURL("/fitness", f.name, "list"),
			})) || []),
		{ label: "Exercises", href: $path("/fitness/exercises/list") },
	]
		.filter((link) => link !== undefined)
		.map((link) => ({ label: link.label, link: link.href }));

	const settingsLinks = [
		{ label: "Preferences", link: $path("/settings/preferences") },
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

	const currentColorScheme = await colorSchemeCookie.parse(
		request.headers.get("cookie") || "",
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
		fitnessLinks,
		settingsLinks,
		isDemoInstance,
		userPreferences,
		shouldHaveUmami,
		userCollections,
		currentColorScheme,
		isAccessLinkSession,
		desktopSidebarCollapsed,
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
	const [addEntityToCollectionData, setAddEntityToCollectionData] =
		useAddEntityToCollection();
	const closeAddEntityToCollectionModal = () =>
		setAddEntityToCollectionData(null);
	const [measurementsDrawerOpen, setMeasurementsDrawerOpen] =
		useMeasurementsDrawerOpen();
	const closeMeasurementsDrawer = () => setMeasurementsDrawerOpen(false);
	const bulkEditingCollection = useBulkEditCollection();
	const { isTourStarted, stepIndex, advanceTourStep } = useOnboardingTour();

	const mediaLinks = [
		...userPreferences.featuresEnabled.media.specific.map((f) => {
			return {
				label: changeCase(f),
				link: $path("/media/:action/:lot", { action: "list", lot: f }),
				tourControl:
					isTourStarted && f === MediaLot.Movie
						? ({
								target: OnboardingTourStepTargets.Two,
								onTargetInteract: () => advanceTourStep(1000),
							} as TourControl)
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
	const bulkEditingCollectionState = bulkEditingCollection.state;
	const shouldShowBulkEditingAffix =
		bulkEditingCollectionState &&
		(bulkEditingCollectionState.data.action === "remove"
			? location.pathname ===
				$path("/collections/:id", {
					id: bulkEditingCollectionState.data.collection.id,
				})
			: [
					...Object.values(MediaLot).map((ml) =>
						$path("/media/:action/:lot", { action: "list", lot: ml }),
					),
					$path("/media/people/:action", { action: "list" }),
					$path("/media/groups/:action", { action: "list" }),
				].includes(location.pathname));

	return (
		<>
			<ClientOnly>
				{() => {
					if (!isTourStarted) return null;
					return (
						<Joyride
							hideBackButton
							hideCloseButton
							disableCloseOnEsc
							disableOverlayClose
							run={isTourStarted}
							spotlightPadding={0}
							stepIndex={stepIndex}
							steps={onboardingTourSteps}
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
						position={{
							bottom: rem(40),
							right: rem(
								location.pathname === $path("/fitness/exercises/list") ||
									location.pathname.includes("/fitness/exercises/item")
									? 90
									: 40,
							),
						}}
						style={{ transition: "all 0.3s" }}
					>
						<ActionIcon
							variant="filled"
							color="orange"
							radius="xl"
							size="xl"
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
			{shouldShowBulkEditingAffix ? (
				<Affix position={{ bottom: rem(30) }} w="100%" px="sm">
					<Form
						method="POST"
						onSubmit={(e) => {
							submit(e);
							bulkEditingCollectionState.stop(true);
						}}
						action={$path("/actions", { intent: "bulkCollectionAction" })}
					>
						<input
							type="hidden"
							name="action"
							defaultValue={bulkEditingCollectionState.data.action}
						/>
						<input
							type="hidden"
							name="collectionName"
							defaultValue={bulkEditingCollectionState.data.collection.name}
						/>
						<input
							type="hidden"
							name="creatorUserId"
							defaultValue={
								bulkEditingCollectionState.data.collection.creatorUserId
							}
						/>
						{bulkEditingCollectionState.data.entities.map((item, index) => (
							<Fragment key={JSON.stringify(item)}>
								<input
									readOnly
									type="hidden"
									value={item.entityId}
									name={`items[${index}].entityId`}
								/>
								<input
									readOnly
									type="hidden"
									value={item.entityLot}
									name={`items[${index}].entityLot`}
								/>
							</Fragment>
						))}
						<Paper withBorder shadow="xl" p="md" w={{ md: "40%" }} mx="auto">
							<Group wrap="nowrap" justify="space-between">
								<Text fz={{ base: "xs", md: "md" }}>
									{bulkEditingCollectionState.data.entities.length} items
									selected
								</Text>
								<Group wrap="nowrap">
									<ActionIcon
										size="md"
										onClick={() => bulkEditingCollectionState.stop()}
									>
										<IconCancel />
									</ActionIcon>
									<Button
										size="xs"
										color="blue"
										loading={bulkEditingCollectionState.data.isLoading}
										onClick={() => bulkEditingCollectionState.bulkAdd()}
									>
										Select all items
									</Button>
									<Button
										size="xs"
										color={
											bulkEditingCollectionState.data.action === "remove"
												? "red"
												: "green"
										}
										type="submit"
										disabled={
											bulkEditingCollectionState.data.entities.length === 0
										}
									>
										{changeCase(bulkEditingCollectionState.data.action)}
									</Button>
								</Group>
							</Group>
						</Paper>
					</Form>
				</Affix>
			) : null}
			<Modal
				onClose={closeMetadataProgressUpdateModal}
				opened={metadataToUpdate !== null}
				withCloseButton={false}
				centered
			>
				<MetadataProgressUpdateForm
					closeMetadataProgressUpdateModal={closeMetadataProgressUpdateModal}
				/>
			</Modal>
			<Modal
				onClose={() => setEntityToReview(null)}
				opened={entityToReview !== null}
				withCloseButton={false}
				centered
			>
				<ReviewEntityForm closeReviewEntityModal={closeReviewEntityModal} />
			</Modal>
			<Modal
				onClose={closeAddEntityToCollectionModal}
				opened={addEntityToCollectionData !== null}
				withCloseButton={false}
				centered
			>
				<AddEntityToCollectionForm
					closeAddEntityToCollectionModal={closeAddEntityToCollectionModal}
				/>
			</Modal>
			<Drawer
				onClose={closeMeasurementsDrawer}
				opened={measurementsDrawerOpen}
				title="Add new measurement"
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
							href={$path("/")}
							toggle={toggleMobileNavbar}
						/>
						{loaderData.userPreferences.featuresEnabled.media.enabled ? (
							<LinksGroup
								label="Media"
								links={mediaLinks}
								icon={IconDeviceSpeaker}
								toggle={toggleMobileNavbar}
								opened={openedSidebarLinks.media || false}
								tourControl={{
									target: OnboardingTourStepTargets.One,
									onTargetInteract: () => advanceTourStep(),
								}}
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
								icon={IconStretching}
								opened={openedSidebarLinks.fitness || false}
								toggle={toggleMobileNavbar}
								setOpened={(k) =>
									setOpenedSidebarLinks(
										produce(openedSidebarLinks, (draft) => {
											if (draft) draft.fitness = k;
										}),
									)
								}
								links={loaderData.fitnessLinks}
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
							/>
						) : null}
						{loaderData.userPreferences.featuresEnabled.others.calendar ? (
							<LinksGroup
								label="Calendar"
								icon={IconCalendar}
								href={$path("/calendar")}
								opened={false}
								toggle={toggleMobileNavbar}
								setOpened={() => {}}
							/>
						) : null}
						{loaderData.userPreferences.featuresEnabled.others.collections ? (
							<LinksGroup
								label="Collections"
								icon={IconArchive}
								href={$path("/collections/list")}
								opened={false}
								toggle={toggleMobileNavbar}
								setOpened={() => {}}
							/>
						) : null}
						{loaderData.isAccessLinkSession &&
						!loaderData.isDemoInstance ? null : (
							<LinksGroup
								label="Settings"
								icon={IconSettings}
								opened={openedSidebarLinks.settings || false}
								toggle={toggleMobileNavbar}
								setOpened={(k) =>
									setOpenedSidebarLinks(
										produce(openedSidebarLinks, (draft) => {
											if (draft) draft.settings = k;
										}),
									)
								}
								links={loaderData.settingsLinks}
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
							action={withQuery("/actions", { intent: "toggleColorScheme" })}
							onSubmit={submit}
						>
							<Group justify="center">
								<UnstyledButton
									aria-label="Toggle theme"
									className={classes.control2}
									type="submit"
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
								className={classes.oldLink}
								type="submit"
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
						<Link to={$path("/")} style={{ all: "unset" }}>
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

interface LinksGroupProps {
	// biome-ignore lint/suspicious/noExplicitAny: required here
	icon: FC<any>;
	label: string;
	href?: string;
	opened: boolean;
	toggle: () => void;
	tourControl?: TourControl;
	setOpened: (v: boolean) => void;
	links?: Array<{ label: string; link: string; tourControl?: TourControl }>;
}

const LinksGroup = ({
	href,
	label,
	links,
	opened,
	toggle,
	setOpened,
	icon: Icon,
	tourControl,
}: LinksGroupProps) => {
	const { dir } = useDirection();

	const hasLinks = Array.isArray(links);
	const ChevronIcon = dir === "ltr" ? IconChevronRight : IconChevronLeft;
	const linkItems = (hasLinks ? links || [] : []).map((link) => (
		<NavLink
			to={link.link}
			key={link.label}
			onClick={() => {
				toggle();
				link.tourControl?.onTargetInteract();
			}}
			className={clsx(classes.link, link.tourControl?.target)}
		>
			{({ isActive }) => (
				<span style={isActive ? { textDecoration: "underline" } : undefined}>
					{link.label}
				</span>
			)}
		</NavLink>
	));

	return (
		<Box>
			<UnstyledButton<typeof Link>
				className={clsx(classes.control, tourControl?.target)}
				component={!hasLinks ? Link : undefined}
				// biome-ignore lint/suspicious/noExplicitAny: required here
				to={!hasLinks ? href : (undefined as any)}
				onClick={() => {
					if (hasLinks) {
						setOpened(!opened);
						setTimeout(() => tourControl?.onTargetInteract(), 200);
						return;
					}
					toggle();
				}}
			>
				<Group justify="space-between" gap={0}>
					<Box style={{ display: "flex", alignItems: "center" }}>
						<ThemeIcon variant="light" size={30}>
							<Icon size={17.6} />
						</ThemeIcon>
						<Box ml="md">{label}</Box>
					</Box>
					{hasLinks ? (
						<ClientOnly>
							{() => (
								<ChevronIcon
									className={classes.chevron}
									size={16}
									stroke={1.5}
									style={{
										transform: opened
											? `rotate(${dir === "rtl" ? -90 : 90}deg)`
											: "none",
									}}
								/>
							)}
						</ClientOnly>
					) : null}
				</Group>
			</UnstyledButton>
			{hasLinks ? <Collapse in={opened}>{linkItems}</Collapse> : null}
		</Box>
	);
};

const Footer = () => {
	const coreDetails = useCoreDetails();

	return (
		<Flex gap={80} justify="center">
			{!coreDetails.isServerKeyValidated ? (
				<Anchor href={coreDetails.websiteUrl} target="_blank">
					<Text c="red" fw="bold">
						Ryot Pro
					</Text>
				</Anchor>
			) : null}
			<Anchor href={discordLink} target="_blank">
				<Text c="indigo" fw="bold">
					Discord
				</Text>
			</Anchor>
			<Text c="grape" fw="bold" visibleFrom="md">
				{coreDetails.version}
			</Text>
			<Anchor href={coreDetails.repositoryLink} target="_blank">
				<Text c="orange" fw="bold">
					Github
				</Text>
			</Anchor>
		</Flex>
	);
};

enum WatchTimes {
	JustCompletedNow = "Just Completed Now",
	IDontRemember = "I don't remember",
	CustomDate = "Custom Date",
	JustStartedIt = "Just Started It",
}

const MetadataProgressUpdateForm = ({
	closeMetadataProgressUpdateModal,
}: {
	closeMetadataProgressUpdateModal: () => void;
}) => {
	const submit = useConfirmSubmit();
	const events = useApplicationEvents();
	const [metadataToUpdate] = useMetadataProgressUpdate();

	const { data: metadataDetails } = useMetadataDetails(
		metadataToUpdate?.metadataId,
	);
	const { data: userMetadataDetails } = useUserMetadataDetails(
		metadataToUpdate?.metadataId,
	);

	if (!metadataDetails || !metadataToUpdate || !userMetadataDetails)
		return (
			<Center p="lg">
				<Loader type="dots" />
			</Center>
		);

	const onSubmit = (e: FormEvent<HTMLFormElement>) => {
		submit(e);
		const metadataId = metadataToUpdate.metadataId;
		events.updateProgress(metadataDetails.title);
		refreshUserMetadataDetails(metadataId);
		closeMetadataProgressUpdateModal();
	};

	return userMetadataDetails.inProgress ? (
		<MetadataInProgressUpdateForm
			onSubmit={onSubmit}
			metadataDetails={metadataDetails}
			metadataToUpdate={metadataToUpdate}
			inProgress={userMetadataDetails.inProgress}
		/>
	) : (
		<MetadataNewProgressUpdateForm
			onSubmit={onSubmit}
			metadataDetails={metadataDetails}
			metadataToUpdate={metadataToUpdate}
			history={userMetadataDetails.history}
		/>
	);
};

type InProgress = UserMetadataDetailsQuery["userMetadataDetails"]["inProgress"];
type History = UserMetadataDetailsQuery["userMetadataDetails"]["history"];

const MetadataInProgressUpdateForm = ({
	onSubmit,
	inProgress,
	metadataDetails,
	metadataToUpdate,
}: {
	onSubmit: (e: FormEvent<HTMLFormElement>) => void;
	inProgress: NonNullable<InProgress>;
	metadataToUpdate: UpdateProgressData;
	metadataDetails: MetadataDetailsQuery["metadataDetails"];
}) => {
	const total =
		metadataDetails.audioBookSpecifics?.runtime ||
		metadataDetails.bookSpecifics?.pages ||
		metadataDetails.movieSpecifics?.runtime ||
		metadataDetails.mangaSpecifics?.chapters ||
		metadataDetails.animeSpecifics?.episodes ||
		metadataDetails.visualNovelSpecifics?.length;
	const progress = Number(inProgress.progress);
	const [value, setValue] = useState<number | undefined>(progress);

	const [updateIcon, text] = match(metadataDetails.lot)
		.with(MediaLot.Book, () => [<IconBook size={24} key="element" />, "Pages"])
		.with(MediaLot.Anime, () => [
			<IconDeviceTv size={24} key="element" />,
			"Episodes",
		])
		.with(MediaLot.Manga, () => [
			<IconBrandPagekit size={24} key="element" />,
			"Chapters",
		])
		.with(MediaLot.Movie, MediaLot.VisualNovel, MediaLot.AudioBook, () => [
			<IconClock size={24} key="element" />,
			"Minutes",
		])
		.otherwise(() => [null, null]);

	return (
		<Form
			method="POST"
			onSubmit={onSubmit}
			action={withQuery($path("/actions"), {
				intent: "individualProgressUpdate",
			})}
		>
			<input
				hidden
				name="metadataId"
				defaultValue={metadataToUpdate.metadataId}
			/>
			<input hidden name="progress" value={value} readOnly />
			<input
				hidden
				name="date"
				defaultValue={formatDateToNaiveDate(new Date())}
			/>
			<Stack mt="sm">
				<Group>
					<Slider
						max={100}
						min={0}
						step={1}
						showLabelOnHover={false}
						value={value}
						onChange={setValue}
						style={{ flexGrow: 1 }}
					/>
					<NumberInput
						w="20%"
						min={0}
						step={1}
						max={100}
						hideControls
						value={value}
						onFocus={(e) => e.target.select()}
						rightSection={<IconPercentage size={16} />}
						onChange={(v) => {
							if (v) setValue(Number(v));
							else setValue(undefined);
						}}
					/>
				</Group>
				{total ? (
					<>
						<Text ta="center" fw="bold">
							OR
						</Text>
						<Flex align="center" gap="xs">
							<NumberInput
								min={0}
								step={1}
								flex={1}
								hideControls
								leftSection={updateIcon}
								max={Number(total)}
								onFocus={(e) => e.target.select()}
								defaultValue={((Number(total) || 1) * (value || 1)) / 100}
								onChange={(v) => {
									const value = (Number(v) / (Number(total) || 1)) * 100;
									setValue(value);
								}}
							/>
							<Text>{text}</Text>
						</Flex>
					</>
				) : null}
				<Button variant="outline" type="submit">
					Update
				</Button>
			</Stack>
		</Form>
	);
};

const MetadataNewProgressUpdateForm = ({
	history,
	onSubmit,
	metadataDetails,
	metadataToUpdate,
}: {
	onSubmit: (e: FormEvent<HTMLFormElement>) => void;
	metadataToUpdate: UpdateProgressData;
	metadataDetails: MetadataDetailsQuery["metadataDetails"];
	history: History;
}) => {
	const [parent] = useAutoAnimate();
	const [_, setMetadataToUpdate] = useMetadataProgressUpdate();
	const [selectedDate, setSelectedDate] = useState<Date | null | undefined>(
		new Date(),
	);
	const [watchTime, setWatchTime] = useState<WatchTimes>(
		WatchTimes.JustCompletedNow,
	);
	const watchProviders = useGetWatchProviders(metadataDetails.lot);
	const { advanceTourStep } = useOnboardingTour();

	const lastProviderWatchedOn = history[0]?.providerWatchedOn;

	return (
		<Form
			method="POST"
			onSubmit={onSubmit}
			action={withQuery($path("/actions"), {
				intent:
					watchTime === WatchTimes.JustStartedIt
						? "individualProgressUpdate"
						: "progressUpdate",
			})}
		>
			{[
				...Object.entries(metadataToUpdate),
				watchTime !== WatchTimes.JustStartedIt
					? ["metadataLot", metadataDetails.lot]
					: undefined,
				watchTime === WatchTimes.JustStartedIt ? ["progress", "0"] : undefined,
				selectedDate
					? ["date", formatDateToNaiveDate(selectedDate)]
					: undefined,
			]
				.filter((v) => typeof v !== "undefined")
				.map(([k, v]) => (
					<Fragment key={k}>
						{typeof v !== "undefined" ? (
							<input hidden readOnly name={k} value={v?.toString()} />
						) : null}
					</Fragment>
				))}
			<Stack ref={parent}>
				{metadataDetails.lot === MediaLot.Anime ? (
					<>
						<NumberInput
							label="Episode"
							required
							hideControls
							value={metadataToUpdate.animeEpisodeNumber?.toString()}
							onChange={(e) => {
								setMetadataToUpdate(
									produce(metadataToUpdate, (draft) => {
										draft.animeEpisodeNumber = Number(e);
									}),
								);
							}}
						/>
						<Checkbox
							label="Mark all unseen episodes before this as watched"
							name="animeAllEpisodesBefore"
						/>
					</>
				) : null}
				{metadataDetails.lot === MediaLot.Manga ? (
					<>
						<Input.Wrapper
							required
							label="Enter either the chapter number or the volume number"
						>
							<Group wrap="nowrap">
								<NumberInput
									description="Chapter"
									hideControls
									value={metadataToUpdate.mangaChapterNumber?.toString()}
									onChange={(e) => {
										setMetadataToUpdate(
											produce(metadataToUpdate, (draft) => {
												draft.mangaChapterNumber =
													e === "" ? undefined : Number(e).toString();
											}),
										);
									}}
								/>
								<Text ta="center" fw="bold" mt="sm">
									OR
								</Text>
								<NumberInput
									description="Volume"
									hideControls
									value={metadataToUpdate.mangaVolumeNumber?.toString()}
									onChange={(e) => {
										setMetadataToUpdate(
											produce(metadataToUpdate, (draft) => {
												draft.mangaVolumeNumber =
													e === "" ? undefined : Number(e);
											}),
										);
									}}
								/>
							</Group>
						</Input.Wrapper>
						<Checkbox
							label="Mark all unread volumes/chapters before this as watched"
							name="mangaAllChaptersOrVolumesBefore"
						/>
					</>
				) : null}
				{metadataDetails.lot === MediaLot.Show ? (
					<>
						<Select
							label="Season"
							required
							data={metadataDetails.showSpecifics?.seasons.map((s) => ({
								label: `${s.seasonNumber}. ${s.name.toString()}`,
								value: s.seasonNumber.toString(),
							}))}
							value={metadataToUpdate.showSeasonNumber?.toString()}
							onChange={(v) => {
								setMetadataToUpdate(
									produce(metadataToUpdate, (draft) => {
										draft.showSeasonNumber = Number(v);
									}),
								);
							}}
							searchable
							limit={50}
						/>
						<Select
							label="Episode"
							required
							data={
								metadataDetails.showSpecifics?.seasons
									.find(
										(s) => s.seasonNumber === metadataToUpdate.showSeasonNumber,
									)
									?.episodes.map((e) => ({
										label: `${e.episodeNumber}. ${e.name.toString()}`,
										value: e.episodeNumber.toString(),
									})) || []
							}
							value={metadataToUpdate.showEpisodeNumber?.toString()}
							onChange={(v) => {
								setMetadataToUpdate(
									produce(metadataToUpdate, (draft) => {
										draft.showEpisodeNumber = Number(v);
									}),
								);
							}}
							searchable
							limit={50}
						/>
						<Checkbox
							label="Mark all unseen episodes before this as seen"
							defaultChecked={metadataToUpdate.showAllEpisodesBefore}
							onChange={(e) => {
								setMetadataToUpdate(
									produce(metadataToUpdate, (draft) => {
										draft.showAllEpisodesBefore = e.target.checked;
									}),
								);
							}}
						/>
					</>
				) : null}
				{metadataDetails.lot === MediaLot.Podcast ? (
					<>
						<Text fw="bold">Select episode</Text>
						<Select
							required
							label="Episode"
							data={metadataDetails.podcastSpecifics?.episodes.map((se) => ({
								label: se.title.toString(),
								value: se.number.toString(),
							}))}
							value={metadataToUpdate.podcastEpisodeNumber?.toString()}
							onChange={(v) => {
								setMetadataToUpdate(
									produce(metadataToUpdate, (draft) => {
										draft.podcastEpisodeNumber = Number(v);
									}),
								);
							}}
							searchable
							limit={50}
						/>
						<Checkbox
							label="Mark all unseen episodes before this as seen"
							name="podcastAllEpisodesBefore"
						/>
					</>
				) : null}
				<Select
					value={watchTime}
					data={Object.values(WatchTimes).filter((v) =>
						[
							MediaLot.Show,
							MediaLot.Podcast,
							MediaLot.Anime,
							MediaLot.Manga,
						].includes(metadataDetails.lot)
							? v !== WatchTimes.JustStartedIt
							: true,
					)}
					label={`When did you ${getVerb(Verb.Read, metadataDetails.lot)} it?`}
					onChange={(v) => {
						setWatchTime(v as typeof watchTime);
						match(v)
							.with(WatchTimes.JustCompletedNow, () =>
								setSelectedDate(new Date()),
							)
							.with(
								WatchTimes.IDontRemember,
								WatchTimes.CustomDate,
								WatchTimes.JustStartedIt,
								() => setSelectedDate(null),
							)
							.run();
					}}
				/>
				{watchTime === WatchTimes.CustomDate ? (
					<DatePickerInput
						required
						clearable
						dropdownType="modal"
						maxDate={new Date()}
						onChange={setSelectedDate}
						label="Enter exact date"
					/>
				) : null}
				{watchTime !== WatchTimes.JustStartedIt ? (
					<Select
						data={watchProviders}
						name="providerWatchedOn"
						defaultValue={lastProviderWatchedOn}
						label={`Where did you ${getVerb(Verb.Read, metadataDetails.lot)} it?`}
					/>
				) : null}
				<Button
					type="submit"
					variant="outline"
					onClick={() => advanceTourStep()}
					disabled={selectedDate === undefined}
					className={OnboardingTourStepTargets.Seven}
				>
					Submit
				</Button>
			</Stack>
		</Form>
	);
};

const convertThreePointSmileyToDecimal = (rating: ThreePointSmileyRating) =>
	match(rating)
		.with(ThreePointSmileyRating.Happy, () => 100)
		.with(ThreePointSmileyRating.Neutral, () => 66.66)
		.with(ThreePointSmileyRating.Sad, () => 33.33)
		.exhaustive();

const ReviewEntityForm = ({
	closeReviewEntityModal,
}: {
	closeReviewEntityModal: () => void;
}) => {
	const userPreferences = useUserPreferences();
	const events = useApplicationEvents();
	const submit = useConfirmSubmit();
	const [entityToReview] = useReviewEntity();
	const [ratingInThreePointSmiley, setRatingInThreePointSmiley] = useState<
		ThreePointSmileyRating | undefined
	>(
		entityToReview?.existingReview?.rating
			? convertDecimalToThreePointSmiley(
					Number(entityToReview.existingReview.rating),
				)
			: undefined,
	);
	const [showSeasonNumber, setShowSeasonNumber] = useState<string | undefined>(
		entityToReview?.existingReview?.showExtraInformation?.season?.toString(),
	);
	const [showEpisodeNumber, _setShowEpisodeNumber] = useState<
		string | undefined
	>(entityToReview?.existingReview?.showExtraInformation?.episode?.toString());
	const [podcastEpisodeNumber, _setPodcastEpisodeNumber] = useState<
		string | undefined
	>(
		entityToReview?.existingReview?.podcastExtraInformation?.episode?.toString(),
	);
	const { data: metadataDetails } = useQuery({
		...getMetadataDetailsQuery(entityToReview?.entityId),
		enabled: entityToReview?.entityLot === EntityLot.Metadata,
	});

	const SmileySurround = (props: {
		children: ReactNode;
		smileyRating: ThreePointSmileyRating;
	}) => (
		<ThemeIcon
			size="xl"
			variant={
				props.smileyRating === ratingInThreePointSmiley
					? "outline"
					: "transparent"
			}
			onClick={() => setRatingInThreePointSmiley(props.smileyRating)}
		>
			{props.children}
		</ThemeIcon>
	);

	if (!entityToReview) return null;

	return (
		<Form
			replace
			method="POST"
			action={withQuery("/actions", { intent: "performReviewAction" })}
			onSubmit={(e) => {
				submit(e);
				refreshUserMetadataDetails(entityToReview.entityId);
				events.postReview(entityToReview.entityTitle);
				closeReviewEntityModal();
			}}
		>
			<input hidden name="entityId" value={entityToReview.entityId} readOnly />
			{userPreferences.general.reviewScale ===
				UserReviewScale.ThreePointSmiley && ratingInThreePointSmiley ? (
				<input
					hidden
					readOnly
					name="rating"
					value={convertThreePointSmileyToDecimal(ratingInThreePointSmiley)}
				/>
			) : undefined}
			<input
				hidden
				readOnly
				name="entityLot"
				value={entityToReview.entityLot}
			/>
			{entityToReview.existingReview?.id ? (
				<input
					hidden
					readOnly
					name="reviewId"
					value={entityToReview.existingReview.id}
				/>
			) : null}
			<Stack>
				<Flex align="center" gap="xl">
					{match(userPreferences.general.reviewScale)
						.with(UserReviewScale.OutOfFive, () => (
							<Flex gap="sm" mt="lg">
								<Input.Label>Rating:</Input.Label>
								<Rating
									name="rating"
									fractions={2}
									defaultValue={
										entityToReview.existingReview?.rating
											? Number(entityToReview.existingReview.rating)
											: undefined
									}
								/>
							</Flex>
						))
						.with(UserReviewScale.OutOfHundred, () => (
							<NumberInput
								w="40%"
								min={0}
								step={1}
								max={100}
								hideControls
								name="rating"
								label="Rating"
								rightSection={<IconPercentage size={16} />}
								defaultValue={
									entityToReview.existingReview?.rating
										? Number(entityToReview.existingReview.rating)
										: undefined
								}
							/>
						))
						.with(UserReviewScale.ThreePointSmiley, () => (
							<Stack gap={4}>
								<Text size="xs" c="dimmed">
									How did it make you feel?
								</Text>
								<Group justify="space-around">
									<SmileySurround smileyRating={ThreePointSmileyRating.Happy}>
										<IconMoodHappy size={36} />
									</SmileySurround>
									<SmileySurround smileyRating={ThreePointSmileyRating.Neutral}>
										<IconMoodEmpty size={36} />
									</SmileySurround>
									<SmileySurround smileyRating={ThreePointSmileyRating.Sad}>
										<IconMoodSad size={36} />
									</SmileySurround>
								</Group>
							</Stack>
						))
						.exhaustive()}
					<Checkbox label="This review is a spoiler" mt="lg" name="isSpoiler" />
				</Flex>
				{entityToReview.metadataLot === MediaLot.Show ? (
					<Stack gap={4}>
						<Select
							size="xs"
							clearable
							searchable
							limit={50}
							label="Season"
							name="showSeasonNumber"
							value={showSeasonNumber}
							onChange={(v) => setShowSeasonNumber(v || undefined)}
							data={metadataDetails?.showSpecifics?.seasons.map((s) => ({
								label: `${s.seasonNumber}. ${s.name.toString()}`,
								value: s.seasonNumber.toString(),
							}))}
						/>
						<Select
							size="xs"
							clearable
							searchable
							limit={50}
							label="Episode"
							name="showEpisodeNumber"
							value={showEpisodeNumber}
							onChange={(v) => _setShowEpisodeNumber(v || undefined)}
							data={
								metadataDetails?.showSpecifics?.seasons
									.find((s) => s.seasonNumber.toString() === showSeasonNumber)
									?.episodes.map((e) => ({
										label: `${e.episodeNumber}. ${e.name.toString()}`,
										value: e.episodeNumber.toString(),
									})) || []
							}
						/>
					</Stack>
				) : null}
				{entityToReview.metadataLot === MediaLot.Podcast ? (
					<Select
						clearable
						limit={50}
						searchable
						label="Episode"
						name="podcastEpisodeNumber"
						value={podcastEpisodeNumber}
						onChange={(v) => _setPodcastEpisodeNumber(v || undefined)}
						data={metadataDetails?.podcastSpecifics?.episodes.map((se) => ({
							label: se.title.toString(),
							value: se.number.toString(),
						}))}
					/>
				) : null}
				{entityToReview.metadataLot === MediaLot.Anime ? (
					<NumberInput
						label="Episode"
						name="animeEpisodeNumber"
						hideControls
						defaultValue={
							isNumber(
								entityToReview.existingReview?.animeExtraInformation?.episode,
							)
								? entityToReview.existingReview.animeExtraInformation.episode
								: undefined
						}
					/>
				) : null}
				{entityToReview.metadataLot === MediaLot.Manga ? (
					<>
						<Group wrap="nowrap">
							<NumberInput
								label="Chapter"
								name="mangaChapterNumber"
								hideControls
								defaultValue={
									isNumber(
										entityToReview.existingReview?.mangaExtraInformation
											?.chapter,
									)
										? entityToReview.existingReview.mangaExtraInformation
												.chapter
										: undefined
								}
							/>
							<Text ta="center" fw="bold" mt="sm">
								OR
							</Text>
							<NumberInput
								label="Volume"
								name="mangaVolumeNumber"
								hideControls
								defaultValue={
									isNumber(
										entityToReview.existingReview?.mangaExtraInformation
											?.volume,
									)
										? entityToReview.existingReview.mangaExtraInformation.volume
										: undefined
								}
							/>
						</Group>
					</>
				) : null}
				<Textarea
					label="Review"
					name="text"
					description="Markdown is supported"
					autoFocus
					minRows={10}
					maxRows={20}
					autosize
					defaultValue={
						entityToReview.existingReview?.textOriginal ?? undefined
					}
				/>
				<Box>
					<Input.Label>Visibility</Input.Label>
					<SegmentedControl
						fullWidth
						data={Object.entries(Visibility).map(([k, v]) => ({
							label: changeCase(k),
							value: v,
						}))}
						defaultValue={
							entityToReview.existingReview?.visibility ?? Visibility.Public
						}
						name="visibility"
					/>
				</Box>
				<Button mt="md" type="submit" w="100%">
					{entityToReview.existingReview?.id ? "Update" : "Submit"}
				</Button>
			</Stack>
		</Form>
	);
};

type Collection =
	UserCollectionsListQuery["userCollectionsList"]["response"][number];

const AddEntityToCollectionForm = ({
	closeAddEntityToCollectionModal,
}: {
	closeAddEntityToCollectionModal: () => void;
}) => {
	const userDetails = useUserDetails();
	const collections = useNonHiddenUserCollections();
	const events = useApplicationEvents();
	const submit = useConfirmSubmit();
	const [selectedCollection, setSelectedCollection] =
		useState<Collection | null>(null);
	const [ownedOn, setOwnedOn] = useState<Date | null>();
	const [addEntityToCollectionData, _] = useAddEntityToCollection();
	const [numArrayElements, setNumArrayElements] = useCounter(1);

	if (!addEntityToCollectionData) return null;

	const selectData = Object.entries(
		groupBy(collections, (c) =>
			c.creator.id === userDetails.id ? "You" : c.creator.name,
		),
	).map(([g, items]) => ({
		group: g,
		items: items.map((c) => ({
			label: c.name,
			value: c.id.toString(),
			disabled: addEntityToCollectionData.alreadyInCollections?.includes(
				c.id.toString(),
			),
		})),
	}));

	return (
		<Form
			method="POST"
			onSubmit={(e) => {
				submit(e);
				refreshUserMetadataDetails(addEntityToCollectionData.entityId);
				closeAddEntityToCollectionModal();
			}}
			action={withQuery("/actions", { intent: "addEntityToCollection" })}
		>
			<input
				hidden
				readOnly
				name="entityId"
				value={addEntityToCollectionData.entityId}
			/>
			<input
				hidden
				readOnly
				name="entityLot"
				value={addEntityToCollectionData.entityLot}
			/>
			<Stack>
				<Title order={3}>Select collection</Title>
				<Select
					searchable
					data={selectData}
					nothingFoundMessage="Nothing found..."
					value={selectedCollection?.id.toString()}
					onChange={(v) => {
						if (v) {
							const collection = collections.find((c) => c.id === v);
							if (collection) setSelectedCollection(collection);
						}
					}}
				/>
				{selectedCollection ? (
					<>
						<input
							hidden
							readOnly
							name="collectionName"
							value={selectedCollection.name}
						/>
						<input
							hidden
							readOnly
							name="creatorUserId"
							value={selectedCollection.creator.id}
						/>
						{selectedCollection.informationTemplate?.map((template) => (
							<Fragment key={template.name}>
								{match(template.lot)
									.with(CollectionExtraInformationLot.String, () => (
										<TextInput
											name={`information.${template.name}`}
											label={template.name}
											description={template.description}
											required={!!template.required}
											defaultValue={template.defaultValue || undefined}
										/>
									))
									.with(CollectionExtraInformationLot.Number, () => (
										<NumberInput
											name={`information.${template.name}`}
											label={template.name}
											description={template.description}
											required={!!template.required}
											defaultValue={
												template.defaultValue
													? Number(template.defaultValue)
													: undefined
											}
										/>
									))
									.with(CollectionExtraInformationLot.Date, () => (
										<>
											<DateInput
												label={template.name}
												description={template.description}
												required={!!template.required}
												onChange={setOwnedOn}
												value={ownedOn}
												defaultValue={
													template.defaultValue
														? new Date(template.defaultValue)
														: undefined
												}
											/>
											{ownedOn ? (
												<input
													hidden
													readOnly
													name={`information.${template.name}`}
													value={formatDateToNaiveDate(ownedOn)}
												/>
											) : null}
										</>
									))
									.with(CollectionExtraInformationLot.DateTime, () => (
										<DateTimePicker
											name={`information.${template.name}`}
											label={template.name}
											description={template.description}
											required={!!template.required}
										/>
									))
									.with(CollectionExtraInformationLot.StringArray, () => (
										<Input.Wrapper
											label={template.name}
											description={
												<>
													{template.description}
													<Anchor
														ml={4}
														size="xs"
														onClick={() => setNumArrayElements.increment()}
													>
														Add more
													</Anchor>
												</>
											}
											required={!!template.required}
										>
											<Stack gap="xs" mt={4}>
												{Array.from({ length: numArrayElements }).map(
													(_, i) => (
														<Group key={i.toString()}>
															<TextInput
																name={`information.${template.name}[${i}]`}
																flex={1}
																defaultValue={
																	template.defaultValue || undefined
																}
															/>
															<Anchor
																ml="auto"
																size="xs"
																onClick={() => setNumArrayElements.decrement()}
															>
																Remove
															</Anchor>
														</Group>
													),
												)}
											</Stack>
										</Input.Wrapper>
									))
									.exhaustive()}
							</Fragment>
						))}
					</>
				) : null}
				<Button
					disabled={!selectedCollection}
					variant="outline"
					type="submit"
					onClick={() =>
						events.addToCollection(addEntityToCollectionData.entityLot)
					}
				>
					Set
				</Button>
				<Button
					variant="outline"
					color="red"
					onClick={closeAddEntityToCollectionModal}
				>
					Cancel
				</Button>
			</Stack>
		</Form>
	);
};

const CreateMeasurementForm = (props: {
	closeMeasurementModal: () => void;
}) => {
	const userPreferences = useUserPreferences();
	const events = useApplicationEvents();
	const submit = useConfirmSubmit();

	return (
		<Form
			replace
			method="POST"
			action={withQuery($path("/actions"), { intent: "createMeasurement" })}
			onSubmit={(e) => {
				submit(e);
				events.createMeasurement();
				props.closeMeasurementModal();
			}}
		>
			<Stack>
				<DateTimePicker
					label="Timestamp"
					defaultValue={new Date()}
					name="timestamp"
					required
				/>
				<TextInput label="Name" name="name" />
				<SimpleGrid cols={2} style={{ alignItems: "end" }}>
					{Object.keys(userPreferences.fitness.measurements.inbuilt)
						.filter((n) => n !== "custom")
						.filter(
							(n) =>
								// biome-ignore lint/suspicious/noExplicitAny: required
								(userPreferences as any).fitness.measurements.inbuilt[n],
						)
						.map((v) => (
							<NumberInput
								decimalScale={3}
								key={v}
								label={changeCase(snakeCase(v))}
								name={`stats.${v}`}
							/>
						))}
					{userPreferences.fitness.measurements.custom.map(({ name }) => (
						<NumberInput
							key={name}
							label={changeCase(snakeCase(name))}
							name={`stats.custom.${name}`}
						/>
					))}
				</SimpleGrid>
				<Textarea label="Comment" name="comment" />
				<Button type="submit">Submit</Button>
			</Stack>
		</Form>
	);
};
