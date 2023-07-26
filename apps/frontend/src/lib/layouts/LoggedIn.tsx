import { useUserPreferences } from "../hooks/graphql";
import { ROUTES } from "@/lib/constants";
import { useCoreDetails } from "@/lib/hooks/graphql";
import { gqlClient } from "@/lib/services/api";
import { getLot } from "@/lib/utilities";
import {
	Anchor,
	AppShell,
	Box,
	Burger,
	Collapse,
	Flex,
	Group,
	MediaQuery,
	Navbar,
	Text,
	ThemeIcon,
	UnstyledButton,
	createStyles,
	rem,
	useMantineTheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	LogoutUserDocument,
	UserDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/utilities";
import {
	IconChevronLeft,
	IconChevronRight,
	IconDeviceSpeaker,
	IconHome2,
	IconLogout,
	IconSettings,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useEffect, useState } from "react";
import { useCookies } from "react-cookie";

const AUTH_COOKIE = "auth";

const Footer = () => {
	const coreDetails = useCoreDetails();

	return coreDetails.data ? (
		<Flex gap={80} justify={"center"}>
			<Anchor
				href={`${coreDetails.data.repositoryLink}/releases/v${coreDetails.data.version}`}
				target="_blank"
			>
				<Text color="red" weight={"bold"}>
					v{coreDetails.data.version}
				</Text>
			</Anchor>
			<Anchor href="https://diptesh.me" target="_blank">
				<Text color="indigo" weight={"bold"}>
					{coreDetails.data.authorName}
				</Text>
			</Anchor>
			<Anchor href={coreDetails.data.repositoryLink} target="_blank">
				<Text color="orange" weight={"bold"}>
					Github
				</Text>
			</Anchor>
		</Flex>
	) : null;
};

const useStyles = createStyles((theme) => ({
	control: {
		fontWeight: 500,
		display: "block",
		width: "100%",
		padding: `${theme.spacing.xs} ${theme.spacing.md}`,
		color: theme.colorScheme === "dark" ? theme.colors.dark[0] : theme.black,
		fontSize: theme.fontSizes.sm,
		"&:hover": {
			backgroundColor:
				theme.colorScheme === "dark"
					? theme.colors.dark[7]
					: theme.colors.gray[0],
			color: theme.colorScheme === "dark" ? theme.white : theme.black,
		},
	},
	link: {
		fontWeight: 500,
		display: "block",
		textDecoration: "none",
		padding: `${theme.spacing.xs} ${theme.spacing.md}`,
		paddingLeft: rem(31),
		marginLeft: rem(30),
		fontSize: theme.fontSizes.sm,
		color:
			theme.colorScheme === "dark"
				? theme.colors.dark[0]
				: theme.colors.gray[7],
		borderLeft: `${rem(1)} solid ${
			theme.colorScheme === "dark" ? theme.colors.dark[4] : theme.colors.gray[3]
		}`,

		"&:hover": {
			backgroundColor:
				theme.colorScheme === "dark"
					? theme.colors.dark[7]
					: theme.colors.gray[0],
			color: theme.colorScheme === "dark" ? theme.white : theme.black,
		},
	},
	chevron: {
		transition: "transform 200ms ease",
	},
	oldLink: {
		color: theme.colors.dark[0],
	},
}));

interface LinksGroupProps {
	icon: React.FC<any>;
	label: string;
	onClick: () => void;
	href?: string;
	initiallyOpened?: boolean;
	links?: { label: string; link: string }[];
}

export function LinksGroup({
	icon: Icon,
	label,
	href,
	initiallyOpened,
	links,
	onClick,
}: LinksGroupProps) {
	const { classes, theme } = useStyles();
	const router = useRouter();
	const hasLinks = Array.isArray(links);
	const [opened, setOpened] = useState(initiallyOpened || false);
	const ChevronIcon = theme.dir === "ltr" ? IconChevronRight : IconChevronLeft;
	const items = (hasLinks ? links : []).map((link) => (
		<Link
			className={classes.link}
			href={link.link}
			key={link.label}
			onClick={onClick}
		>
			{link.label}
		</Link>
	));

	return (
		<>
			<UnstyledButton
				onClick={() => {
					if (href) router.push(href);
					else setOpened((o) => !o);
					if (onClick) onClick();
				}}
				className={classes.control}
			>
				<Group position="apart" spacing={0}>
					<Box sx={{ display: "flex", alignItems: "center" }}>
						<ThemeIcon variant="light" size={30}>
							<Icon size="1.1rem" />
						</ThemeIcon>
						<Box ml="md">{label}</Box>
					</Box>
					{hasLinks && (
						<ChevronIcon
							className={classes.chevron}
							size="1rem"
							stroke={1.5}
							style={{
								transform: opened
									? `rotate(${theme.dir === "rtl" ? -90 : 90}deg)`
									: "none",
							}}
						/>
					)}
				</Group>
			</UnstyledButton>
			{hasLinks ? <Collapse in={opened}>{items}</Collapse> : null}
		</>
	);
}

export default function ({ children }: { children: ReactElement }) {
	const theme = useMantineTheme();
	const [opened, { toggle, close }] = useDisclosure(false);
	const { classes, cx } = useStyles();

	const [{ auth }] = useCookies([AUTH_COOKIE]);
	const router = useRouter();
	useQuery({
		queryKey: ["userDetails"],
		queryFn: async () => {
			const { userDetails } = await gqlClient.request(UserDetailsDocument);
			return userDetails;
		},
		onSuccess: async (data) => {
			if (data.__typename === "UserDetailsError") {
				await logoutUser.mutateAsync();
				notifications.show({
					color: "red",
					title: "Authentication error",
					message: "Your auth token is invalid. Please login again.",
				});
				router.push(ROUTES.auth.login);
			}
		},
		staleTime: Infinity,
	});
	const userPrefs = useUserPreferences();

	const links = [
		{ icon: IconHome2, label: "Home", href: ROUTES.dashboard },
		...(Object.entries(userPrefs?.data?.featuresEnabled || {})
			.map(([name, enabled]) => ({ name: getLot(name)!, enabled }))
			?.filter((f) => f.enabled)
			.map((f) => ({
				label: changeCase(f.name.toString()),
				href: undefined,
			})) || []),
		{ label: "Collections", href: ROUTES.collections.list },
	].map((link, _index) => ({
		label: link.label,
		link: link.href
			? link.href
			: `${ROUTES.list}?lot=${link.label.toLowerCase()}`,
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
		onSuccess: (data) => {
			if (data) {
				notifications.show({
					title: "Success",
					message: "You were logged out successfully",
					color: "green",
				});
			}
			router.push(ROUTES.auth.login);
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
			router.push(ROUTES.auth.login);
		}
	}, []);

	return (
		<AppShell
			my={{ sm: "xl" }}
			fixed
			layout="alt"
			navbarOffsetBreakpoint="sm"
			asideOffsetBreakpoint="sm"
			navbar={
				<Navbar
					py="md"
					px="md"
					hiddenBreakpoint="sm"
					hidden={!opened}
					width={{ sm: 200, lg: 220 }}
				>
					<MediaQuery largerThan="sm" styles={{ display: "none" }}>
						<Flex justify={"end"}>
							<Burger
								opened={opened}
								onClick={toggle}
								color={theme.colors.gray[6]}
							/>
						</Flex>
					</MediaQuery>
					<Navbar.Section grow>
						<Box>
							<LinksGroup
								label="Media"
								icon={IconDeviceSpeaker}
								links={links}
								onClick={close}
							/>
							<LinksGroup
								label="Settings"
								icon={IconSettings}
								href={ROUTES.settings}
								onClick={close}
							/>
						</Box>
					</Navbar.Section>
					<Navbar.Section>
						<Box
							style={{
								padding: `${theme.spacing.xs} ${theme.spacing.md}`,
							}}
						>
							<UnstyledButton
								onClick={() => logoutUser.mutate()}
								className={cx(classes.oldLink)}
							>
								<Group position="apart">
									<IconLogout size="1.2rem" />
									<Text>Logout</Text>
								</Group>
							</UnstyledButton>
						</Box>
					</Navbar.Section>
				</Navbar>
			}
		>
			<MediaQuery largerThan="sm" styles={{ display: "none" }}>
				<Flex justify={"end"}>
					<Burger
						opened={opened}
						onClick={toggle}
						color={theme.colors.gray[6]}
					/>
				</Flex>
			</MediaQuery>
			<Box mt="md">{children}</Box>
			<Box mt={36}>
				<Footer />
			</Box>
		</AppShell>
	);
}
