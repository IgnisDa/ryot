import { gqlClient, queryClient } from "@/lib/services/api";
import { Anchor, Container, Flex, MantineProvider, Text } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { CoreDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { NextPage } from "next";
import { NextSeo } from "next-seo";
import type { AppProps } from "next/app";
import Head from "next/head";
import type { ReactElement, ReactNode } from "react";

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
			const { coreDetails } = await gqlClient.request(CoreDetailsDocument);
			return coreDetails;
		},
		{ staleTime: Infinity },
	);

	return (
		<Container p={"md"} style={{ textAlign: "center" }}>
			{coreDetails.data ? (
				<Flex gap={50}>
					<Anchor
						href={`${coreDetails.data.repositoryLink}/releases/v${coreDetails.data.version}`}
						target="_blank"
					>
						<Text color="red" weight={"bold"} style={{ display: "inline" }}>
							v{coreDetails.data.version}
						</Text>
					</Anchor>
					<Anchor href="https://diptesh.me" target="_blank">
						<Text weight={"bold"} style={{ display: "inline" }}>
							{coreDetails.data.authorName}
						</Text>
					</Anchor>
					<Anchor href={coreDetails.data.repositoryLink} target="_blank">
						<Text color="orange" weight={"bold"} style={{ display: "inline" }}>
							Github
						</Text>
					</Anchor>
				</Flex>
			) : null}
		</Container>
	);
};

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
							url: "https://raw.githubusercontent.com/IgnisDa/ryot/main/apps/frontend/public/ryot-logo.png",
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
				<MantineProvider
					withGlobalStyles
					withNormalizeCSS
					theme={{
						colorScheme: "dark",
						fontFamily: "Poppins",
						breakpoints: {
							"3xl": "112em",
						},
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
							<Footer />
						</Flex>
					</ModalsProvider>
				</MantineProvider>
			</QueryClientProvider>
		</>
	);
}
