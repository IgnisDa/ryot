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
import {
	upperFirst,
	useCounter,
	useDisclosure,
	useLocalStorage,
} from "@mantine/hooks";
import { unstable_defineLoader } from "@remix-run/node";
import {
	Form,
	Link,
	NavLink,
	Outlet,
	isRouteErrorResponse,
	useLoaderData,
	useLocation,
	useNavigate,
	useRouteError,
} from "@remix-run/react";
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
	IconChevronLeft,
	IconChevronRight,
	IconClock,
	IconDeviceSpeaker,
	IconDeviceTv,
	IconHome2,
	IconLogout,
	IconMoon,
	IconPercentage,
	IconSettings,
	IconStretching,
	IconSun,
} from "@tabler/icons-react";
import { produce } from "immer";
import { type FormEvent, useState } from "react";
import { Fragment } from "react/jsx-runtime";
import { $path } from "remix-routes";
import { match } from "ts-pattern";
import { joinURL, withQuery } from "ufo";
import {
	LOGO_IMAGE_URL,
	Verb,
	getLot,
	getVerb,
	queryClient,
	queryFactory,
} from "~/lib/generals";
import {
	useApplicationEvents,
	useConfirmSubmit,
	useMetadataDetails,
	useUserCollections,
	useUserDetails,
	useUserMetadataDetails,
	useUserPreferences,
} from "~/lib/hooks";
import { useMeasurementsDrawerOpen } from "~/lib/state/fitness";
import {
	type UpdateProgressData,
	useAddEntityToCollection,
	useMetadataProgressUpdate,
	useReviewEntity,
} from "~/lib/state/media";
import {
	serverVariables as envData,
	getCachedCoreDetails,
	getCachedUserCollectionsList,
	getCachedUserPreferences,
	isWorkoutActive,
	redirectIfNotAuthenticatedOrUpdated,
} from "~/lib/utilities.server";
import { colorSchemeCookie } from "~/lib/utilities.server";
import "@mantine/dates/styles.css";
import classes from "~/styles/dashboard.module.css";

const discordLink = "https://discord.gg/D9XTg2a7R8";

