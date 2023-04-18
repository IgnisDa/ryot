import { Flex, Container, Text, MantineProvider } from "@mantine/core";
import { gqlClient, queryClient } from "@/lib/api";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { VERSION } from "@trackona/graphql/backend/queries";
import type { AppProps } from "next/app";
import { Inter } from "next/font/google";
import { Notifications } from "@mantine/notifications";
import Head from "next/head";

const inter = Inter({ subsets: ["latin"] });

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

export default function App({ Component, pageProps }: AppProps) {
	return (
		<>
			<MantineProvider
				withGlobalStyles
				withNormalizeCSS
				theme={{ colorScheme: "dark" }}
			>
				<Notifications />
				<QueryClientProvider client={queryClient}>
					<Head>
						<title>Trackona</title>
					</Head>
					<Flex
						className={`${inter.className}`}
						direction={"column"}
						style={{ minHeight: "100vh" }}
					>
						<Flex style={{ flexGrow: 1 }}>
							<Component {...pageProps} />
						</Flex>
						<Footer />
					</Flex>
				</QueryClientProvider>
			</MantineProvider>
		</>
	);
}
