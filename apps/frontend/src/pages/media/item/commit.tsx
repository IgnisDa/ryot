import { APP_ROUTES } from "@/lib/constants";
import { useCommitMedia } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { getLot } from "@/lib/utilities";
import type { MetadataSource } from "@ryot/generated/graphql/backend/graphql";
import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement, useEffect } from "react";
import { withQuery } from "ufo";
import type { NextPageWithLayout } from "../../_app";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const lot = getLot(router.query.lot);
	const identifier = router.query.identifier?.toString();
	const source = router.query.source?.toString() as unknown as MetadataSource;

	const commitMedia = useCommitMedia(lot, (id) => {
		router.replace(
			withQuery(APP_ROUTES.media.individualMediaItem.details, { id }),
		);
	});

	useEffect(() => {
		if (identifier && lot && source)
			commitMedia.mutate({ identifier, lot, source });
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