export const loader = unstable_defineLoader(async ({ request }) => {
	const userDetails = await redirectIfNotAuthenticatedOrUpdated(request);
	const [userPreferences, userCollections, { coreDetails }] = await Promise.all(
		[
			getCachedUserPreferences(request),
			getCachedUserCollectionsList(request),
			getCachedCoreDetails(),
		],
	);

	const mediaLinks = [
		...(Object.entries(userPreferences.featuresEnabled.media || {})
			.filter(([v, _]) => v !== "enabled")
			.filter(([name, _]) => getLot(name) !== undefined)
			.map(([name, enabled]) => {
				// biome-ignore lint/style/noNonNullAssertion: required here
				return { name: getLot(name)!, enabled };
			})
			?.filter((f) => f.enabled)
			.map((f) => {
				return {
					label: changeCase(f.name.toString()),
					href: undefined,
				};
			}) || []),
		userPreferences.featuresEnabled.media.groups
			? {
					label: "Groups",
					href: $path("/media/groups/:action", { action: "list" }),
				}
			: undefined,
		userPreferences.featuresEnabled.media.people
			? {
					label: "People",
					href: $path("/media/people/:action", { action: "list" }),
				}
			: undefined,
		userPreferences.featuresEnabled.media.genres
			? {
					label: "Genres",
					href: $path("/media/genre/list"),
				}
			: undefined,
	]
		.map((link, _index) =>
			link
				? {
						label: link.label,
						link: link.href
							? link.href
							: $path("/media/:action/:lot", {
									action: "list",
									lot: link.label.toLowerCase(),
								}),
					}
				: undefined,
		)
		.filter((link) => link !== undefined);

	const fitnessLinks = [
		...(Object.entries(userPreferences.featuresEnabled.fitness || {})
			.filter(([v, _]) => v !== "enabled")
			.map(([name, enabled]) => ({ name, enabled }))
			?.filter((f) => f.enabled)
			.map((f) => ({
				label: changeCase(f.name.toString()),
				href: joinURL("/fitness", f.name, "list"),
			})) || []),
		{ label: "Exercises", href: $path("/fitness/exercises/list") },
	].map((link) => ({
		label: link.label,
		link: link.href,
	}));

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

	const shouldHaveUmami =
		envData.FRONTEND_UMAMI_SCRIPT_URL &&
		envData.FRONTEND_UMAMI_WEBSITE_ID &&
		!envData.DISABLE_TELEMETRY;

	const workoutInProgress = isWorkoutActive(request);

	return {
		envData,
		mediaLinks,
		userDetails,
		coreDetails,
		fitnessLinks,
		settingsLinks,
		userPreferences,
		shouldHaveUmami,
		userCollections,
		workoutInProgress,
		currentColorScheme,
	};
});

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
	const [parent] = useAutoAnimate();
	const submit = useConfirmSubmit();
	const [openedLinkGroups, setOpenedLinkGroups] = useLocalStorage<
		| {
				media: boolean;
				fitness: boolean;
				settings: boolean;
				collection: boolean;
		  }
		| undefined
	>({
		key: "SavedOpenedLinkGroups",
		defaultValue: {
			fitness: false,
			media: false,
			settings: false,
			collection: false,
		},
		getInitialValueInEffect: true,
	});
	const theme = useMantineTheme();
	const navigate = useNavigate();
	const location = useLocation();
	const [opened, { toggle }] = useDisclosure(false);
	const Icon = loaderData.currentColorScheme === "dark" ? IconSun : IconMoon;
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

	return (
		<>
			{loaderData.workoutInProgress &&
			location.pathname !==
				$path("/fitness/:action", { action: "log-workout" }) ? (
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
								navigate($path("/fitness/:action", { action: "log-workout" }))
							}
						>
							<IconStretching size={32} />
						</ActionIcon>
					</Affix>
				</Tooltip>
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
					width: { sm: 220, lg: 250 },
					breakpoint: "sm",
					collapsed: { mobile: !opened },
				}}
			>
				<AppShell.Navbar py="md" px="md" className={classes.navbar}>
					<Flex justify="end" hiddenFrom="sm">
						<Burger
							opened={opened}
							onClick={toggle}
							color={theme.colors.gray[6]}
						/>
					</Flex>
					<Box component={ScrollArea} style={{ flexGrow: 1 }}>
						<LinksGroup
							label="Dashboard"
							icon={IconHome2}
							href={$path("/")}
							opened={false}
							toggle={toggle}
							setOpened={() => {}}
						/>
						{loaderData.userPreferences.featuresEnabled.media.enabled ? (
							<LinksGroup
								label="Media"
								icon={IconDeviceSpeaker}
								links={loaderData.mediaLinks}
								opened={openedLinkGroups?.media || false}
								toggle={toggle}
								setOpened={(k) =>
									setOpenedLinkGroups(
										produce(openedLinkGroups, (draft) => {
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
								opened={openedLinkGroups?.fitness || false}
								toggle={toggle}
								setOpened={(k) =>
									setOpenedLinkGroups(
										produce(openedLinkGroups, (draft) => {
											if (draft) draft.fitness = k;
										}),
									)
								}
								links={loaderData.fitnessLinks}
							/>
						) : null}
						{loaderData.userPreferences.featuresEnabled.others.calendar ? (
							<LinksGroup
								label="Calendar"
								icon={IconCalendar}
								href={$path("/calendar")}
								opened={false}
								toggle={toggle}
								setOpened={() => {}}
							/>
						) : null}
						{loaderData.userPreferences.featuresEnabled.others.collections ? (
							<LinksGroup
								label="Collections"
								icon={IconArchive}
								href={$path("/collections/list")}
								opened={false}
								toggle={toggle}
								setOpened={() => {}}
							/>
						) : null}
						<LinksGroup
							label="Settings"
							icon={IconSettings}
							opened={openedLinkGroups?.settings || false}
							toggle={toggle}
							setOpened={(k) =>
								setOpenedLinkGroups(
									produce(openedLinkGroups, (draft) => {
										if (draft) draft.settings = k;
									}),
								)
							}
							links={loaderData.settingsLinks}
						/>
					</Box>
					<Flex direction="column" justify="center" gap="md">
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
									src={LOGO_IMAGE_URL}
									h={40}
									w={40}
									radius="md"
									darkHidden
								/>
								<Image
									src="/logo-light.png"
									h={40}
									w={40}
									radius="md"
									lightHidden
								/>
								<Text size="xl" className={classes.logoText}>
									Ryot
								</Text>
							</Group>
						</Link>
						<Burger
							opened={opened}
							onClick={toggle}
							color={theme.colors.gray[6]}
						/>
					</Flex>
					<AppShell.Main py={{ sm: "xl" }}>
						<Box
							mt="md"
							style={{ flexGrow: 1 }}
							pb={40}
							mih="90%"
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
					src={loaderData.envData.FRONTEND_UMAMI_SCRIPT_URL}
					data-website-id={loaderData.envData.FRONTEND_UMAMI_WEBSITE_ID}
					data-domains={loaderData.envData.FRONTEND_UMAMI_DOMAINS}
				/>
			) : null}
		</>
	);
}

