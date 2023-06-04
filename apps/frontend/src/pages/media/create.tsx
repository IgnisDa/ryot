import type { NextPageWithLayout } from "../_app";
import MediaDetailsLayout from "@/lib/components/MediaDetailsLayout";
import Basic from "@/lib/layouts/Basic";
import { Container, Title } from "@mantine/core";
import Head from "next/head";
import type { ReactElement } from "react";

const Page: NextPageWithLayout = () => {
	return (
		<>
			<Head>
				<title>Create media item | Ryot</title>
			</Head>
			<Container>
				<MediaDetailsLayout
					backdropImages={[]}
					posterImages={[]}
					externalLink={{ source: "custom" }}
				>
					<Title>Create Media</Title>
					<></>
				</MediaDetailsLayout>
			</Container>
		</>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <Basic>{page}</Basic>;
};

export default Page;
