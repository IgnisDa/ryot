import { CodeHighlight } from "@mantine/code-highlight";
import {
	Accordion,
	ActionIcon,
	Anchor,
	Box,
	Button,
	Container,
	Divider,
	FileInput,
	Flex,
	Group,
	Indicator,
	Progress,
	Select,
	Stack,
	Tabs,
	Text,
	TextInput,
	ThemeIcon,
	Title,
	Tooltip,
} from "@mantine/core";
import { parseFormData } from "@mjackson/form-data-parser";
import {
	DeployExportJobDocument,
	DeployImportJobDocument,
	ImportReportsDocument,
	ImportSource,
	UserExportsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	getActionIntent,
	kebabCase,
	processSubmission,
} from "@ryot/ts-utils";
import { IconDownload, IconTrash } from "@tabler/icons-react";
import { filesize } from "filesize";
import { useState } from "react";
import { Form, useLoaderData } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withFragment, withQuery } from "ufo";
import { z } from "zod";
import { dayjsLib, openConfirmationModal } from "~/lib/generals";
import {
	useApplicationEvents,
	useConfirmSubmit,
	useCoreDetails,
	useUserCollectionsToDisplay,
} from "~/lib/hooks";
import {
	createToastHeaders,
	serverGqlService,
	temporaryFileUploadHandler,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.settings.imports-and-exports._index";

export const loader = async ({ request }: Route.LoaderArgs) => {
	const [{ importReports }, { userExports }] = await Promise.all([
		serverGqlService.authenticatedRequest(request, ImportReportsDocument, {}),
		serverGqlService.authenticatedRequest(request, UserExportsDocument, {}),
	]);
	return { importReports, userExports };
};

export const meta = () => {
	return [{ title: "Imports and Exports | Ryot" }];
};

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await parseFormData(
		request.clone(),
		temporaryFileUploadHandler,
	);
	const intent = getActionIntent(request);
	return await match(intent)
		.with("deployImport", async () => {
			const source = formData.get("source") as ImportSource;
			formData.delete("source");
			const values = await match(source)
				.with(
					ImportSource.Hevy,
					ImportSource.Imdb,
					ImportSource.OpenScale,
					ImportSource.Goodreads,
					ImportSource.Storygraph,
					() => ({
						genericCsv: processSubmission(formData, genericCsvImportFormSchema),
					}),
				)
				.with(
					ImportSource.Plex,
					ImportSource.Mediatracker,
					ImportSource.Audiobookshelf,
					() => ({
						urlAndKey: processSubmission(formData, urlAndKeyImportFormSchema),
					}),
				)
				.with(ImportSource.StrongApp, () => ({
					strongApp: processSubmission(formData, strongAppImportFormSchema),
				}))
				.with(ImportSource.Trakt, () => ({
					trakt: processSubmission(formData, usernameImportFormSchema),
				}))
				.with(ImportSource.Movary, async () => ({
					movary: processSubmission(formData, movaryImportFormSchema),
				}))
				.with(ImportSource.Myanimelist, async () => ({
					mal: processSubmission(formData, malImportFormSchema),
				}))
				.with(ImportSource.GenericJson, ImportSource.Anilist, async () => ({
					genericJson: processSubmission(formData, jsonImportFormSchema),
				}))
				.with(ImportSource.Jellyfin, async () => ({
					jellyfin: processSubmission(formData, jellyfinImportFormSchema),
				}))
				.with(ImportSource.Igdb, async () => ({
					igdb: processSubmission(formData, igdbImportFormSchema),
				}))
				.exhaustive();
			await serverGqlService.authenticatedRequest(
				request,
				DeployImportJobDocument,
				{ input: { source, ...values } },
			);
			return Response.json({ status: "success" } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Import job started in the background",
				}),
			});
		})
		.with("deployExport", async () => {
			await serverGqlService.authenticatedRequest(
				request,
				DeployExportJobDocument,
				{},
			);
			return Response.json({ status: "success" } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Export job started in the background",
				}),
			});
		})
		.run();
};

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

