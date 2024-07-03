import {
	Accordion,
	Anchor,
	Box,
	Button,
	Container,
	Divider,
	FileInput,
	Flex,
	Group,
	Indicator,
	JsonInput,
	MultiSelect,
	PasswordInput,
	Select,
	Stack,
	Tabs,
	Text,
	TextInput,
	ThemeIcon,
	Title,
	Tooltip,
} from "@mantine/core";
import {
	unstable_defineAction,
	unstable_defineLoader,
	unstable_parseMultipartFormData,
} from "@remix-run/node";
import {
	type FetcherWithComponents,
	Form,
	type MetaArgs_SingleFetch,
	useFetcher,
	useLoaderData,
} from "@remix-run/react";
import {
	DeployExportJobDocument,
	DeployImportJobDocument,
	ExportItem,
	ImportReportsDocument,
	ImportSource,
	UserExportsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import { IconDownload } from "@tabler/icons-react";
import { type ReactNode, type RefObject, useRef, useState } from "react";
import { namedAction } from "remix-utils/named-action";
import { match } from "ts-pattern";
import { withFragment, withQuery } from "ufo";
import { z } from "zod";
import { confirmWrapper } from "~/components/confirmation";
import events from "~/lib/events";
import { dayjsLib } from "~/lib/generals";
import { useCoreDetails, useUserCollections } from "~/lib/hooks";
import {
	createToastHeaders,
	getAuthorizationHeader,
	getCoreEnabledFeatures,
	serverGqlService,
} from "~/lib/utilities.server";
import {
	processSubmission,
	temporaryFileUploadHandler,
} from "~/lib/utilities.server";

export const loader = unstable_defineLoader(async ({ request }) => {
	const [coreEnabledFeatures, { importReports }, { userExports }] =
		await Promise.all([
			getCoreEnabledFeatures(),
			serverGqlService.request(
				ImportReportsDocument,
				undefined,
				getAuthorizationHeader(request),
			),
			serverGqlService.request(
				UserExportsDocument,
				undefined,
				getAuthorizationHeader(request),
			),
		]);
	return { coreEnabledFeatures, importReports, userExports };
});

export const meta = (_args: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: "Imports and Exports | Ryot" }];
};

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await unstable_parseMultipartFormData(
		request,
		temporaryFileUploadHandler,
	);
	return namedAction(request, {
		deployImport: async () => {
			const source = formData.get("source") as ImportSource;
			const values = await match(source)
				.with(
					ImportSource.StoryGraph,
					ImportSource.Imdb,
					ImportSource.Goodreads,
					ImportSource.OpenScale,
					() => ({
						genericCsv: processSubmission(formData, genericCsvImportFormSchema),
					}),
				)
				.with(ImportSource.Audiobookshelf, ImportSource.MediaTracker, () => ({
					urlAndKey: processSubmission(formData, urlAndKeyImportFormSchema),
				}))
				.with(ImportSource.Trakt, () => ({
					trakt: processSubmission(formData, usernameImportFormSchema),
				}))
				.with(ImportSource.Movary, async () => ({
					movary: processSubmission(formData, movaryImportFormSchema),
				}))
				.with(ImportSource.Mal, async () => ({
					mal: processSubmission(formData, malImportFormSchema),
				}))
				.with(ImportSource.StrongApp, async () => {
					const newLocal = processSubmission(
						formData,
						strongAppImportFormSchema,
					);
					return {
						strongApp: { ...newLocal, mapping: JSON.parse(newLocal.mapping) },
					};
				})
				.with(ImportSource.GenericJson, async () => ({
					genericJson: processSubmission(formData, jsonImportFormSchema),
				}))
				.with(ImportSource.Jellyfin, async () => ({
					jellyfin: processSubmission(formData, jellyfinImportFormSchema),
				}))
				.with(ImportSource.Igdb, async () => ({
					igdb: processSubmission(formData, igdbImportFormSchema),
				}))
				.exhaustive();
			await serverGqlService.request(
				DeployImportJobDocument,
				{ input: { source, ...values } },
				getAuthorizationHeader(request),
			);
			return Response.json(
				{ status: "success", generateAuthToken: false } as const,
				{
					headers: await createToastHeaders({
						type: "success",
						message: "Import job started in the background",
					}),
				},
			);
		},
		deployExport: async () => {
			const toExport = processSubmission(formData, deployExportForm);
			await serverGqlService.request(
				DeployExportJobDocument,
				toExport,
				getAuthorizationHeader(request),
			);
			return Response.json(
				{ status: "success", generateAuthToken: false } as const,
				{
					headers: await createToastHeaders({
						type: "success",
						message: "Export job started in the background",
					}),
				},
			);
		},
	});
});

const usernameImportFormSchema = z.object({ username: z.string() });

const apiUrlImportFormSchema = z.object({
	apiUrl: z.string(),
});

const urlAndKeyImportFormSchema = apiUrlImportFormSchema.merge(
	z.object({ apiKey: z.string() }),
);

