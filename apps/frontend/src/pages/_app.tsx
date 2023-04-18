import { gqlClient, queryClient } from "@/lib/api";
import "@/styles/globals.css";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { VERSION } from "@trackona/graphql/backend/queries";
import type { AppProps } from "next/app";
import { Inter } from "next/font/google";
import Head from "next/head";

const inter = Inter({ subsets: ["latin"] });

const Footer = () => {
	const version = useQuery(["version"], async () => {
		const { version } = await gqlClient.request(VERSION);
		return version;
	});

	return (
		<footer className="pb-4">You are running version {version.data}</footer>
	);
};

export default function App({ Component, pageProps }: AppProps) {
	return (
		<>
			<QueryClientProvider client={queryClient}>
				<Head>
					<title>Trackona</title>
				</Head>
				<div
					className={`${inter.className} min-h-screen flex flex-col items-center justify-between bg-slate-900 text-slate-100`}
				>
					<main className="flex-grow w-full p-4">
						<Component {...pageProps} />
					</main>
					<Footer />
				</div>
			</QueryClientProvider>
		</>
	);
}
