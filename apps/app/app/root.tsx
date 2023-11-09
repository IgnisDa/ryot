import { ColorSchemeScript, Flex, MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import { LinksFunction, MetaFunction, json } from "@remix-run/node";
import {
	Links,
	LiveReload,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
} from "@remix-run/react";
import { HoneypotProvider } from "remix-utils/honeypot/react";
import { honeypot } from "~/lib/honeypot.server";

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
	];
};

export const loader = () => {
	return json({ honeypot: honeypot.getInputProps() });
};

export default function App() {
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
				<ColorSchemeScript />
			</head>
			<body>
				<HoneypotProvider>
					<MantineProvider>
						<Flex style={{ flexGrow: 1 }} mih="100vh">
							<Outlet />
						</Flex>
						<ScrollRestoration />
						<LiveReload />
						<Scripts />
					</MantineProvider>
				</HoneypotProvider>
			</body>
		</html>
	);
}
