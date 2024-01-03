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
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
} from "@remix-run/node";
import {
	FetcherWithComponents,
	Form,
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
import { ReactNode, RefObject, useRef, useState } from "react";
import { namedAction } from "remix-utils/named-action";
import { match } from "ts-pattern";
import { z } from "zod";
import { confirmWrapper } from "~/components/confirmation";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { dayjsLib, uploadFileToServiceAndGetPath } from "~/lib/generals";
import { getCoreEnabledFeatures } from "~/lib/graphql.server";
import { createToastHeaders } from "~/lib/toast.server";
import { processSubmission } from "~/lib/utilities.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [coreEnabledFeatures, { importReports }, { userExports }] =
		await Promise.all([
			getCoreEnabledFeatures(),
			gqlClient.request(
				ImportReportsDocument,
				undefined,
				await getAuthorizationHeader(request),
			),
			gqlClient.request(
				UserExportsDocument,
				undefined,
				await getAuthorizationHeader(request),
			),
		]);
	return json({ coreEnabledFeatures, importReports, userExports });
};

export const meta: MetaFunction = () => {
	return [{ title: "Imports and Exports | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		deployImport: async () => {
			const source = formData.get("source") as ImportSource;
			const values = await match(source)
				.with(ImportSource.Goodreads, () => ({
					goodreads: processSubmission(formData, goodreadsImportFormSchema),
				}))
				.with(ImportSource.Trakt, () => ({
					trakt: processSubmission(formData, traktImportFormSchema),
				}))
				.with(ImportSource.MediaTracker, () => ({
					mediaTracker: processSubmission(
						formData,
						mediaTrackerImportFormSchema,
					),
				}))
				.with(ImportSource.Movary, async () => ({
					movary: processSubmission(formData, movaryImportFormSchema),
				}))
				.with(ImportSource.StoryGraph, async () => ({
					storyGraph: processSubmission(formData, storyGraphImportFormSchema),
				}))
				.with(ImportSource.GenericJson, async () => ({
					genericJson: processSubmission(formData, genericJsonImportFormSchema),
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
				.exhaustive();
			await gqlClient.request(
				DeployImportJobDocument,
				{ input: { source, ...values } },
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", generateAuthToken: false } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Import job started in the background",
				}),
			});
		},
		deployExport: async () => {
			const toExport = processSubmission(formData, deployExportForm);
			await gqlClient.request(
				DeployExportJobDocument,
				toExport,
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", generateAuthToken: false } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Export job started in the background",
				}),
			});
		},
	});
};

const mediaTrackerImportFormSchema = z.object({
	apiUrl: z.string().url(),
	apiKey: z.string(),
});

const traktImportFormSchema = z.object({ username: z.string() });

const goodreadsImportFormSchema = z.object({ csvPath: z.string() });

const movaryImportFormSchema = z.object({
	ratings: z.string(),
	history: z.string(),
	watchlist: z.string(),
});

const storyGraphImportFormSchema = z.object({ export: z.string() });

const strongAppImportFormSchema = z.object({
	exportPath: z.string(),
	mapping: z.string(),
});

const genericJsonImportFormSchema = z.object({ export: z.string() });

const malImportFormSchema = z.object({
	animePath: z.string(),
	mangaPath: z.string(),
});

