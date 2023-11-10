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
	useMantineColorScheme,
	useMantineTheme,
} from "@mantine/core";
import { upperFirst, useDisclosure, useLocalStorage } from "@mantine/hooks";
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	json,
	redirect,
} from "@remix-run/node";
import { Form, Link, Outlet, useLoaderData } from "@remix-run/react";
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
import { withQuery } from "ufo";
import { getIsAuthenticated } from "~/lib/api.server";
import { APP_ROUTES, LOCAL_STORAGE_KEYS } from "~/lib/constants";
import { colorSchemeCookie } from "~/lib/cookies.server";
import { getCoreDetails, getUserPreferences } from "~/lib/graphql.server";
import { createToastHeaders } from "~/lib/toast.server";
import { getLot } from "~/lib/utilities";
import classes from "~/styles/dashboard.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [isAuthenticated, userDetails] = await getIsAuthenticated(request);
	if (!isAuthenticated)
		return redirect(APP_ROUTES.auth.login, {
			status: 302,
			headers: await createToastHeaders({
				message: "You must be logged in to view this page.",
			}),
		});
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
		{ label: "Groups", href: APP_ROUTES.media.groups.list },
		{ label: "People", href: APP_ROUTES.media.people.list },
		{ label: "Genres", href: APP_ROUTES.media.genres.list },
	].map((link, _index) => ({
		label: link.label,
		link: link.href
			? link.href
			: withQuery(APP_ROUTES.media.list, { lot: link.label.toLowerCase() }),
	}));

	const fitnessLinks = [
		...(Object.entries(userPreferences.featuresEnabled.fitness || {})
			.filter(([v, _]) => v !== "enabled")
			.map(([name, enabled]) => ({ name, enabled }))
			?.filter((f) => f.enabled)
			.map((f) => ({
				label: changeCase(f.name.toString()),
				href: `${
					// biome-ignore lint/suspicious/noExplicitAny: required here
					(APP_ROUTES.fitness as any)[f.name]
				}`,
			})) || []),
		{ label: "Exercises", href: APP_ROUTES.fitness.exercises.list },
	].map((link) => ({
		label: link.label,
		link: link.href,
	}));
	return json({
		mediaLinks,
		fitnessLinks,
		userPreferences,
		userDetails,
		coreDetails,
	});
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const currentColorScheme = await colorSchemeCookie.parse(
		request.headers.get("Cookie") || "",
	);
	const newColorScheme = currentColorScheme === "light" ? "dark" : "light";
	return json(
		{},
		{
			headers: {
				"Set-Cookie": await colorSchemeCookie.serialize(newColorScheme),
			},
		},
	);
};

interface LinksGroupProps {
	// biome-ignore lint/suspicious/noExplicitAny: required here
	icon: React.FC<any>;
	label: string;
	href?: string;
	opened: boolean;
	setOpened: (v: boolean) => void;
	links?: { label: string; link: string }[];
}

