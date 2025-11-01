import "@mantine/core/styles.css";
import "@mantine/code-highlight/styles.css";
import "@mantine/charts/styles.css";
import "@mantine/carousel/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import "mantine-datatable/styles.layer.css";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
	ActionIcon,
	Alert,
	ColorSchemeScript,
	Flex,
	Loader,
	MantineProvider,
	createTheme,
} from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
	Links,
	type LinksFunction,
	type LoaderFunctionArgs,
	Meta,
	type MetaFunction,
	Outlet,
	Scripts,
	ScrollRestoration,
	data,
	useLoaderData,
	useNavigation,
} from "react-router";
import { Toaster } from "~/components/toaster";
import { LOGO_IMAGE_URL } from "~/lib/shared/constants";
import { queryClient } from "~/lib/shared/react-query";
import {
	colorSchemeCookie,
	extendResponseHeaders,
	getToast,
} from "~/lib/utilities.server";

const theme = createTheme({
	fontFamily: "Poppins",
	components: {
		Alert: Alert.extend({ defaultProps: { p: "xs" } }),
		ActionIcon: ActionIcon.extend({
			defaultProps: { variant: "subtle", color: "gray" },
		}),
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const { toast, headers: toastHeaders } = await getToast(request);
	const colorScheme = await colorSchemeCookie.parse(
		request.headers.get("cookie"),
	);
	const headers = new Headers();
	const defaultColorScheme = colorScheme || "light";
	if (toastHeaders) extendResponseHeaders(headers, toastHeaders);
	return data(
		{
			toast,
			defaultColorScheme,
			isDevelopmentMode: process.env.NODE_ENV === "development",
		},
		{ headers },
	);
};

export default function App() {
	useRegisterSW();
	const navigation = useNavigation();
	const loaderData = useLoaderData<typeof loader>();

	return (
		<html lang="en">
			<head>
				{loaderData.isDevelopmentMode ? (
					<script src="https://unpkg.com/react-scan/dist/auto.global.js" />
				) : null}
				<meta charSet="utf-8" />
				<meta
					name="viewport"
					content="minimum-scale=1, initial-scale=1, width=device-width, shrink-to-fit=no, user-scalable=no, viewport-fit=cover"
				/>
				<link rel="manifest" href="/manifest.json" />
				<link rel="apple-touch-icon" href="/icons/maskable_icon_x180.png" />
				<Meta />
				<Links />
				<ColorSchemeScript forceColorScheme={loaderData.defaultColorScheme} />
			</head>
			<body>
				<MantineProvider
					theme={theme}
					classNamesPrefix="mnt"
					forceColorScheme={loaderData.defaultColorScheme}
				>
					<QueryClientProvider client={queryClient}>
						<ModalsProvider>
							{["loading", "submitting"].includes(navigation.state) ? (
								<Loader
									top={10}
									size="sm"
									right={10}
									pos="fixed"
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
						</ModalsProvider>
						<ReactQueryDevtools buttonPosition="top-right" />
					</QueryClientProvider>
				</MantineProvider>
			</body>
		</html>
	);
}
