import { queryClient } from "@/lib/services/api";
import {
	type ColorScheme,
	ColorSchemeProvider,
	Flex,
	MantineProvider,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider } from "jotai";
import type { NextPage } from "next";
import { NextSeo } from "next-seo";
import type { AppProps } from "next/app";
import Head from "next/head";
import { type ReactElement, type ReactNode } from "react";

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
	getLayout?: (page: ReactElement) => ReactNode;
};

type AppPropsWithLayout = AppProps & {
	Component: NextPageWithLayout;
};

export default function App({ Component, pageProps }: AppPropsWithLayout) {
	const [colorScheme, setColorScheme] = useLocalStorage<ColorScheme>({
		key: "mantine-color-scheme",
		defaultValue: "dark",
		getInitialValueInEffect: true,
	});

	const toggleColorScheme = (value?: ColorScheme) =>
		setColorScheme(value || (colorScheme === "dark" ? "light" : "dark"));

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
					<ColorSchemeProvider
						colorScheme={colorScheme}
						toggleColorScheme={toggleColorScheme}
					>
						<MantineProvider
							withGlobalStyles
							withNormalizeCSS
							theme={{
								colorScheme,
								fontFamily: "Poppins",
								breakpoints: { "3xl": "112em" },
							}}
						>
							<ModalsProvider
								labels={{ confirm: "Confirm", cancel: "Cancel" }}
								modalProps={{ centered: true, title: "Confirmation" }}
							>
								<Notifications />
								<Flex direction={"column"} style={{ minHeight: "100vh" }}>
									<Flex style={{ flexGrow: 1 }}>
										{getLayout(<Component {...pageProps} />)}
									</Flex>
								</Flex>
							</ModalsProvider>
						</MantineProvider>
					</ColorSchemeProvider>
				</JotaiProvider>
			</QueryClientProvider>
		</>
	);
}
