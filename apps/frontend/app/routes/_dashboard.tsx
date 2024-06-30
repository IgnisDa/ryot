import { useAutoAnimate } from "@formkit/auto-animate/react";
import { $path } from "@ignisda/remix-routes";
import {
	Alert,
	Anchor,
	AppShell,
	Box,
	Burger,
	Button,
	Center,
	Checkbox,
	Collapse,
	Flex,
	Group,
	Image,
	Loader,
	Modal,
	NumberInput,
	ScrollArea,
	Select,
	Slider,
	Stack,
	Text,
	ThemeIcon,
	Title,
	UnstyledButton,
	useDirection,
	useMantineTheme,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { upperFirst, useDisclosure, useLocalStorage } from "@mantine/hooks";
import { unstable_defineLoader } from "@remix-run/node";
import { Form, Link, NavLink, Outlet, useLoaderData } from "@remix-run/react";
import {
	type CoreDetails,
	MediaLot,
	type MetadataDetailsQuery,
	UserLot,
	type UserMetadataDetailsQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, formatDateToNaiveDate } from "@ryot/ts-utils";
import {
	IconAlertCircle,
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
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Fragment } from "react/jsx-runtime";
import { match } from "ts-pattern";
import { joinURL, withQuery } from "ufo";
import { HiddenLocationInput } from "~/components/common";
import events from "~/lib/events";
import {
	CORE_DETAILS_COOKIE_NAME,
	LOGO_IMAGE_URL,
	Verb,
	getLot,
	getVerb,
	queryClient,
} from "~/lib/generals";
import {
	useMetadataDetails,
	useUserMetadataDetails,
	useUserPreferences,
} from "~/lib/hooks";
import {
	type UpdateProgressData,
	useMetadataProgressUpdate,
} from "~/lib/media";
import {
	serverVariables as envData,
	getCookieValue,
	getUserCollectionsList,
	getUserPreferences,
	redirectIfNotAuthenticatedOrUpdated,
} from "~/lib/utilities.server";
import { colorSchemeCookie } from "~/lib/utilities.server";
import classes from "~/styles/dashboard.module.css";

export const loader = unstable_defineLoader(async ({ request }) => {
	const userDetails = await redirectIfNotAuthenticatedOrUpdated(request);
	const [userPreferences, userCollections] = await Promise.all([
		getUserPreferences(request),
		getUserCollectionsList(request),
	]);
	const details = getCookieValue(request, CORE_DETAILS_COOKIE_NAME);
	const coreDetails = JSON.parse(details) as CoreDetails;

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
		{ label: "Profile", link: $path("/settings/profile") },
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
		!envData.DISABLE_TELEMETRY &&
		!userDetails.isDemo;

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
		currentColorScheme,
	};
});

export default function Layout() {
	const loaderData = useLoaderData<typeof loader>();
	const [parent] = useAutoAnimate();
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
	const [opened, { toggle }] = useDisclosure(false);
	const Icon = loaderData.currentColorScheme === "dark" ? IconSun : IconMoon;
	const [metadataToUpdate, setMetadataToUpdate] = useMetadataProgressUpdate();
	const closeMetadataProgressUpdateModal = () => setMetadataToUpdate(null);

	return (
		<>
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
					<Stack gap="xs">
						<Flex direction="column" justify="center" gap="md">
							<Form method="post" action="/actions?intent=toggleColorScheme">
								<HiddenLocationInput />
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
								method="post"
								action="/actions?intent=logout"
								style={{ display: "flex" }}
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
					</Stack>
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

function LinksGroup({
	icon: Icon,
	label,
	href,
	setOpened,
	toggle,
	opened,
	links,
}: LinksGroupProps) {
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
}

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
				<Anchor href="https://diptesh.me" target="_blank">
					<Text c="indigo" fw="bold">
						{loaderData.coreDetails.authorName}
					</Text>
				</Anchor>
				<Text c="grape" fw="bold" visibleFrom="md">
					{loaderData.coreDetails.timezone}
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
	const [metadataToUpdate, setMetadataToUpdate] = useMetadataProgressUpdate();

	const { data: metadataDetails } = useMetadataDetails(
		metadataToUpdate?.metadataId,
	);
	const { data: userMetadataDetails } = useUserMetadataDetails(
		metadataToUpdate?.metadataId,
	);

	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		if (metadataToUpdate?.determineNext && metadataDetails) {
			flushSync(() => {
				setMetadataToUpdate(
					produce(metadataToUpdate, (draft) => {
						const nextEntry = userMetadataDetails?.nextEntry;
						if (nextEntry) {
							match(metadataDetails.lot)
								.with(MediaLot.Show, () => {
									draft.showEpisodeNumber = nextEntry.episode;
									draft.showSeasonNumber = nextEntry.season;
								})
								.with(MediaLot.Podcast, () => {
									draft.podcastEpisodeNumber = nextEntry.episode;
								})
								.otherwise(() => undefined);
						}
					}),
				);
			});
		}
		setIsLoading(false);
	}, [metadataToUpdate, userMetadataDetails, metadataDetails]);

	if (
		!metadataDetails ||
		!metadataToUpdate ||
		!userMetadataDetails ||
		isLoading
	)
		return (
			<Center p="lg">
				<Loader type="dots" />
			</Center>
		);

	const onSubmit = () => {
		queryClient.removeQueries({
			queryKey: ["userMetadataDetails", metadataToUpdate.metadataId],
		});
		events.updateProgress(metadataDetails.title);
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
		/>
	);
};

