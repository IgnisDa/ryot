import { gqlClient } from "../services/api";
import {
	Box,
	Flex,
	Tooltip,
	UnstyledButton,
	createStyles,
	rem,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	IconBook,
	IconBrandAppleArcade,
	IconDeviceDesktop,
	IconDeviceTv,
	IconHeadphones,
	IconHome2,
	IconLogout,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MetadataLot } from "@trackona/generated/graphql/backend/graphql";
import { LOGOUT_USER } from "@trackona/graphql/backend/mutations";
import { CORE_ENABLED_FEATURES } from "@trackona/graphql/backend/queries";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useEffect } from "react";
import { useCookies } from "react-cookie";
import { match } from "ts-pattern";

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

const navbarData = [{ icon: IconHome2, label: "Home", href: "/" }];

const getIcon = (lot: MetadataLot) => {
	return match(lot)
		.with(MetadataLot.Book, () => IconBook)
		.with(MetadataLot.Movie, () => IconDeviceTv)
		.with(MetadataLot.Show, () => IconDeviceDesktop)
		.with(MetadataLot.VideoGame, () => IconBrandAppleArcade)
		.with(MetadataLot.AudioBook, () => IconHeadphones)
		.exhaustive();
};

export default function ({ children }: { children: ReactElement }) {
	const [{ auth }] = useCookies(["auth"]);
	const router = useRouter();
	const enabledFeatures = useQuery(
		["enabledFeatures"],
		async () => {
			const { coreEnabledFeatures } = await gqlClient.request(
				CORE_ENABLED_FEATURES,
			);
			return coreEnabledFeatures;
		},
		{ staleTime: Infinity },
	);

	const links = [
		...navbarData,
		...(enabledFeatures.data
			?.filter((f) => f.enabled)
			.map((f) => ({
				label: f.name.toString(),
				icon: getIcon(f.name),
				href: undefined,
			})) || []),
	].map((link, _index) => (
		<NavbarButton
			{...link}
			key={link.label}
			href={link.href ? link.href : `/list?lot=${link.label.toLowerCase()}`}
		/>
	));
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
			} else {
				notifications.show({
					title: "Error",
					message: "There was a problem logging out",
					color: "red",
				});
			}
			router.push("/auth/login");
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

	return enabledFeatures ? (
		<Flex direction={"column"} w={"100%"}>
			<Flex p="sm" align={"center"} justify={"center"}>
				{links}
				<NavbarButton
					icon={IconLogout}
					label="Logout"
					onClick={logoutUser.mutate}
				/>
			</Flex>
			<Box my={"lg"}>{children}</Box>
		</Flex>
	) : null;
}
