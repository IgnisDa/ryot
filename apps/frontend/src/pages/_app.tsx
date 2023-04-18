import { Container, NextUIProvider } from "@nextui-org/react";
import { gqlClient, queryClient } from "@/lib/api";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { VERSION } from "@trackona/graphql/backend/queries";
import type { AppProps } from "next/app";
import { Inter } from "next/font/google";
import Head from "next/head";
import "@/styles/globals.css";

const inter = Inter({ subsets: ["latin"] });

const Footer = () => {
	const version = useQuery(["version"], async () => {
		const { version } = await gqlClient.request(VERSION);
		return version;
	});

	return <footer>You are running version {version.data}</footer>;
};

export default function App({ Component, pageProps }: AppProps) {
	return (
		<>
			<NextUIProvider>
				<QueryClientProvider client={queryClient}>
					<Head>
						<title>Trackona</title>
					</Head>
					<div
						className={`${inter.className} min-h-screen flex flex-col to-blue-950 from-slate-950 bg-gradient-to-b text-slate-100`}
					>
						<Container as="main" className="flex-grow">
							<Component {...pageProps} />
						</Container>
						<Footer />
					</div>
				</QueryClientProvider>
			</NextUIProvider>
		</>
	);
}