const deployExportForm = z.object({
	toExport: z.string().transform((v) => v.split(",") as ExportItem[]),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [deployImportSource, setDeployImportSource] = useState<ImportSource>();
	const [progress, setProgress] = useState<number | null>(null);

	const [movaryRatingPath, setMovaryRatingPath] = useState("");
	const [movaryHistoryPath, setMovaryHistoryPath] = useState("");
	const [movaryWatchlistPath, setMovaryWatchlistPath] = useState("");

	const [goodreadsCsvPath, setGoodreadsCsvPath] = useState("");

	const [storyGraphExportPath, setStoryGraphExportPath] = useState("");

	const [genericJsonExportPath, setGenericJsonExportPath] = useState("");

	const [malAnimePath, setMalAnimePath] = useState("");
	const [malMangaPath, setMalMangaPath] = useState("");

	const [strongAppExportPath, setStrongAppExportPath] = useState("");

	const onProgress = (event: ProgressEvent<XMLHttpRequestEventTarget>) =>
		setProgress((event.loaded / event.total) * 100);
	const onLoad = () => setProgress(null);
	const fetcher = useFetcher();
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
							method="post"
							action="?intent=deployImport"
							ref={formRef}
						>
							<input hidden name="source" defaultValue={deployImportSource} />
							<Stack>
								<Flex justify="space-between" align="center">
									<Title order={2}>Import data</Title>
									<Anchor
										size="xs"
										href={`https://ignisda.github.io/ryot/importing.html#${match(
											deployImportSource,
										)
											.with(ImportSource.Goodreads, () => "goodreads")
											.with(ImportSource.Mal, () => "myanimelist")
											.with(ImportSource.GenericJson, () => "generic-json")
											.with(ImportSource.MediaTracker, () => "mediatracker")
											.with(ImportSource.Movary, () => "movary")
											.with(ImportSource.StoryGraph, () => "storygraph")
											.with(ImportSource.StrongApp, () => "strong-app")
											.with(ImportSource.Trakt, () => "trakt")
											.otherwise(() => "")}`}
										target="_blank"
									>
										Docs
									</Anchor>
								</Flex>
								{progress ? (
									<Progress value={progress} striped size="sm" color="orange" />
								) : null}
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
											.with(ImportSource.MediaTracker, () => (
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
											))
											.with(ImportSource.Goodreads, () => (
												<>
													<input
														hidden
														name="csvPath"
														value={goodreadsCsvPath}
														readOnly
													/>
													<FileInput
														label="CSV file"
														accept=".csv"
														required
														onChange={async (file) => {
															if (file) {
																const path =
																	await uploadFileToServiceAndGetPath(
																		file,
																		onProgress,
																		onLoad,
																	);
																setGoodreadsCsvPath(path);
															}
														}}
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
											.with(ImportSource.Movary, () => (
												<>
													<input
														hidden
														name="history"
														value={movaryHistoryPath}
														readOnly
													/>
													<input
														hidden
														name="ratings"
														value={movaryRatingPath}
														readOnly
													/>
													<input
														hidden
														name="watchlist"
														value={movaryWatchlistPath}
														readOnly
													/>
													<FileInput
														label="History CSV file"
														accept=".csv"
														required
														onChange={async (file) => {
															if (file) {
																const path =
																	await uploadFileToServiceAndGetPath(
																		file,
																		onProgress,
																		onLoad,
																	);
																setMovaryHistoryPath(path);
															}
														}}
													/>
													<FileInput
														label="Ratings CSV file"
														accept=".csv"
														required
														onChange={async (file) => {
															if (file) {
																const path =
																	await uploadFileToServiceAndGetPath(
																		file,
																		onProgress,
																		onLoad,
																	);
																setMovaryRatingPath(path);
															}
														}}
													/>
													<FileInput
														label="Watchlist CSV file"
														accept=".csv"
														required
														onChange={async (file) => {
															if (file) {
																const path =
																	await uploadFileToServiceAndGetPath(
																		file,
																		onProgress,
																		onLoad,
																	);
																setMovaryWatchlistPath(path);
															}
														}}
													/>
												</>
											))
											.with(ImportSource.StoryGraph, () => (
												<>
													<input
														hidden
														name="export"
														value={storyGraphExportPath}
														readOnly
													/>
													<FileInput
														label="CSV export file"
														accept=".csv"
														required
														onChange={async (file) => {
															if (file) {
																const path =
																	await uploadFileToServiceAndGetPath(
																		file,
																		onProgress,
																		onLoad,
																	);
																setStoryGraphExportPath(path);
															}
														}}
													/>
												</>
											))
											.with(ImportSource.GenericJson, () => (
												<>
													<input
														hidden
														name="export"
														value={genericJsonExportPath}
														readOnly
													/>
													<FileInput
														label="JSON export file"
														accept=".json"
														required
														onChange={async (file) => {
															if (file) {
																const path =
																	await uploadFileToServiceAndGetPath(
																		file,
																		onProgress,
																		onLoad,
																	);
																setGenericJsonExportPath(path);
															}
														}}
													/>
												</>
											))
											.with(ImportSource.Mal, () => (
												<>
													<input
														hidden
														name="animePath"
														value={malAnimePath}
														readOnly
													/>
													<input
														hidden
														name="mangaPath"
														value={malMangaPath}
														readOnly
													/>
													<FileInput
														label="Anime export file"
														required
														onChange={async (file) => {
															if (file) {
																const path =
																	await uploadFileToServiceAndGetPath(
																		file,
																		onProgress,
																		onLoad,
																	);
																setMalAnimePath(path);
															}
														}}
													/>
													<FileInput
														label="Manga export file"
														required
														onChange={async (file) => {
															if (file) {
																const path =
																	await uploadFileToServiceAndGetPath(
																		file,
																		onProgress,
																		onLoad,
																	);
																setMalMangaPath(path);
															}
														}}
													/>
												</>
											))
											.with(ImportSource.StrongApp, () => (
												<>
													<input
														hidden
														name="exportPath"
														value={strongAppExportPath}
														readOnly
													/>
													<FileInput
														label="CSV export file"
														accept=".csv"
														required
														onChange={async (file) => {
															if (file) {
																const path =
																	await uploadFileToServiceAndGetPath(
																		file,
																		onProgress,
																		onLoad,
																	);
																setStrongAppExportPath(path);
															}
														}}
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
											>
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
										href="https://ignisda.github.io/ryot/guides/exporting.html"
										target="_blank"
									>
										Docs
									</Anchor>
								</Group>
							</Flex>
							<Form action="?intent=deployExport" method="post">
								<MultiSelect
									name="toExport"
									label="Export to JSON"
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
								<Stack mx="xs">
									{loaderData.userExports.map((exp) => (
										<Box key={exp.startedAt} w="100%">
											<Group justify="space-between">
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
	children: ReactNode | ReactNode[];
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
