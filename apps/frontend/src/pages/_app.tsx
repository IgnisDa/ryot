import {
	Container,
	NextUIProvider,
	Text,
	createTheme,
} from "@nextui-org/react";
import { gqlClient, queryClient } from "@/lib/api";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { VERSION } from "@trackona/graphql/backend/queries";
import type { AppProps } from "next/app";
import { Inter } from "next/font/google";
import Head from "next/head";
// import "@/styles/globals.css";

const inter = Inter({ subsets: ["latin"] });

const theme = createTheme({
	type: "dark",
});

const Footer = () => {
	const version = useQuery(["version"], async () => {
		const { version } = await gqlClient.request(VERSION);
		return version;
	});

	return (
		<Container as="footer" css={{ textAlign: "center", padding: "20px" }}>
			You are running version{" "}
			<Text color="error" css={{ display: "inline" }} weight={"bold"}>
				{version.data}
			</Text>
		</Container>
	);
};

export default function App({ Component, pageProps }: AppProps) {
	return (
		<>
			<NextUIProvider theme={theme}>
				<QueryClientProvider client={queryClient}>
					<Head>
						<title>Trackona</title>
					</Head>
					<Container
						className={`${inter.className}`}
						display="flex"
						direction="column"
						css={{ minHeight: "100vh" }}
					>
						<Container display="flex" as="main" css={{ flexGrow: 1 }}>
							<Component {...pageProps} />
						</Container>
						<Footer />
					</Container>
				</QueryClientProvider>
			</NextUIProvider>
		</>
	);
}
