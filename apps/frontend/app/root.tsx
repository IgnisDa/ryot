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
	type LinksFunction,
	type LoaderFunctionArgs,
	type MetaFunction,
	json,
} from "@remix-run/node";
import {
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useLoaderData,
	useNavigation,
} from "@remix-run/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "mantine-datatable/styles.layer.css";
import { Toaster } from "~/components/toaster";
import {
	colorSchemeCookie,
	combineHeaders,
	getToast,
} from "~/lib/utilities.server";
import { MountPoint } from "./components/confirmation";

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
	breakpoints: {
		xs: "30em",
		sm: "48em",
		md: "64em",
		lg: "74em",
		xl: "90em",
		"2xl": "120em",
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
	const { toast, headers: toastHeaders } = await getToast(request);
	const colorScheme = await colorSchemeCookie.parse(
		request.headers.get("cookie") || "",
	);
	const defaultColorScheme = colorScheme || "light";
	return json(
		{ toast, defaultColorScheme },
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
				<link rel="manifest" href="/manifest.json" />
				<Meta />
				<Links />
				<ColorSchemeScript forceColorScheme={loaderData.defaultColorScheme} />
			</head>
			<body>
				<QueryClientProvider client={queryClient}>
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
								style={{ zIndex: 10 }}
							/>
						) : null}
						<Toaster toast={loaderData.toast} />
						<Flex style={{ flexGrow: 1 }} mih="100vh">
							<Outlet />
						</Flex>
						<ScrollRestoration />
						<Scripts />
					</MantineProvider>
				</QueryClientProvider>
			</body>
		</html>
	);
}
