import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

import { LOCAL_STORAGE_KEYS } from "@/lib/constants";
import { queryClient } from "@/lib/services/api";
import {
	ActionIcon,
	Alert,
	Flex,
	type MantineColorScheme,
	type MantineColorSchemeManager,
	MantineProvider,
	createTheme,
	isMantineColorScheme,
} from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider } from "jotai";
import type { NextPage } from "next";
import { NextSeo } from "next-seo";
import type { AppProps } from "next/app";
import Head from "next/head";
import { type ReactElement, type ReactNode } from "react";

export interface LocalStorageColorSchemeManagerOptions {
	key?: string;
}

export function localStorageColorSchemeManager({
	key = "mantine-color-scheme",
}: LocalStorageColorSchemeManagerOptions = {}): MantineColorSchemeManager {
	let handleStorageEvent: (event: StorageEvent) => void;
	return {
		get: (defaultValue) => {
			if (typeof window === "undefined") {
				return defaultValue;
			}
			try {
				return (
					(window.localStorage.getItem(key) as MantineColorScheme) ||
					defaultValue
				);
			} catch {
				return defaultValue;
			}
		},
		set: (value) => {
			try {
				window.localStorage.setItem(key, value);
			} catch (error) {
				console.warn(
					"[@mantine/core] Local storage color scheme manager was unable to save color scheme.",
					error,
				);
			}
		},
		subscribe: (onUpdate) => {
			handleStorageEvent = (event) => {
				if (event.storageArea === window.localStorage && event.key === key) {
					isMantineColorScheme(event.newValue) && onUpdate(event.newValue);
				}
			};
			window.addEventListener("storage", handleStorageEvent);
		},
		unsubscribe: () => {
			window.removeEventListener("storage", handleStorageEvent);
		},
		clear: () => {
			window.localStorage.removeItem(key);
		},
	};
}

const colorSchemeManager = localStorageColorSchemeManager({
	key: LOCAL_STORAGE_KEYS.colorScheme,
});

// biome-ignore lint/complexity/noBannedTypes: taken from NextJS docs
export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
	getLayout?: (page: ReactElement) => ReactNode;
};

type AppPropsWithLayout = AppProps & {
	Component: NextPageWithLayout;
};

const theme = createTheme({
	fontFamily: "Poppins",
	components: {
		ActionIcon: ActionIcon.extend({
			defaultProps: {
				variant: "subtle",
				color: "gray",
			},
		}),
		Alert: Alert.extend({
			defaultProps: { p: "xs" },
		}),
	},
});

export default function App({ Component, pageProps }: AppPropsWithLayout) {
	const getLayout = Component.getLayout ?? ((page) => page);

	return (
		<>
			<NextSeo
				title="Ryot - Roll your own tracker!"
				description="The only self hosted tracker you will ever need."
				openGraph={{
					images: [
						{
							url: "https://raw.githubusercontent.com/IgnisDa/ryot/main/apps/frontend/public/icon-512x512.png",
							alt: "Ryot logo",
						},
					],
				}}
				noindex
				nofollow
			/>
			<Head>
				<title>Ryot</title>
				<meta
					name="viewport"
					content="minimum-scale=1, initial-scale=1, width=device-width, shrink-to-fit=no, user-scalable=no, viewport-fit=cover"
				/>
			</Head>
			<QueryClientProvider client={queryClient}>
				<JotaiProvider>
					<MantineProvider
						classNamesPrefix="mnt"
						theme={theme}
						colorSchemeManager={colorSchemeManager}
					>
						<ModalsProvider
							labels={{ confirm: "Confirm", cancel: "Cancel" }}
							modalProps={{ centered: true, title: "Confirmation" }}
						>
							<Notifications />
							<Flex direction="column" style={{ minHeight: "100vh" }}>
								<Flex style={{ flexGrow: 1 }}>
									{getLayout(<Component {...pageProps} />)}
								</Flex>
							</Flex>
						</ModalsProvider>
					</MantineProvider>
				</JotaiProvider>
			</QueryClientProvider>
		</>
	);
}
