import type { NextPageWithLayout } from "../_app";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Accordion,
	Container,
	Indicator,
	JsonInput,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { ImportReportsDocument } from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/utilities";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import Head from "next/head";
import { type ReactElement } from "react";

const Page: NextPageWithLayout = () => {
	const importReports = useQuery({
		queryKey: ["importReports"],
		queryFn: async () => {
			const { importReports } = await gqlClient.request(ImportReportsDocument);
			return importReports;
		},
	});

	return importReports.data ? (
		<>
			<Head>
				<title>Import Reports | Ryot</title>
			</Head>
			<Container size="sm">
				<Stack>
					<Title>Import Reports</Title>
					{importReports.data.length > 0 ? (
						<Accordion>
							{importReports.data.map((report) => (
								<Accordion.Item value={report.id.toString()}>
									<Accordion.Control
										disabled={typeof report.success !== "boolean"}
									>
										<Indicator
											inline
											size={12}
											processing={typeof report.success !== "boolean"}
											color={
												typeof report.success === "boolean"
													? report.success
														? "green"
														: "red"
													: undefined
											}
										>
											{changeCase(report.source)} on{" "}
											{DateTime.fromJSDate(report.startedOn).toLocaleString()}
										</Indicator>
									</Accordion.Control>
									<Accordion.Panel>
										{report.details ? (
											<>
												<Text>
													Total imported: {report.details.import.total}
												</Text>
												<Text>Failed: {report.details.failedItems.length}</Text>
												<JsonInput
													size="xs"
													defaultValue={JSON.stringify(
														report.details.failedItems,
														null,
														4,
													)}
													disabled
													autosize
												/>
											</>
										) : (
											<Text>This import never finished</Text>
										)}
									</Accordion.Panel>
								</Accordion.Item>
							))}
						</Accordion>
					) : (
						<Text>You have not performed any imports</Text>
					)}
				</Stack>
			</Container>
		</>
	) : (
		<LoadingPage />
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
