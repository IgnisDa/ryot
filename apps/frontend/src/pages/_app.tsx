import { gqlClient, queryClient } from "@/lib/services/api";
import {
	Anchor,
	Box,
	Container,
	Flex,
	MantineProvider,
	Text,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { CORE_DETAILS } from "@ryot/graphql/backend/queries";
import type { NextPage } from "next";
import type { AppProps } from "next/app";
import { Inter } from "next/font/google";
import Head from "next/head";
import type { ReactElement, ReactNode } from "react";

const inter = Inter({ subsets: ["latin"] });

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
	getLayout?: (page: ReactElement) => ReactNode;
};

type AppPropsWithLayout = AppProps & {
	Component: NextPageWithLayout;
};

const Footer = () => {
	const coreDetails = useQuery(
		["coreDetails"],
		async () => {
			const { coreDetails } = await gqlClient.request(CORE_DETAILS);
			return coreDetails;
		},
		{ staleTime: Infinity },
	);

	return (
		<Container p={"md"} style={{ textAlign: "center" }}>
			{coreDetails.data ? (
				<>
					<Box>
						You are running version{" "}
						<Text color="red" weight={"bold"} style={{ display: "inline" }}>
							{coreDetails.data?.version}
						</Text>
					</Box>
					<Box>
						Made with love by{" "}
						<Anchor href="https://diptesh.me" target="_blank">
							<Text weight={"bold"} style={{ display: "inline" }}>
								{coreDetails.data?.authorName}
							</Text>
						</Anchor>
					</Box>
				</>
			) : null}
		</Container>
	);
};

export default function App({ Component, pageProps }: AppPropsWithLayout) {
	const getLayout = Component.getLayout ?? ((page) => page);

	return (
		<>
			<Head>
				<title>Ryot</title>
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