interface LinksGroupProps {
	// biome-ignore lint/suspicious/noExplicitAny: required here
	icon: React.FC<any>;
	label: string;
	href?: string;
	opened: boolean;
	setOpened: (v: boolean) => void;
	toggle: () => void;
	links?: Array<{ label: string; link: string }>;
}

const LinksGroup = ({
	icon: Icon,
	label,
	href,
	setOpened,
	toggle,
	opened,
	links,
}: LinksGroupProps) => {
	const { dir } = useDirection();
	const hasLinks = Array.isArray(links);
	const ChevronIcon = dir === "ltr" ? IconChevronRight : IconChevronLeft;
	const allLinks = (hasLinks ? links || [] : []).filter((s) => s !== undefined);
	const items = allLinks.map((link) => (
		<NavLink
			className={classes.link}
			to={link.link}
			key={link.label}
			onClick={toggle}
		>
			{({ isActive }) => (
				<span style={isActive ? { textDecoration: "underline" } : undefined}>
					{link.label}
				</span>
			)}
		</NavLink>
	));

	return (
		<>
			<UnstyledButton<typeof Link>
				component={!hasLinks ? Link : undefined}
				// biome-ignore lint/suspicious/noExplicitAny: required here
				to={!hasLinks ? href : (undefined as any)}
				onClick={() => {
					if (hasLinks) setOpened(!opened);
					else toggle();
				}}
				className={classes.control}
			>
				<Group justify="space-between" gap={0}>
					<Box style={{ display: "flex", alignItems: "center" }}>
						<ThemeIcon variant="light" size={30}>
							<Icon size={17.6} />
						</ThemeIcon>
						<Box ml="md">{label}</Box>
					</Box>
					{hasLinks ? (
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
					) : null}
				</Group>
			</UnstyledButton>
			{hasLinks ? <Collapse in={opened}>{items}</Collapse> : null}
		</>
	);
};

