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
	CoreEnabledFeaturesDocument,
	LogoutUserDocument,
	MetadataLot,
	UserDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconBook,
	IconBrandAppleArcade,
	IconDeviceDesktop,
	IconDeviceTv,
	IconHeadphones,
	IconHome2,
	IconListDetails,
	IconLogout,
	IconSettings,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { camelCase, startCase } from "lodash";
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
		<Tooltip label={label} position="bottom" transitionProps={{ duration: 0 }}>
			{element}
		</Tooltip>
	);
}


const getIcon = (lot: MetadataLot) => {
	return match(lot)
		.with(MetadataLot.Book, () => IconBook)
		.with(MetadataLot.Movie, () => IconDeviceTv)
		.with(MetadataLot.Show, () => IconDeviceDesktop)
		.with(MetadataLot.VideoGame, () => IconBrandAppleArcade)
		.with(MetadataLot.AudioBook, () => IconHeadphones)
		.exhaustive();
};

export default function({ children }: { children: ReactElement }) {
	const [{ auth }] = useCookies(["auth"]);
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
				router.push("/auth/login");
			}
		},
		staleTime: Infinity,
	});
	const enabledFeatures = useQuery(
		["enabledFeatures"],
		async () => {
			const { coreEnabledFeatures } = await gqlClient.request(
				CoreEnabledFeaturesDocument,
			);
			return coreEnabledFeatures;
		},
		{ staleTime: Infinity },
	);

	const links = [
		{ icon: IconHome2, label: "Home", href: "/" },
		...(enabledFeatures.data
			?.filter((f) => f.enabled)
			.map((f) => ({
				label: startCase(camelCase(f.name.toString())),
				icon: getIcon(f.name),
				href: undefined,
			})) || []),
		{ icon: IconListDetails, label: "Collections", href: "/collections" },
		{ icon: IconSettings, label: "Settings", href: "/settings" },
	].map((link, _index) => (
		<NavbarButton
			{...link}
			key={link.label}
			href={link.href ? link.href : `/list?lot=${link.label.toLowerCase()}`}
		/>
	));
	const logoutUser = useMutation({
		mutationFn: async () => {
			const { logoutUser } = await gqlClient.request(LogoutUserDocument);
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
			<Flex p="sm" align={"center"} justify={"center"} wrap={'wrap'}>
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
