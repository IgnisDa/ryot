import { useUserPreferences } from "../hooks/graphql";
import { Footer } from "./Basic";
import { ROUTES } from "@/lib/constants";
import { gqlClient } from "@/lib/services/api";
import { getLot, getMetadataIcon } from "@/lib/utilities";
import {
	AppShell,
	Box,
	Burger,
	Flex,
	Footer as MantineFooter,
	Header,
	MediaQuery,
	Navbar,
	Text,
	Tooltip,
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
	IconArchive,
	IconHome2,
	IconLogout,
	IconSettings,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useEffect } from "react";
import { useCookies } from "react-cookie";

const useStyles = createStyles((theme) => ({
	link: {
		width: rem(50),
		height: rem(50),
		borderRadius: theme.radius.md,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		color: theme.colors.dark[0],
		"&:hover": {
			backgroundColor: theme.colors.dark[5],
		},
	},
}));

interface NavbarLinkProps {
	// rome-ignore lint/suspicious/noExplicitAny: I do not know what to use here instead
	icon: React.FC<any>;
	label: string;
	onClick?(): void;
	href?: string;
}

function NavbarButton({ icon: Icon, label, onClick, href }: NavbarLinkProps) {
	const { classes, cx } = useStyles();
	const icon = <Icon size="1.2rem" stroke={1.5} />;
	const element = href ? (
		<Link href={href} className={cx(classes.link)}>
			{icon}
		</Link>
	) : (
		<UnstyledButton onClick={onClick} className={cx(classes.link)}>
			{icon}
		</UnstyledButton>
	);

	return (
		<Box w={50}>
			<Tooltip
				label={label}
				position="bottom"
				transitionProps={{ duration: 0 }}
			>
				{element}
			</Tooltip>
		</Box>
	);
}

const AUTH_COOKIE = "auth";

export default function ({ children }: { children: ReactElement }) {
	const theme = useMantineTheme();
	const [opened, { toggle }] = useDisclosure(false);

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

	const _links = [
		{ icon: IconHome2, label: "Home", href: ROUTES.dashboard },
		...(Object.entries(userPrefs?.data?.featuresEnabled || {})
			.map(([name, enabled]) => ({ name: getLot(name)!, enabled }))
			?.filter((f) => f.enabled)
			.map((f) => ({
				label: changeCase(f.name.toString()),
				icon: getMetadataIcon(f.name),
				href: undefined,
			})) || []),
		{ icon: IconArchive, label: "Collections", href: ROUTES.collections.list },
		{ icon: IconSettings, label: "Settings", href: ROUTES.settings },
	].map((link, _index) => (
		<NavbarButton
			{...link}
			key={link.label}
			href={
				link.href ? link.href : `${ROUTES.list}?lot=${link.label.toLowerCase()}`
			}
		/>
	));

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
					width={{ sm: 200, lg: 300 }}
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
					<Text>Application navbar</Text>
				</Navbar>
			}
			footer={
				<MantineFooter height={60} p="md">
					<Footer />
				</MantineFooter>
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
			<Box>{children}</Box>
		</AppShell>
	);
}