const jellyfinImportFormSchema = usernameImportFormSchema
	.merge(apiUrlImportFormSchema)
	.merge(z.object({ password: z.string() }));

const genericCsvImportFormSchema = z.object({ csvPath: z.string() });

const igdbImportFormSchema = z
	.object({ collection: z.string() })
	.merge(genericCsvImportFormSchema);

const movaryImportFormSchema = z.object({
	ratings: z.string(),
	history: z.string(),
	watchlist: z.string(),
});

const strongAppImportFormSchema = z.object({
	exportPath: z.string(),
	mapping: z.string(),
});

const jsonImportFormSchema = z.object({ export: z.string() });

const malImportFormSchema = z.object({
	animePath: z.string().optional(),
	mangaPath: z.string().optional(),
});

const deployExportForm = z.object({
	toExport: z.string().transform((v) => v.split(",") as Array<ExportItem>),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const userCollections = useUserCollections();
	const [deployImportSource, setDeployImportSource] = useState<ImportSource>();

	const fetcher = useFetcher<typeof action>();
	const formRef = useRef<HTMLFormElement>(null);

	return (
		<Container size="xs">
			<Tabs defaultValue="import">
				<Tabs.List>
					<Tabs.Tab value="import">Import</Tabs.Tab>
					<Tabs.Tab value="export">Export</Tabs.Tab>
				</Tabs.List>
				<Box mt="xl">
					<Tabs.Panel value="import">
						<fetcher.Form
							ref={formRef}
							method="POST"
							action={withQuery("", { intent: "deployImport" })}
							encType="multipart/form-data"
							onSubmit={() => {
								if (deployImportSource) events.deployImport(deployImportSource);
							}}
						>
							<input hidden name="source" defaultValue={deployImportSource} />
							<Stack>
								<Flex justify="space-between" align="center">
									<Title order={2}>Import data</Title>
									<Anchor
										size="xs"
										href={withFragment(
											`${coreDetails.docsLink}/importing.html`,
											match(deployImportSource)
												.with(ImportSource.Goodreads, () => "goodreads")
												.with(ImportSource.Mal, () => "myanimelist")
												.with(ImportSource.MediaTracker, () => "mediatracker")
												.with(ImportSource.Movary, () => "movary")
												.with(ImportSource.StoryGraph, () => "storygraph")
												.with(ImportSource.StrongApp, () => "strong-app")
												.with(ImportSource.Trakt, () => "trakt")
												.with(
													ImportSource.Audiobookshelf,
													() => "audiobookshelf",
												)
												.with(ImportSource.Imdb, () => "imdb")
												.with(ImportSource.Igdb, () => "igdb")
												.with(ImportSource.Jellyfin, () => "jellyfin")
												.with(ImportSource.GenericJson, () => "generic-json")
												.with(ImportSource.OpenScale, () => "open-scale")
												.with(undefined, () => "")
												.exhaustive(),
										)}
										target="_blank"
									>
										Docs
									</Anchor>
								</Flex>
								<Select
									id="import-source"
									label="Select a source"
									required
									data={Object.values(ImportSource).map((is) => ({
										label: changeCase(is),
										value: is,
									}))}
									onChange={(v) => {
										if (v) setDeployImportSource(v as ImportSource);
									}}
								/>
								{deployImportSource ? (
									<ImportSourceElement fetcher={fetcher} formRef={formRef}>
										{match(deployImportSource)
											.with(
												ImportSource.Audiobookshelf,
												ImportSource.MediaTracker,
												() => (
													<>
														<TextInput
															label="Instance Url"
															required
															name="apiUrl"
														/>
														<PasswordInput
															mt="sm"
															label="API Key"
															required
															name="apiKey"
														/>
													</>
												),
											)

											.with(
												ImportSource.OpenScale,
												ImportSource.Goodreads,
												ImportSource.Imdb,
												ImportSource.StoryGraph,
												() => (
													<>
														<FileInput
															label="CSV file"
															accept=".csv"
															required
															name="csvPath"
														/>
													</>
												),
											)
											.with(ImportSource.Trakt, () => (
												<>
													<TextInput
														label="Username"
														required
														name="username"
													/>
												</>
											))
											.with(ImportSource.Jellyfin, () => (
												<>
													<TextInput
														label="Instance Url"
														required
														name="apiUrl"
													/>
													<TextInput
														label="Username"
														required
														name="username"
													/>
													<PasswordInput
														mt="sm"
														label="Password"
														required
														name="password"
													/>
												</>
											))
											.with(ImportSource.Movary, () => (
												<>
													<FileInput
														label="History CSV file"
														accept=".csv"
														required
														name="history"
													/>
													<FileInput
														label="Ratings CSV file"
														accept=".csv"
														required
														name="ratings"
													/>
													<FileInput
														label="Watchlist CSV file"
														accept=".csv"
														required
														name="watchlist"
													/>
												</>
											))
											.with(ImportSource.Igdb, () => (
												<>
													<Select
														label="Collection"
														required
														name="collection"
														data={userCollections.map((c) => c.name)}
													/>
													<FileInput
														label="CSV File"
														accept=".csv"
														required
														name="csvPath"
													/>
												</>
											))
											.with(ImportSource.Mal, () => (
												<>
													<FileInput
														label="Anime export file"
														name="animePath"
													/>
													<FileInput
														label="Manga export file"
														name="mangaPath"
													/>
												</>
											))
											.with(ImportSource.StrongApp, () => (
												<>
													<FileInput
														label="CSV export file"
														accept=".csv"
														required
														name="exportPath"
													/>
													<JsonInput
														label="Mappings"
														required
														name="mapping"
														autosize
														minRows={10}
														defaultValue={JSON.stringify(
															[
																{
																	sourceName: "Bench Press (Barbell)",
																	targetName:
																		"Barbell Bench Press - Medium Grip",
																},
																{
																	sourceName: "Bicep Curl (Barbell)",
																	targetName: "Barbell Curl",
																},
															],
															null,
															4,
														)}
														description="This is an example. Every exercise must be mapped, otherwise the import will fail."
													/>
												</>
											))
											.with(ImportSource.GenericJson, () => (
												<>
													<FileInput
														label="JSON export file"
														accept=".json"
														required
														name="export"
													/>
												</>
											))
											.exhaustive()}
									</ImportSourceElement>
								) : null}
								<Divider />
								<Title order={3}>Import history</Title>
								{loaderData.importReports.length > 0 ? (
									<Accordion>
										{loaderData.importReports.map((report) => (
											<Accordion.Item
												value={report.id.toString()}
												key={report.id}
												data-import-report-id={report.id}
											>
												<Accordion.Control
													disabled={typeof report.wasSuccess !== "boolean"}
												>
													<Indicator
														inline
														size={12}
														offset={-3}
														processing={typeof report.wasSuccess !== "boolean"}
														color={
															typeof report.wasSuccess === "boolean"
																? report.wasSuccess
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
															<Text>
																Total imported: {report.details.import.total}
															</Text>
															<Text>
																Failed: {report.details.failedItems.length}
															</Text>
															{report.details.failedItems.length > 0 ? (
																<JsonInput
																	size="xs"
																	defaultValue={JSON.stringify(
																		report.details.failedItems,
																		null,
																		4,
																	)}
																	readOnly
																	autosize
																/>
															) : null}
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
						</fetcher.Form>
					</Tabs.Panel>
					<Tabs.Panel value="export">
						<Stack>
							<Flex justify="space-between" align="center">
								<Title order={2}>Export data</Title>
								<Group>
									<Anchor
										size="xs"
										href={`${coreDetails.docsLink}/guides/exporting.html`}
										target="_blank"
									>
										Docs
									</Anchor>
								</Group>
							</Flex>
							<Form
								method="POST"
								encType="multipart/form-data"
								action={withQuery("", { intent: "deployExport" })}
							>
								<MultiSelect
									name="toExport"
									label="Data to export"
									description="Multiple items can be selected"
									required
									data={Object.values(ExportItem).map((is) => ({
										label: changeCase(is),
										value: is,
									}))}
								/>
								<Tooltip
									label="Please enable file storage to use this feature"
									disabled={loaderData.coreEnabledFeatures.fileStorage}
								>
									<Button
										type="submit"
										variant="light"
										color="blue"
										fullWidth
										radius="md"
										mt="xs"
										disabled={!loaderData.coreEnabledFeatures.fileStorage}
									>
										Start job
									</Button>
								</Tooltip>
							</Form>
							<Divider />
							<Title order={3}>Export history</Title>
							{loaderData.userExports.length > 0 ? (
								<Stack>
									{loaderData.userExports.map((exp) => (
										<Box key={exp.startedAt} w="100%">
											<Group justify="space-between" wrap="nowrap">
												<Box>
													<Text>{exp.exported.map(changeCase).join(", ")}</Text>
													<Text size="xs" span c="dimmed">
														({dayjsLib(exp.endedAt).fromNow()})
													</Text>
												</Box>
												<Anchor href={exp.url} target="_blank" rel="noreferrer">
													<ThemeIcon color="blue" variant="transparent">
														<IconDownload />
													</ThemeIcon>
												</Anchor>
											</Group>
										</Box>
									))}
								</Stack>
							) : (
								<Text>You have not performed any exports</Text>
							)}
						</Stack>
					</Tabs.Panel>
				</Box>
			</Tabs>
		</Container>
	);
}

const ImportSourceElement = (props: {
	children: ReactNode | Array<ReactNode>;
	fetcher: FetcherWithComponents<unknown>;
	formRef: RefObject<HTMLFormElement>;
}) => {
	return (
		<>
			{props.children}
			<Button
				variant="light"
				color="blue"
				fullWidth
				mt="md"
				radius="md"
				onClick={async () => {
					const conf = await confirmWrapper({
						confirmation:
							"Are you sure you want to deploy an import job? This action is irreversible.",
					});
					if (conf) props.fetcher.submit(props.formRef.current);
				}}
			>
				Import
			</Button>
		</>
	);
};
