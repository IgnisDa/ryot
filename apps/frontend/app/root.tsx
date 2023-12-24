import {
	ActionIcon,
	Alert,
	ColorSchemeScript,
	Flex,
	Loader,
	MantineProvider,
	createTheme,
} from "@mantine/core";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import {
	LinksFunction,
	LoaderFunctionArgs,
	MetaFunction,
	json,
} from "@remix-run/node";
import {
	Links,
	LiveReload,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useLoaderData,
	useNavigation,
} from "@remix-run/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "mantine-datatable/styles.layer.css";
import { HoneypotProvider } from "remix-utils/honeypot/react";
import { Toaster } from "~/components/toaster";
import { honeypot } from "~/lib/honeypot.server";
import { getToast } from "~/lib/toast.server";
import { combineHeaders } from "~/lib/utilities.server";
import { MountPoint } from "./components/confirmation";
import { colorSchemeCookie } from "./lib/cookies.server";

const theme = createTheme({
	fontFamily: "Poppins",
	components: {
		ActionIcon: ActionIcon.extend({
			defaultProps: {
				variant: "subtle",
				color: "gray",
			},
		}),
		Alert: Alert.extend({ defaultProps: { p: "xs" } }),
	},
});

export const meta: MetaFunction = () => {
	return [
		{ title: "Ryot" },
		{
			name: "description",
			content: "The only self hosted tracker you will ever need.",
		},
		{
			property: "og:image",
			content:
				"https://raw.githubusercontent.com/IgnisDa/ryot/main/apps/frontend/public/icon-512x512.png",
		},
	];
};

export const links: LinksFunction = () => {
	return [
		{
			rel: "icon",
			type: "image/png",
			sizes: "32x32",
			href: "/favicon-32x32.png",
		},
		{
			rel: "icon",
			type: "image/png",
			sizes: "16x16",
			href: "/favicon-16x16.png",
		},
		{
			rel: "stylesheet",
			href: "https://fonts.googleapis.com/css2?family=Poppins:wght@100;200;300;400;500;600;700;800;900&display=swap",
		},
	];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const honeyProps = honeypot.getInputProps();
	const { toast, headers: toastHeaders } = await getToast(request);
	const colorScheme = await colorSchemeCookie.parse(
		request.headers.get("Cookie") || "",
	);
	const defaultColorScheme = colorScheme || "light";
	return json(
		{ honeyProps, toast, defaultColorScheme },
		{ headers: combineHeaders(toastHeaders) },
	);
};

const queryClient = new QueryClient();

export default function App() {
	const navigation = useNavigation();
	const loaderData = useLoaderData<typeof loader>();

	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta
					name="viewport"
					content="minimum-scale=1, initial-scale=1, width=device-width, shrink-to-fit=no, user-scalable=no, viewport-fit=cover"
				/>
				<Meta />
				<Links />
				<ColorSchemeScript forceColorScheme={loaderData.defaultColorScheme} />
			</head>
			<body>
				<QueryClientProvider client={queryClient}>
					<HoneypotProvider {...loaderData.honeyProps}>
						<MantineProvider
							classNamesPrefix="mnt"
							theme={theme}
							forceColorScheme={loaderData.defaultColorScheme}
						>
							<MountPoint />
							{navigation.state === "loading" ||
							navigation.state === "submitting" ? (
								<Loader
									pos="fixed"
									right={10}
									top={10}
									size="sm"
									color="yellow"
								/>
							) : null}
							<Toaster toast={loaderData.toast} />
							<Flex style={{ flexGrow: 1 }} mih="100vh">
								<Outlet />
							</Flex>
							<ScrollRestoration />
							<LiveReload />
							<Scripts />
						</MantineProvider>
					</HoneypotProvider>
				</QueryClientProvider>
			</body>
		</html>
	);
}