const Footer = () => {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Stack>
			<Flex gap={80} justify="center">
				{!loaderData.coreDetails.isPro ? (
					<Anchor href={loaderData.coreDetails.websiteUrl} target="_blank">
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
					{loaderData.coreDetails.version}
				</Text>
				<Anchor href={loaderData.coreDetails.repositoryLink} target="_blank">
					<Text c="orange" fw="bold">
						Github
					</Text>
				</Anchor>
			</Flex>
		</Stack>
	);
};

const WATCH_TIMES = [
	"Just Right Now",
	"I don't remember",
	"Custom Date",
] as const;

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
		setTimeout(async () => {
			await queryClient.invalidateQueries({
				queryKey: queryFactory.media.userMetadataDetails(metadataId).queryKey,
			});
		}, 1500);
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
		<NewProgressUpdateForm
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
	const userPreferences = useUserPreferences();
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
						value={value}
						onChange={(v) => {
							if (v) setValue(Number(v));
							else setValue(undefined);
						}}
						max={100}
						min={0}
						step={1}
						w="20%"
						hideControls
						rightSection={<IconPercentage size={16} />}
					/>
				</Group>
				{total ? (
					<>
						<Text ta="center" fw="bold">
							OR
						</Text>
						<Flex align="center" gap="xs">
							<NumberInput
								defaultValue={((total || 1) * (value || 1)) / 100}
								onChange={(v) => {
									const value = (Number(v) / (total || 1)) * 100;
									setValue(value);
								}}
								max={total}
								min={0}
								step={1}
								hideControls
								leftSection={updateIcon}
							/>
							<Text>{text}</Text>
						</Flex>
					</>
				) : null}
				<Select
					name="providerWatchedOn"
					defaultValue={inProgress.providerWatchedOn}
					data={userPreferences.general.watchProviders}
					label={`Where did you ${getVerb(Verb.Read, metadataDetails.lot)} it?`}
				/>
				<Button variant="outline" type="submit">
					Update
				</Button>
			</Stack>
		</Form>
	);
};

const NewProgressUpdateForm = ({
	onSubmit,
	metadataDetails,
	metadataToUpdate,
	history,
}: {
	onSubmit: (e: FormEvent<HTMLFormElement>) => void;
	metadataToUpdate: UpdateProgressData;
	metadataDetails: MetadataDetailsQuery["metadataDetails"];
	history: History;
}) => {
	const userPreferences = useUserPreferences();
	const [_, setMetadataToUpdate] = useMetadataProgressUpdate();

	const [selectedDate, setSelectedDate] = useState<Date | null | undefined>(
		new Date(),
	);
	const [watchTime, setWatchTime] =
		useState<(typeof WATCH_TIMES)[number]>("Just Right Now");
	const lastProviderWatchedOn = history[0]?.providerWatchedOn;

	return (
		<Form
			method="POST"
			onSubmit={onSubmit}
			action={withQuery($path("/actions"), { intent: "progressUpdate" })}
		>
			{[
				...Object.entries(metadataToUpdate),
				["metadataLot", metadataDetails.lot],
			].map(([k, v]) => (
				<Fragment key={k}>
					{typeof v !== "undefined" ? (
						<input hidden readOnly name={k} value={v?.toString()} />
					) : null}
				</Fragment>
			))}
			<Stack>
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
												draft.mangaChapterNumber = Number(e);
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
												draft.mangaVolumeNumber = Number(e);
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
					label={`When did you ${getVerb(Verb.Read, metadataDetails.lot)} it?`}
					data={WATCH_TIMES}
					value={watchTime}
					onChange={(v) => {
						setWatchTime(v as typeof watchTime);
						match(v)
							.with(WATCH_TIMES[0], () => setSelectedDate(new Date()))
							.with(WATCH_TIMES[1], () => setSelectedDate(null))
							.with(WATCH_TIMES[2], () => setSelectedDate(null));
					}}
				/>
				{watchTime === WATCH_TIMES[2] ? (
					<DatePickerInput
						required
						clearable
						dropdownType="modal"
						maxDate={new Date()}
						onChange={setSelectedDate}
						label="Enter exact date"
					/>
				) : null}
				<Select
					name="providerWatchedOn"
					defaultValue={lastProviderWatchedOn}
					data={userPreferences.general.watchProviders}
					label={`Where did you ${getVerb(Verb.Read, metadataDetails.lot)} it?`}
				/>
				{selectedDate ? (
					<input
						hidden
						readOnly
						name="date"
						value={formatDateToNaiveDate(selectedDate)}
					/>
				) : null}
				<Button
					type="submit"
					variant="outline"
					disabled={selectedDate === undefined}
				>
					Submit
				</Button>
			</Stack>
		</Form>
	);
};

