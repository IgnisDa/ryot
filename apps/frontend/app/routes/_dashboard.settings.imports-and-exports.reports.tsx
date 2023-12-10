import { $path } from "@ignisda/remix-routes";
import {
	Accordion,
	Anchor,
	Container,
	Flex,
	Indicator,
	JsonInput,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ImportReportsDocument } from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { dayjsLib } from "~/lib/generals";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [{ importReports }] = await Promise.all([
		gqlClient.request(
			ImportReportsDocument,
			undefined,
			await getAuthorizationHeader(request),
		),
	]);
	return json({ importReports });
};

export const meta: MetaFunction = () => {
	return [{ title: "Import Reports | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container size="sm">
			<Stack>
				<Flex justify="space-between" align="center">
					<Title>Import Reports</Title>
					<Anchor
						size="xs"
						to={$path("/settings/imports-and-exports")}
						component={Link}
					>
						New
					</Anchor>
				</Flex>
				{loaderData.importReports.length > 0 ? (
					<Accordion>
						{loaderData.importReports.map((report) => (
							<Accordion.Item value={report.id.toString()}>
								<Accordion.Control
									disabled={typeof report.success !== "boolean"}
								>
									<Indicator
										inline
										size={12}
										offset={-3}
										processing={typeof report.success !== "boolean"}
										color={
											typeof report.success === "boolean"
												? report.success
													? "green"
													: "red"
												: undefined
										}
									>
										{changeCase(report.source)}{" "}
										<Text size="xs" span c="dimmed">
											({dayjsLib(report.startedOn).fromNow()})
										</Text>
									</Indicator>
								</Accordion.Control>
								<Accordion.Panel>
									{report.details ? (
										<>
											<Text>Total imported: {report.details.import.total}</Text>
											<Text>Failed: {report.details.failedItems.length}</Text>
											{report.details.failedItems.length > 0 ? (
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
											) : undefined}
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
	);
}
