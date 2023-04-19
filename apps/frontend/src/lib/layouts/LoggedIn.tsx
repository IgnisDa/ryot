import { useCookies } from "react-cookie";
import { useEffect, type ReactElement } from "react";
import { useRouter } from "next/router";
import { notifications } from "@mantine/notifications";
import {
	Tooltip,
	UnstyledButton,
	createStyles,
	rem,
	Flex,
	Box,
} from "@mantine/core";
import {
	IconHome2,
	IconLogout,
	IconBook,
	IconDeviceDesktop,
	IconDeviceTv,
	IconBrandAppleArcade,
	IconHeadphones,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { gqlClient } from "../services/api";
import { LOGOUT_USER } from "@trackona/graphql/backend/mutations";
import Link from "next/link";

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
		<Tooltip label={label} position="bottom" transitionProps={{ duration: 0 }}>
			{element}
		</Tooltip>
	);
}

const mockdata = [
	{ icon: IconHome2, label: "Home", href: "/" },
	{ icon: IconBook, label: "Books" },
	{ icon: IconDeviceDesktop, label: "TV" },
	{ icon: IconDeviceTv, label: "Movies" },
	{ icon: IconBrandAppleArcade, label: "Games" },
	{ icon: IconHeadphones, label: "Audiobooks" },
];

export default function ({ children }: { children: ReactElement }) {
	const [{ auth }] = useCookies(["auth"]);
	const links = mockdata.map((link, _index) => (
		<NavbarButton
			{...link}
			key={link.label}
			href={link.href ? link.href : link.label.toLowerCase()}
		/>
	));
	const router = useRouter();
	const logoutUser = useMutation({
		mutationFn: async () => {
			const { logoutUser } = await gqlClient.request(LOGOUT_USER);
			return logoutUser;
		},
		onSuccess: (data) => {
			if (data) {
				notifications.show({
					title: "Success",
					message: "You were logged out successfully",
					color: "green",
				});
				router.push("/auth/login");
			} else {
				notifications.show({
					title: "Error",
					message: "There was a problem logging out",
					color: "red",
				});
			}
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
			router.push("/auth/login");
		}
	}, []);

	return (
		<Flex direction={"column"} w={"100%"}>
			<Flex p="sm" align={"center"} justify={"center"}>
				{links}
				<NavbarButton
					icon={IconLogout}
					label="Logout"
					onClick={logoutUser.mutate}
				/>
			</Flex>
			<Box>{children}</Box>
		</Flex>
	);
}