type InProgress = UserMetadataDetailsQuery["userMetadataDetails"]["inProgress"];

const MetadataInProgressUpdateForm = ({
	onSubmit,
	inProgress,
	metadataDetails,
	metadataToUpdate,
}: {
	onSubmit: () => void;
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
			method="post"
			onSubmit={onSubmit}
			action={withQuery($path("/actions"), {
				intent: "individualProgressUpdate",
			})}
		>
			<HiddenLocationInput hash={metadataToUpdate.pageFragment} />
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
			<Stack>
				<Title order={3}>Set progress</Title>
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
					data={userPreferences.general.watchProviders}
					label={`Where did you ${getVerb(Verb.Read, metadataDetails.lot)} it?`}
					name="providerWatchedOn"
					defaultValue={inProgress.providerWatchedOn}
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
}: {
	onSubmit: () => void;
	metadataToUpdate: UpdateProgressData;
	metadataDetails: MetadataDetailsQuery["metadataDetails"];
}) => {
	const userPreferences = useUserPreferences();
	const [_, setMetadataToUpdate] = useMetadataProgressUpdate();

	const [selectedDate, setSelectedDate] = useState<Date | null | undefined>(
		new Date(),
	);
	const [watchTime, setWatchTime] =
		useState<(typeof WATCH_TIMES)[number]>("Just Right Now");
	const [animeEpisodeNumber, setAnimeEpisodeNumber] = useState<
		string | undefined
	>(undefined);
	const [mangaChapterNumber, setMangaChapterNumber] = useState<
		string | undefined
	>(undefined);
	const [mangaVolumeNumber, setMangaVolumeNumber] = useState<
		string | undefined
	>(undefined);

	return (
		<Form
			method="post"
			onSubmit={onSubmit}
			action={withQuery($path("/actions"), { intent: "progressUpdate" })}
		>
			{[
				...Object.entries(metadataToUpdate),
				["metadataLot", metadataDetails.lot],
			].map(([k, v]) => (
				<Fragment key={k}>
					{typeof v !== "undefined" ? (
						<input hidden name={k} defaultValue={v?.toString()} />
					) : null}
				</Fragment>
			))}
			<HiddenLocationInput hash={metadataToUpdate.pageFragment} />
			<Stack>
				<Title order={3}>Update progress</Title>
				{metadataDetails.lot === MediaLot.Anime ? (
					<>
						<NumberInput
							label="Episode"
							name="animeEpisodeNumber"
							description="Leaving this empty will mark the whole anime as watched"
							hideControls
							value={animeEpisodeNumber}
							onChange={(e) => setAnimeEpisodeNumber(e.toString())}
						/>
						{animeEpisodeNumber ? (
							<Checkbox
								label="Mark all episodes before this as watched"
								name="animeAllEpisodesBefore"
							/>
						) : null}
					</>
				) : null}
				{metadataDetails.lot === MediaLot.Manga ? (
					<>
						<Box>
							<Text c="dimmed" size="sm">
								Leaving the following empty will mark the whole manga as watched
							</Text>
							<Group wrap="nowrap">
								<NumberInput
									label="Chapter"
									name="mangaChapterNumber"
									hideControls
									value={mangaChapterNumber}
									onChange={(e) => setMangaChapterNumber(e.toString())}
								/>
								<Text ta="center" fw="bold" mt="sm">
									OR
								</Text>
								<NumberInput
									label="Volume"
									name="mangaVolumeNumber"
									hideControls
									value={mangaVolumeNumber}
									onChange={(e) => setMangaVolumeNumber(e.toString())}
								/>
							</Group>
						</Box>
						{mangaChapterNumber ? (
							<Checkbox
								label="Mark all chapters before this as watched"
								name="mangaAllChaptersBefore"
							/>
						) : null}
					</>
				) : null}
				{metadataDetails.lot === MediaLot.Show ? (
					<>
						<input
							hidden
							name="showSpecifics"
							defaultValue={JSON.stringify(
								metadataDetails.showSpecifics?.seasons.map((s) => ({
									seasonNumber: s.seasonNumber,
									episodes: s.episodes.map((e) => e.episodeNumber),
								})),
							)}
						/>
						{metadataToUpdate.onlySeason || metadataToUpdate.completeShow ? (
							<Alert color="yellow" icon={<IconAlertCircle />}>
								{metadataToUpdate.onlySeason
									? `This will mark all episodes of season ${metadataToUpdate.showSeasonNumber} as seen`
									: metadataToUpdate.completeShow
										? "This will mark all episodes for this show as seen"
										: null}
							</Alert>
						) : null}
						{!metadataToUpdate.completeShow ? (
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
							/>
						) : null}
						{metadataToUpdate?.onlySeason ? (
							<Checkbox
								label="Mark all seasons before this as seen"
								name="showAllSeasonsBefore"
							/>
						) : null}
						{!metadataToUpdate.onlySeason &&
						typeof metadataToUpdate.showSeasonNumber !== "undefined" ? (
							<Select
								label="Episode"
								required
								data={
									metadataDetails.showSpecifics?.seasons
										.find(
											(s) =>
												s.seasonNumber ===
												Number(metadataToUpdate.showSeasonNumber),
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
							/>
						) : null}
					</>
				) : null}
				{metadataDetails.lot === MediaLot.Podcast ? (
					<>
						<input
							hidden
							name="podcastSpecifics"
							defaultValue={JSON.stringify(
								metadataDetails.podcastSpecifics?.episodes.map((e) => ({
									episodeNumber: e.number,
								})),
							)}
						/>
						{metadataToUpdate.completePodcast ? (
							<Alert color="yellow" icon={<IconAlertCircle />}>
								This will mark all episodes for this podcast as seen
							</Alert>
						) : (
							<>
								<Title order={6}>Select episode</Title>
								<Select
									required
									label="Episode"
									data={metadataDetails.podcastSpecifics?.episodes.map(
										(se) => ({
											label: se.title.toString(),
											value: se.number.toString(),
										}),
									)}
									value={metadataToUpdate.podcastEpisodeNumber?.toString()}
									onChange={(v) => {
										setMetadataToUpdate(
											produce(metadataToUpdate, (draft) => {
												draft.podcastEpisodeNumber = Number(v);
											}),
										);
									}}
									searchable
									limit={10}
								/>
							</>
						)}
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
						label="Enter exact date"
						dropdownType="modal"
						maxDate={new Date()}
						onChange={setSelectedDate}
						clearable
					/>
				) : null}
				<Select
					label={`Where did you ${getVerb(Verb.Read, metadataDetails.lot)} it?`}
					data={userPreferences.general.watchProviders}
					name="providerWatchedOn"
				/>
				<Button
					variant="outline"
					disabled={selectedDate === undefined}
					type="submit"
					name="date"
					value={selectedDate ? formatDateToNaiveDate(selectedDate) : undefined}
				>
					Submit
				</Button>
			</Stack>
		</Form>
	);
};
