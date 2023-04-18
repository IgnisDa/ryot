import { queryClient } from "@/lib/api";
import "@/styles/globals.css";
import { QueryClientProvider } from "@tanstack/react-query";
import type { AppProps } from "next/app";
import { Inter } from "next/font/google";
import Head from "next/head";

const inter = Inter({ subsets: ["latin"] });

export default function App({ Component, pageProps }: AppProps) {
	return (
		<>
			<QueryClientProvider client={queryClient}>
				<Head>
					<title>Trackona</title>
				</Head>
				<div className={`${inter.className}`}>
					<Component {...pageProps} />
				</div>
			</QueryClientProvider>
		</>
	);
}
