import { $path } from "@ignisda/remix-routes";
import {
	Anchor,
	AppShell,
	Box,
	Burger,
	Center,
	Collapse,
	Flex,
	Group,
	Image,
	ScrollArea,
	Stack,
	Text,
	ThemeIcon,
	UnstyledButton,
	useDirection,
	useMantineTheme,
} from "@mantine/core";
import { upperFirst, useDisclosure, useLocalStorage } from "@mantine/hooks";
import { LoaderFunctionArgs, json } from "@remix-run/node";
import { Form, Link, NavLink, Outlet, useLoaderData } from "@remix-run/react";
import {
	CoreDetails,
	UpgradeType,
	UserLot,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import {
	IconArchive,
	IconCalendar,
	IconChevronLeft,
	IconChevronRight,
	IconDeviceSpeaker,
	IconHome2,
	IconLogout,
	IconMoon,
	IconSettings,
	IconStretching,
	IconSun,
} from "@tabler/icons-react";
import { produce } from "immer";
import { match } from "ts-pattern";
import { joinURL } from "ufo";
import { redirectIfNotAuthenticated } from "~/lib/api.server";
import { colorSchemeCookie } from "~/lib/cookies.server";
import { LOCAL_STORAGE_KEYS, getLot } from "~/lib/generals";
import { getCoreDetails, getUserPreferences } from "~/lib/graphql.server";
import classes from "~/styles/dashboard.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const userDetails = await redirectIfNotAuthenticated(request);
	const userPreferences = await getUserPreferences(request);
	const coreDetails = await getCoreDetails();

	const mediaLinks = [
		...(Object.entries(userPreferences.featuresEnabled.media || {})
			.filter(([v, _]) => v !== "enabled")
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
		{ label: "Groups", href: $path("/media/groups/list") },
		{ label: "People", href: $path("/media/people/list") },
		{ label: "Genres", href: $path("/media/genre/list") },
	].map((link, _index) => ({
		label: link.label,
		link: link.href
			? link.href
			: $path("/media/:action/:lot", {
					action: "list",
					lot: link.label.toLowerCase(),
			  }),
	}));

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
		userDetails.__typename === "User" && userDetails.lot === UserLot.Admin
			? { label: "Users", link: $path("/settings/users") }
			: undefined,
	];

	const collectionLinks = [
		{ label: "Yours", link: $path("/collections/list/yours") },
		{
			label: "Public",
			link: $path("/collections/list/public"),
		},
	];

	const currentColorScheme = await colorSchemeCookie.parse(
		request.headers.get("Cookie") || "",
	);
	return json({
		mediaLinks,
		fitnessLinks,
		userPreferences: {
			media: userPreferences.featuresEnabled.media,
			fitness: userPreferences.featuresEnabled.fitness,
		},
		userDetails,
		coreDetails,
		currentColorScheme,
		settingsLinks,
		collectionLinks,
	});
};

export default function Layout() {
	const loaderData = useLoaderData<typeof loader>();
	const [openedLinkGroups, setOpenedLinkGroups] = useLocalStorage<
		| {
				media: boolean;
				fitness: boolean;
				settings: boolean;
				collection: boolean;
		  }
		| undefined
	>({
		key: LOCAL_STORAGE_KEYS.savedOpenedLinkGroups,
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

	return (
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
					{loaderData.userPreferences.media.enabled ? (
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
					) : undefined}
					{loaderData.userPreferences.fitness.enabled ? (
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
					) : undefined}
					<LinksGroup
						label="Calendar"
						icon={IconCalendar}
						href={$path("/calendar")}
						opened={false}
						toggle={toggle}
						setOpened={() => {}}
					/>
					<LinksGroup
						label="Collections"
						icon={IconArchive}
						opened={openedLinkGroups?.collection || false}
						toggle={toggle}
						setOpened={(k) => {
							setOpenedLinkGroups(
								produce(openedLinkGroups, (draft) => {
									if (draft) draft.collection = k;
								}),
							);
						}}
						links={loaderData.collectionLinks}
					/>
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
						<Form method="POST" action="/actions?intent=toggleColorScheme">
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
								src="/icon-512x512.png"
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
					<Box mt="md" style={{ flexGrow: 1 }} pb={40} mih="90%">
						<Outlet />
					</Box>
					<Box className={classes.shellFooter}>
						<Footer coreDetails={loaderData.coreDetails} />
					</Box>
				</AppShell.Main>
			</Flex>
		</AppShell>
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
	links?: { label: string; link: string }[];
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
	const allLinks = (hasLinks ? links || [] : []).filter(Boolean);
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
					) : undefined}
				</Group>
			</UnstyledButton>
			{hasLinks ? <Collapse in={opened}>{items}</Collapse> : undefined}
		</>
	);
}

const Footer = (props: { coreDetails: CoreDetails }) => {
	const [color, text] = match(props.coreDetails.upgrade)
		.with(undefined, null, () => [undefined, undefined])
		.with(
			UpgradeType.Minor,
			() => ["blue", "There is an update available."] as const,
		)
		.with(
			UpgradeType.Major,
			() =>
				[
					"red",
					<>
						There is a major upgrade, please follow the{" "}
						<Anchor
							href="https://ignisda.github.io/ryot/migration.html"
							target="_blank"
						>
							migration
						</Anchor>{" "}
						docs.
					</>,
				] as const,
		)
		.exhaustive();

	return (
		<Stack>
			{props.coreDetails.upgrade ? (
				<Text ta="center" c={color}>
					{text}
				</Text>
			) : undefined}
			<Flex gap={80} justify="center">
				<Anchor
					href={`${props.coreDetails.repositoryLink}/releases/v${props.coreDetails.version}`}
					target="_blank"
				>
					<Text c="red" fw="bold">
						v{props.coreDetails.version}
					</Text>
				</Anchor>
				<Anchor href="https://diptesh.me" target="_blank">
					<Text c="indigo" fw="bold">
						{props.coreDetails.authorName}
					</Text>
				</Anchor>
				<Text c="pink" fw="bold" visibleFrom="md">
					{props.coreDetails.timezone}
				</Text>
				<Anchor href={props.coreDetails.repositoryLink} target="_blank">
					<Text c="orange" fw="bold">
						Github
					</Text>
				</Anchor>
			</Flex>
		</Stack>
	);
};