const strongAppImportFormSchema = z.object({ dataExportPath: z.string() });

const igdbImportFormSchema = z
	.object({ collection: z.string() })
	.merge(genericCsvImportFormSchema);

const movaryImportFormSchema = z.object({
	ratings: z.string(),
	history: z.string(),
	watchlist: z.string(),
});

const jsonImportFormSchema = z.object({ export: z.string() });

const malImportFormSchema = z.object({
	animePath: z.string().optional(),
	mangaPath: z.string().optional(),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const submit = useConfirmSubmit();
	const fileUploadNotAllowed = !coreDetails.fileStorageEnabled;
	const userCollections = useUserCollectionsToDisplay();
	const events = useApplicationEvents();
	const [deployImportSource, setDeployImportSource] = useState<ImportSource>();

	return (
		<Container size="xs">
			<Tabs defaultValue="import">
				<Tabs.List>
					<Tabs.Tab value="import">Import</Tabs.Tab>
					<Tabs.Tab value="export">Export</Tabs.Tab>
				</Tabs.List>
				<Box mt="xl">
					<Tabs.Panel value="import">
						<Form
							method="POST"
							encType="multipart/form-data"
							action={withQuery(".", { intent: "deployImport" })}
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
										target="_blank"
										href={withFragment(
											`${coreDetails.docsLink}/importing.html`,
											deployImportSource ? kebabCase(deployImportSource) : "",
										)}
									>
										Docs
									</Anchor>
								</Flex>
								<Select
									required
									searchable
									id="import-source"
									label="Select a source"
									onChange={(v) => {
										if (v) setDeployImportSource(v as ImportSource);
									}}
									data={Object.values(ImportSource).map((is) => ({
										label: changeCase(is),
										value: is,
									}))}
								/>
								{deployImportSource ? (
									<>
										{match(deployImportSource)
											.with(
												ImportSource.Plex,
												ImportSource.Mediatracker,
												ImportSource.Audiobookshelf,
												() => (
													<>
														<TextInput
															label="Instance Url"
															required
															name="apiUrl"
														/>
														<TextInput
															mt="sm"
															label="API Key"
															required
															name="apiKey"
														/>
													</>
												),
											)
											.with(
												ImportSource.Hevy,
												ImportSource.Imdb,
												ImportSource.OpenScale,
												ImportSource.Goodreads,
												ImportSource.Storygraph,
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
											.with(ImportSource.StrongApp, () => (
												<>
													<FileInput
														required
														accept=".csv"
														label="CSV file"
														name="dataExportPath"
													/>
												</>
											))
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
													<TextInput
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
											.with(ImportSource.Myanimelist, () => (
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
											.with(
												ImportSource.Anilist,
												ImportSource.GenericJson,
												() => (
													<>
														<FileInput
															label="JSON export file"
															accept=".json"
															required
															name="export"
														/>
													</>
												),
											)
											.exhaustive()}
										<Button
											mt="md"
											fullWidth
											radius="md"
											color="blue"
											type="submit"
											variant="light"
											onClick={(e) => {
												const form = e.currentTarget.form;
												e.preventDefault();
												openConfirmationModal(
													"Are you sure you want to deploy an import job? This action is irreversible.",
													() => submit(form),
												);
											}}
										>
											Import
										</Button>
									</>
								) : null}
								<Divider />
								<Title order={3}>Import history</Title>
								{loaderData.importReports.length > 0 ? (
									<Accordion>
										{loaderData.importReports.map((report) => {
											const isInProgress =
												typeof report.wasSuccess !== "boolean";

											return (
												<Accordion.Item
													key={report.id}
													value={report.id}
													data-import-report-id={report.id}
												>
													<Accordion.Control disabled={isInProgress}>
														<Stack gap="xs">
															<Box>
																<Indicator
																	inline
																	size={12}
																	offset={-3}
																	processing={isInProgress}
																	color={
																		isInProgress
																			? undefined
																			: report.wasSuccess
																				? "green"
																				: "red"
																	}
																>
																	{changeCase(report.source)}{" "}
																	<Text size="xs" span c="dimmed">
																		({dayjsLib(report.startedOn).fromNow()})
																	</Text>
																</Indicator>
															</Box>
															{isInProgress && report.progress ? (
																<>
																	<Box>
																		<Text span fw="bold" mr={4}>
																			Estimated to finish at:
																		</Text>
																		{dayjsLib(
																			report.estimatedFinishTime,
																		).format("lll")}
																	</Box>
																	<Progress
																		animated
																		value={Number(report.progress)}
																	/>
																</>
															) : null}
														</Stack>
													</Accordion.Control>
													<Accordion.Panel
														styles={{ content: { paddingTop: 0 } }}
													>
														<Stack>
															<Box>
																<Group>
																	{report.details ? (
																		<Box>
																			<Text span fw="bold" mr={4}>
																				Total imported:
																			</Text>
																			{report.details.import.total},
																		</Box>
																	) : null}
																	<Box>
																		<Text span fw="bold" mr={4}>
																			Started at:
																		</Text>
																		{dayjsLib(report.startedOn).format("lll")}
																	</Box>
																</Group>
																<Group>
																	<Box>
																		{report.finishedOn ? (
																			<>
																				<Text span fw="bold" mr={4}>
																					Finished on:
																				</Text>
																				{dayjsLib(report.finishedOn).format(
																					"lll",
																				)}
																			</>
																		) : null}
																	</Box>
																	{report.details ? (
																		<Box>
																			<Text span fw="bold" mr={4}>
																				Failed:
																			</Text>
																			{report.details.failedItems.length}
																		</Box>
																	) : null}
																</Group>
															</Box>
															{report.details &&
															report.details.failedItems.length > 0 ? (
																<CodeHighlight
																	mah={400}
																	language="json"
																	style={{ overflow: "scroll" }}
																	code={JSON.stringify(
																		report.details.failedItems,
																		null,
																		2,
																	)}
																/>
															) : null}
														</Stack>
													</Accordion.Panel>
												</Accordion.Item>
											);
										})}
									</Accordion>
								) : (
									<Text>You have not performed any imports</Text>
								)}
							</Stack>
						</Form>
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
								action={withQuery(".", { intent: "deployExport" })}
							>
								<input
									hidden
									name="dummy"
									defaultValue="this is required because of the encType"
								/>
								<Tooltip
									label="Please enable file storage to use this feature"
									disabled={!fileUploadNotAllowed}
								>
									<Button
										mt="xs"
										fullWidth
										radius="md"
										color="blue"
										type="submit"
										variant="light"
										disabled={fileUploadNotAllowed}
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
												<Group gap="xs">
													<Text span size="lg">
														{changeCase(dayjsLib(exp.endedAt).fromNow())}
													</Text>
													<Text span size="xs" c="dimmed">
														({filesize(exp.size)})
													</Text>
												</Group>
												<Group>
													<Anchor
														href={exp.url}
														target="_blank"
														rel="noreferrer"
													>
														<ThemeIcon color="blue" variant="transparent">
															<IconDownload />
														</ThemeIcon>
													</Anchor>
													<Form
														method="POST"
														action={withQuery($path("/actions"), {
															intent: "deleteS3Asset",
														})}
													>
														<input hidden name="key" defaultValue={exp.key} />
														<ActionIcon
															color="red"
															type="submit"
															variant="transparent"
															onClick={(e) => {
																const form = e.currentTarget.form;
																e.preventDefault();
																openConfirmationModal(
																	"Are you sure you want to delete this export? This action is irreversible.",
																	() => submit(form),
																);
															}}
														>
															<IconTrash />
														</ActionIcon>
													</Form>
												</Group>
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
