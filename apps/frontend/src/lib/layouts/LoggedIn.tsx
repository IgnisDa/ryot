import { APP_ROUTES } from "@/lib/constants";
import { useUserPreferences } from "@/lib/hooks/graphql";
import { useCoreDetails } from "@/lib/hooks/graphql";
import { gqlClient } from "@/lib/services/api";
import { getLot } from "@/lib/utilities";
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
	useComputedColorScheme,
	useDirection,
	useMantineColorScheme,
	useMantineTheme,
} from "@mantine/core";
import { upperFirst, useDisclosure, useLocalStorage } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	LogoutUserDocument,
	UpgradeType,
	UserDetailsDocument,
	UserLot,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import {
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
import { IconArchive } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { produce } from "immer";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useEffect } from "react";
import { useCookies } from "react-cookie";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import classes from "./styles.module.css";

const AUTH_COOKIE = "auth";

const Footer = () => {
	const coreDetails = useCoreDetails();
	const [color, text] = match(coreDetails.data?.upgrade)
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

	return coreDetails.data ? (
		<Stack>
			{coreDetails.data.upgrade ? (
				<Text ta="center" c={color}>
					{text}
				</Text>
			) : undefined}
			<Flex gap={80} justify="center">
				<Anchor
					href={`${coreDetails.data.repositoryLink}/releases/v${coreDetails.data.version}`}
					target="_blank"
				>
					<Text c="red" fw="bold">
						v{coreDetails.data.version}
					</Text>
				</Anchor>
				<Anchor href="https://diptesh.me" target="_blank">
					<Text c="indigo" fw="bold">
						{coreDetails.data.authorName}
					</Text>
				</Anchor>
				<Anchor href={coreDetails.data.repositoryLink} target="_blank">
					<Text c="orange" fw="bold">
						Github
					</Text>
				</Anchor>
				<Text c="pink" fw="bold" visibleFrom="md">
					{coreDetails.data.timezone}
				</Text>
			</Flex>
		</Stack>
	) : undefined;
};

function ThemeToggle() {
	const { colorScheme, toggleColorScheme } = useMantineColorScheme();
	const Icon = colorScheme === "dark" ? IconSun : IconMoon;

	return (
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
					{upperFirst(colorScheme === "light" ? "dark" : "light")} theme
				</Text>
			</UnstyledButton>
		</Group>
	);
}

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
		<Link className={classes.link} href={link.link} key={link.label}>
			{link.label}
		</Link>
	));

	return (
		<>
			<UnstyledButton<typeof Link>
				component={!hasLinks ? Link : undefined}
				// biome-ignore lint/suspicious/noExplicitAny: required here
				href={!hasLinks ? href : (undefined as any)}
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

export default function ({ children }: { children: ReactElement }) {
	const [openedLinkGroups, setOpenedLinkGroups] = useLocalStorage<{
		media: boolean;
		fitness: boolean;
		settings: boolean;
	}>({
		key: "openedLinkGroups",
		defaultValue: { fitness: false, media: false, settings: false },
		getInitialValueInEffect: true,
	});
	const theme = useMantineTheme();
	const [opened, { toggle, close }] = useDisclosure(false);
	const colorScheme = useComputedColorScheme("dark");

	const [{ auth }] = useCookies([AUTH_COOKIE]);
	const router = useRouter();
	const coreDetails = useCoreDetails();
	const userDetails = useQuery({
		queryKey: ["userDetails"],
		queryFn: async () => {
			const { userDetails } = await gqlClient.request(UserDetailsDocument);
			return userDetails;
		},
		staleTime: Infinity,
	});

	useEffect(() => {
		(async () => {
			if (
				userDetails.data &&
				userDetails.data.__typename === "UserDetailsError"
			) {
				await logoutUser.mutateAsync();
				notifications.show({
					color: "red",
					title: "Authentication error",
					message: "Your auth token is invalid. Please login again.",
				});
				router.push(APP_ROUTES.auth.login);
			}
		})();
	}, [userDetails.data]);

	const userPreferences = useUserPreferences();

	const mediaLinks = [
		...(Object.entries(userPreferences?.data?.featuresEnabled.media || {})
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
		{ label: "People", href: APP_ROUTES.media.people.list },
		{ label: "Groups", href: APP_ROUTES.media.groups.list },
	].map((link, _index) => ({
		label: link.label,
		link: link.href
			? link.href
			: withQuery(APP_ROUTES.media.list, { lot: link.label.toLowerCase() }),
	}));

	const fitnessLinks = [
		...(Object.entries(userPreferences?.data?.featuresEnabled.fitness || {})
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

	const logoutUser = useMutation({
		mutationFn: async () => {
			try {
				const { logoutUser } = await gqlClient.request(LogoutUserDocument);
				return logoutUser;
			} catch {
				return null;
			}
		},
		onSuccess: (_data) => {
			router.push(APP_ROUTES.auth.login);
		},
	});

	useEffect(() => {
		if (!auth) {
			// This runs twice in dev mode?? Works fine production???
			// https://stackoverflow.com/questions/72238175/why-useeffect-running-twice-and-how-to-handle-it-well-in-react
			notifications.show({
				title: "Authorization error",
				message: "You are not logged in",
				color: "violet",
			});
			router.push(
				withQuery(APP_ROUTES.auth.login, {
					next: router.asPath,
				}),
			);
		}
	}, []);

	useEffect(() => {
		const handleStart = () => {
			close();
		};
		router.events.on("routeChangeComplete", handleStart);
		return () => {
			router.events.off("routeChangeComplete", handleStart);
		};
	}, [router]);

	return userPreferences.data && openedLinkGroups && coreDetails.data ? (
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
					{userPreferences.data.featuresEnabled.media.enabled ? (
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
					{userPreferences.data.featuresEnabled.fitness.enabled ? (
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
								userDetails.data?.__typename === "User" &&
								userDetails.data.lot === UserLot.Admin
									? { label: "Users", link: APP_ROUTES.settings.users }
									: undefined,
								// biome-ignore lint/suspicious/noExplicitAny: required here
							].filter(Boolean) as any
						}
					/>
				</Box>
				<Stack gap="xs">
					<Flex direction="column" justify="center" gap="md">
						<ThemeToggle />
						<UnstyledButton
							mx="auto"
							onClick={() => logoutUser.mutate()}
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
					<Link href={APP_ROUTES.dashboard} style={{ all: "unset" }}>
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
						{children}
					</Box>
					<Box className={classes.shellFooter}>
						<Footer />
					</Box>
				</AppShell.Main>
			</Flex>
		</AppShell>
	) : undefined;
}
