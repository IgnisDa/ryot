import {
	ActionIcon,
	Alert,
	ColorSchemeScript,
	Flex,
	Loader,
	MantineProvider,
	createTheme,
} from "@mantine/core";
import "@mantine/charts/styles.css";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import {
	type LinksFunction,
	type MetaFunction,
	unstable_data,
	unstable_defineLoader,
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
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useEffect, useState } from "react";
import "mantine-datatable/styles.layer.css";
import { ConfirmationMountPoint } from "~/components/confirmation";
import { Toaster } from "~/components/toaster";
import { LOGO_IMAGE_URL, queryClient } from "~/lib/generals";
import {
	colorSchemeCookie,
	extendResponseHeaders,
	getToast,
} from "~/lib/utilities.server";

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
			content: LOGO_IMAGE_URL,
		},
	];
};

export const links: LinksFunction = () => {
	return [
		{
			rel: "icon",
			type: "image/png",
			sizes: "16x16",
			href: "https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/favicon-16x16.png",
		},
		{
			rel: "icon",
			type: "image/png",
			sizes: "32x32",
			href: "https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/favicon-32x32.png",
		},
		{
			rel: "stylesheet",
			href: "https://fonts.googleapis.com/css2?family=Poppins:wght@100;200;300;400;500;600;700;800;900&display=swap",
		},
	];
};

export const loader = unstable_defineLoader(async ({ request }) => {
	const { toast, headers: toastHeaders } = await getToast(request);
	const colorScheme = await colorSchemeCookie.parse(
		request.headers.get("cookie") || "",
	);
	const headers = new Headers();
	const defaultColorScheme = colorScheme || "light";
	if (toastHeaders) extendResponseHeaders(headers, toastHeaders);
	return unstable_data({ toast, defaultColorScheme }, { headers });
});

const DefaultHeadTags = () => {
	const [isIOS18, setIsIOS18] = useState(false);

	useEffect(() => {
		const detectIOS18 = () => {
			const userAgent = window.navigator.userAgent;
			const iOS = /iPad|iPhone|iPod/.test(userAgent);
			const version = (userAgent.match(/OS (\d+)_(\d+)_?(\d+)?/) || [0, ""])[1];
			setIsIOS18(iOS && Number.parseInt(version, 10) >= 18);
		};

		detectIOS18();
	}, []);

	return (
		<>
			<meta charSet="utf-8" />
			<meta
				name="viewport"
				content="minimum-scale=1, initial-scale=1, width=device-width, shrink-to-fit=no, user-scalable=no, viewport-fit=cover"
			/>
			<link rel="manifest" href="/manifest.json" />
			<link rel="apple-touch-icon"
				  href={isIOS18 ? "/icon-192x192.png" : "/apple-touch-icon.png"}
			/>
		</>
	);
};

export default function App() {
	const navigation = useNavigation();
	const loaderData = useLoaderData<typeof loader>();

	return (
		<html lang="en">
			<head>
				<DefaultHeadTags />
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
						<ConfirmationMountPoint />
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
					<ReactQueryDevtools buttonPosition="top-right" />
				</QueryClientProvider>
			</body>
		</html>
	);
}
