import { ColorSchemeScript } from "@mantine/core";
import Document, { Head, Html, Main, NextScript } from "next/document";

export default class _Document extends Document {
	override render() {
		return (
			<Html>
				<Head>
					<link
						href="https://fonts.googleapis.com/css2?family=Poppins:wght@100;200;300;400;500;600;700;800;900&display=swap"
						rel="stylesheet"
					/>
					<link
						rel="icon"
						type="image/png"
						sizes="32x32"
						href="/favicon-32x32.png"
					/>
					<link
						rel="icon"
						type="image/png"
						sizes="16x16"
						href="/favicon-16x16.png"
					/>
					<link rel="manifest" href="/manifest.json" />
					<meta name="theme-color" content="#042940" />
					<ColorSchemeScript defaultColorScheme="dark" />
				</Head>
				<body>
					<Main />
					<NextScript />
				</body>
			</Html>
		);
	}
}
