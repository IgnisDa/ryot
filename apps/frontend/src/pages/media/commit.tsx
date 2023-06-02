import type { NextPageWithLayout } from "../_app";
import { ROUTES } from "@/lib/constants";
import { useCommitMedia } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { getLot } from "@/lib/utilities";
import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement, useEffect } from "react";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const lot = getLot(router.query.lot);
	const identifier = router.query.identifier?.toString();

	const commitMedia = useCommitMedia(lot, (id) => {
		router.push(`${ROUTES.media.details}?item=${id}`);
	});

	useEffect(() => {
		if (identifier) commitMedia.mutate({ identifier });
	}, [identifier, lot]);

	return (
		<>
			<Head>
				<title>Loading | Ryot</title>
			</Head>
			<LoadingPage />
		</>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