const ReviewEntityForm = ({
	closeReviewEntityModal,
}: {
	closeReviewEntityModal: () => void;
}) => {
	const userPreferences = useUserPreferences();
	const events = useApplicationEvents();
	const submit = useConfirmSubmit();
	const [entityToReview] = useReviewEntity();

	if (!entityToReview) return null;

	return (
		<Form
			replace
			method="POST"
			action={withQuery("/actions", { intent: "performReviewAction" })}
			onSubmit={async (e) => {
				submit(e);
				await queryClient.invalidateQueries({
					queryKey: queryFactory.media.userMetadataDetails(
						entityToReview.entityId,
					).queryKey,
				});
				events.postReview(entityToReview.entityTitle);
				closeReviewEntityModal();
			}}
		>
			<input
				hidden
				name={match(entityToReview.entityLot)
					.with(EntityLot.Metadata, () => "metadataId")
					.with(EntityLot.MetadataGroup, () => "metadataGroupId")
					.with(EntityLot.Person, () => "personId")
					.with(EntityLot.Collection, () => "collection")
					.with(EntityLot.Exercise, () => "exerciseId")
					.run()}
				value={entityToReview.entityId}
				readOnly
			/>
			{entityToReview.existingReview?.id ? (
				<input
					hidden
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
									defaultValue={
										entityToReview.existingReview?.rating
											? Number(entityToReview.existingReview.rating)
											: undefined
									}
									fractions={2}
								/>
							</Flex>
						))
						.with(UserReviewScale.OutOfHundred, () => (
							<NumberInput
								label="Rating"
								name="rating"
								min={0}
								max={100}
								step={1}
								w="40%"
								hideControls
								rightSection={<IconPercentage size={16} />}
								defaultValue={
									entityToReview.existingReview?.rating
										? Number(entityToReview.existingReview.rating)
										: undefined
								}
							/>
						))
						.exhaustive()}
					<Checkbox label="This review is a spoiler" mt="lg" name="isSpoiler" />
				</Flex>
				{entityToReview.metadataLot === MediaLot.Show ? (
					<Flex gap="md">
						<NumberInput
							label="Season"
							name="showSeasonNumber"
							hideControls
							defaultValue={
								isNumber(
									entityToReview.existingReview?.showExtraInformation?.season,
								)
									? entityToReview.existingReview.showExtraInformation.season
									: undefined
							}
						/>
						<NumberInput
							label="Episode"
							name="showEpisodeNumber"
							hideControls
							defaultValue={
								isNumber(
									entityToReview.existingReview?.showExtraInformation?.episode,
								)
									? entityToReview.existingReview.showExtraInformation.episode
									: undefined
							}
						/>
					</Flex>
				) : null}
				{entityToReview.metadataLot === MediaLot.Podcast ? (
					<NumberInput
						label="Episode"
						name="podcastEpisodeNumber"
						hideControls
						defaultValue={
							isNumber(
								entityToReview.existingReview?.podcastExtraInformation?.episode,
							)
								? entityToReview.existingReview.podcastExtraInformation.episode
								: undefined
						}
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

type Collection = UserCollectionsListQuery["userCollectionsList"][number];

const AddEntityToCollectionForm = ({
	closeAddEntityToCollectionModal,
}: {
	closeAddEntityToCollectionModal: () => void;
}) => {
	const userDetails = useUserDetails();
	const collections = useUserCollections();
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
				closeAddEntityToCollectionModal();
			}}
			action={withQuery("/actions", { intent: "addEntityToCollection" })}
		>
			<input
				readOnly
				hidden
				name="entityId"
				value={addEntityToCollectionData.entityId}
			/>
			<input
				readOnly
				hidden
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
							readOnly
							hidden
							name="collectionName"
							value={selectedCollection.name}
						/>
						<input
							readOnly
							hidden
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
											<input
												readOnly
												hidden
												name={`information.${template.name}`}
												value={
													ownedOn ? formatDateToNaiveDate(ownedOn) : undefined
												}
											/>
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
