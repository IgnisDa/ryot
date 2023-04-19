import { Flex, Container, Text, MantineProvider } from "@mantine/core";
import { gqlClient, queryClient } from "@/lib/services/api";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { VERSION } from "@trackona/graphql/backend/queries";
import type { AppProps } from "next/app";
import { Inter } from "next/font/google";
import { Notifications } from "@mantine/notifications";
import Head from "next/head";
import type { ReactElement, ReactNode } from "react";
import type { NextPage } from "next";

const inter = Inter({ subsets: ["latin"] });

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
	getLayout?: (page: ReactElement) => ReactNode;
};

type AppPropsWithLayout = AppProps & {
	Component: NextPageWithLayout;
};

const Footer = () => {
	const version = useQuery(["version"], async () => {
		const { version } = await gqlClient.request(VERSION);
		return version;
	});

	return (
		<Container p={8}>
			You are running version{" "}
			<Text color="red" weight={"bold"} style={{ display: "inline" }}>
				{version.data}
			</Text>
		</Container>
	);
};

export default function App({ Component, pageProps }: AppPropsWithLayout) {
	const getLayout = Component.getLayout ?? ((page) => page);

	return (
		<>
			<Head>
				<title>Trackona</title>
			</Head>
			<QueryClientProvider client={queryClient}>
				<MantineProvider
					withGlobalStyles
					withNormalizeCSS
					theme={{ colorScheme: "dark" }}
				>
					<Notifications />
					<Flex
						className={`${inter.className}`}
						direction={"column"}
						style={{ minHeight: "100vh" }}
					>
						<Flex style={{ flexGrow: 1 }}>
							{getLayout(<Component {...pageProps} />)}
						</Flex>
						<Footer />
					</Flex>
				</MantineProvider>
			</QueryClientProvider>
		</>
	);
}