export function LinksGroup({
	icon: Icon,
	label,
	href,
	setOpened,
	opened,
	links,
}: LinksGroupProps) {
	const { dir } = useDirection();
	const hasLinks = Array.isArray(links);
	const ChevronIcon = dir === "ltr" ? IconChevronRight : IconChevronLeft;
	const items = (hasLinks ? links : []).map((link) => (
		<Link className={classes.link} to={link.link} key={link.label}>
			{link.label}
		</Link>
	));

	return (
		<>
			<UnstyledButton<typeof Link>
				component={!hasLinks ? Link : undefined}
				// biome-ignore lint/suspicious/noExplicitAny: required here
				to={!hasLinks ? href : (undefined as any)}
				onClick={
					hasLinks
						? () => {
								setOpened(!opened);
						  }
						: undefined
				}
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

export default function Layout() {
	const {
		fitnessLinks,
		mediaLinks,
		userPreferences,
		userDetails,
		coreDetails,
	} = useLoaderData<typeof loader>();
	const [openedLinkGroups, setOpenedLinkGroups] = useLocalStorage<{
		media: boolean;
		fitness: boolean;
		settings: boolean;
	}>({
		key: LOCAL_STORAGE_KEYS.savedOpenedLinkGroups,
		defaultValue: { fitness: false, media: false, settings: false },
		getInitialValueInEffect: true,
	});
	const theme = useMantineTheme();
	const [opened, { toggle, close }] = useDisclosure(false);
	const { colorScheme, toggleColorScheme } = useMantineColorScheme();
	const Icon = colorScheme === "dark" ? IconSun : IconMoon;

	return (
		<AppShell
			w="100%"
			padding={0}
			layout="alt"
			navbar={{
				width: { sm: 200, lg: 220 },
				breakpoint: "sm",
				collapsed: { mobile: !opened },
			}}
		>
			<AppShell.Navbar py="md" px="md">
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
						href={APP_ROUTES.dashboard}
						opened={false}
						setOpened={() => {}}
					/>
					{userPreferences.featuresEnabled.media.enabled ? (
						<LinksGroup
							label="Media"
							icon={IconDeviceSpeaker}
							links={mediaLinks}
							opened={openedLinkGroups.media}
							setOpened={(k) =>
								setOpenedLinkGroups(
									produce(openedLinkGroups, (draft) => {
										draft.media = k;
									}),
								)
							}
						/>
					) : undefined}
					{userPreferences.featuresEnabled.fitness.enabled ? (
						<LinksGroup
							label="Fitness"
							icon={IconStretching}
							opened={openedLinkGroups.fitness}
							setOpened={(k) =>
								setOpenedLinkGroups(
									produce(openedLinkGroups, (draft) => {
										draft.fitness = k;
									}),
								)
							}
							links={fitnessLinks}
						/>
					) : undefined}
					<LinksGroup
						label="Calendar"
						icon={IconCalendar}
						href={APP_ROUTES.calendar}
						opened={false}
						setOpened={() => {}}
					/>
					<LinksGroup
						label="Collections"
						icon={IconArchive}
						href={APP_ROUTES.collections.list}
						opened={false}
						setOpened={() => {}}
					/>
					<LinksGroup
						label="Settings"
						icon={IconSettings}
						opened={openedLinkGroups.settings}
						setOpened={(k) =>
							setOpenedLinkGroups(
								produce(openedLinkGroups, (draft) => {
									draft.settings = k;
								}),
							)
						}
						links={
							[
								{
									label: "Preferences",
									link: APP_ROUTES.settings.preferences,
								},
								{
									label: "Imports and Exports",
									link: APP_ROUTES.settings.imports.new,
								},
								{ label: "Profile", link: APP_ROUTES.settings.profile },
								{
									label: "Integrations",
									link: APP_ROUTES.settings.integrations,
								},
								{
									label: "Notifications",
									link: APP_ROUTES.settings.notifications,
								},
								{
									label: "Miscellaneous",
									link: APP_ROUTES.settings.miscellaneous,
								},
								userDetails.__typename === "User" &&
								userDetails.lot === UserLot.Admin
									? { label: "Users", link: APP_ROUTES.settings.users }
									: undefined,
								// biome-ignore lint/suspicious/noExplicitAny: required here
							].filter(Boolean) as any
						}
					/>
				</Box>
				<Stack gap="xs">
					<Flex direction="column" justify="center" gap="md">
						<Form method="POST" reloadDocument>
							<Group justify="center">
								<UnstyledButton
									aria-label="Toggle theme"
									className={classes.control2}
									onClick={() => toggleColorScheme()}
									title="Ctrl + J"
								>
									<Center className={classes.iconWrapper}>
										<Icon size={16.8} stroke={1.5} />
									</Center>
									<Text size="sm" className={classes.value}>
										{upperFirst(colorScheme === "light" ? "dark" : "light")}{" "}
										theme
									</Text>
								</UnstyledButton>
							</Group>
						</Form>
						<UnstyledButton
							mx="auto"
							// onClick={() => logoutUser.mutate()}
							className={classes.oldLink}
						>
							<Group>
								<IconLogout size={19.2} />
								<Text>Logout</Text>
							</Group>
						</UnstyledButton>
					</Flex>
				</Stack>
			</AppShell.Navbar>
			<Flex direction="column" h="90%">
				<Flex justify="space-between" p="md" hiddenFrom="sm">
					<Link to={APP_ROUTES.dashboard} style={{ all: "unset" }}>
						<Group>
							<Image
								src={
									colorScheme === "dark"
										? "/logo-light.png"
										: "/icon-512x512.png"
								}
								h={40}
								w={40}
								radius="md"
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
						<Footer coreDetails={coreDetails} />
					</Box>
				</AppShell.Main>
			</Flex>
		</AppShell>
	);
}
