import {
	ActionIcon,
	Alert,
	Anchor,
	Box,
	Button,
	Container,
	CopyButton,
	FileInput,
	Flex,
	Group,
	JsonInput,
	PasswordInput,
	Progress,
	Select,
	Stack,
	Tabs,
	TextInput,
	Title,
	Tooltip,
} from "@mantine/core";
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
} from "@remix-run/node";
import { Form, Link, useActionData } from "@remix-run/react";
import {
	DeployImportJobDocument,
	GenerateAuthTokenDocument,
	ImportSource,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useState } from "react";
import { $path } from "remix-routes";
import { namedAction } from "remix-utils/named-action";
import { match } from "ts-pattern";
import { z } from "zod";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { uploadFileToServiceAndGetPath } from "~/lib/utilities";
import { processSubmission } from "~/lib/utilities.server";

export const loader = async (_args: LoaderFunctionArgs) => {
	return json({});
};

export const meta: MetaFunction = () => {
	return [{ title: "Imports and Exports | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		generateAuthToken: async () => {
			const { generateAuthToken } = await gqlClient.request(
				GenerateAuthTokenDocument,
				undefined,
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", generateAuthToken } as const);
		},
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
				.with(ImportSource.MediaJson, async () => ({
					mediaJson: processSubmission(formData, mediaJsonImportFormSchema),
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
			return json({ status: "success", generateAuthToken: false } as const);
		},
	});
};

const mediaTrackerImportFormSchema = z.object({
	apiUrl: z.string().url(),
	apiKey: z.string(),
});

const traktImportFormSchema = z.object({ username: z.string() });

const goodreadsImportFormSchema = z.object({ rssUrl: z.string().url() });

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

const mediaJsonImportFormSchema = z.object({ export: z.string() });

const malImportFormSchema = z.object({
	animePath: z.string(),
	mangaPath: z.string(),
});

export default function Page() {
	const actionData = useActionData<typeof action>();
	const [deployImportSource, setDeployImportSource] = useState<ImportSource>();
	const [progress, setProgress] = useState<number | null>(null);

	const [movaryRatingPath, setMovaryRatingPath] = useState("");
	const [movaryHistoryPath, setMovaryHistoryPath] = useState("");
	const [movaryWatchlistPath, setMovaryWatchlistPath] = useState("");

	const onProgress = (event: ProgressEvent<XMLHttpRequestEventTarget>) =>
		setProgress((event.loaded / event.total) * 100);
	const onLoad = () => setProgress(null);

	return (
		<Container size="xs">
			<Tabs defaultValue="import">
				<Tabs.List>
					<Tabs.Tab value="import">Import</Tabs.Tab>
					<Tabs.Tab value="export">Export</Tabs.Tab>
				</Tabs.List>
				<Box mt="xl">
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
							<Form method="post" action="?intent=generateAuthToken">
								<Button
									variant="light"
									color="indigo"
									radius="md"
									type="submit"
									fullWidth
								>
									Create auth token
								</Button>
							</Form>
							{actionData?.generateAuthToken ? (
								<Box>
									<Alert
										title="This token will be shown only once"
										color="yellow"
									>
										<Flex align="center">
											<CopyButton value={actionData.generateAuthToken}>
												{({ copied, copy }) => (
													<Tooltip
														label={copied ? "Copied" : "Copy"}
														withArrow
														position="right"
													>
														<ActionIcon
															color={copied ? "teal" : "gray"}
															onClick={copy}
														>
															{copied ? (
																<IconCheck size={16} />
															) : (
																<IconCopy size={16} />
															)}
														</ActionIcon>
													</Tooltip>
												)}
											</CopyButton>
											<TextInput
												defaultValue={actionData.generateAuthToken}
												readOnly
												style={{ flex: 1 }}
											/>
										</Flex>
									</Alert>
								</Box>
							) : undefined}
						</Stack>
					</Tabs.Panel>
					<Tabs.Panel value="import">
						<Box
							component={Form}
							onSubmit={async (e) => {
								if (
									!confirm(
										"Are you sure you want to deploy an import job? This action is irreversible.",
									)
								)
									e.preventDefault();
							}}
							method="post"
							action="?intent=deployImport"
						>
							<input hidden name="source" defaultValue={deployImportSource} />
							<Stack>
								<Flex justify="space-between" align="center">
									<Title order={2}>Import data</Title>
									<Group>
										<Anchor
											to={$path("/settings/imports-and-exports/reports")}
											component={Link}
											size="xs"
										>
											Reports
										</Anchor>
										<Anchor
											size="xs"
											href={`https://ignisda.github.io/ryot/importing.html#${match(
												deployImportSource,
											)
												.with(ImportSource.Goodreads, () => "goodreads")
												.with(ImportSource.Mal, () => "myanimelist")
												.with(ImportSource.MediaJson, () => "media-json")
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
									</Group>
								</Flex>
								{progress ? (
									<Progress
										value={progress}
										striped
										// TODO: Bring this back when mantine supports it
										// animate
										size="sm"
										color="orange"
									/>
								) : undefined}
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
									<ImportSourceElement>
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
													<TextInput label="RSS URL" required name="rssUrl" />
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
													/>
													<input
														hidden
														name="ratings"
														value={movaryRatingPath}
													/>
													<input
														hidden
														name="watchlist"
														value={movaryWatchlistPath}
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
													<FileInput
														label="CSV export file"
														accept=".csv"
														required
														name="export"
													/>
												</>
											))
											.with(ImportSource.MediaJson, () => (
												<>
													<FileInput
														label="JSON export file"
														accept=".json"
														required
														name="export"
													/>
												</>
											))
											.with(ImportSource.Mal, () => (
												<>
													<FileInput
														label="Anime export file"
														required
														onChange={async (file) => {
															if (file) {
																const path = await uploadFile(file);
																malImportForm.setFieldValue("animePath", path);
															}
														}}
														name="animePath"
													/>
													<FileInput
														label="Manga export file"
														required
														onChange={async (file) => {
															if (file) {
																const path = await uploadFile(file);
																malImportForm.setFieldValue("mangaPath", path);
															}
														}}
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
														onChange={async (file) => {
															if (file) {
																const path = await uploadFile(file);
																strongAppImportForm.setFieldValue(
																	"exportPath",
																	path,
																);
															}
														}}
													/>
													<JsonInput label="Mappings" required name="mapping" />
												</>
											))
											.exhaustive()}
									</ImportSourceElement>
								) : undefined}
							</Stack>
						</Box>
					</Tabs.Panel>
				</Box>
			</Tabs>
		</Container>
	);
}

export const ImportSourceElement = (props: {
	children: JSX.Element | JSX.Element[];
}) => {
	return (
		<>
			{props.children}
			<Button
				variant="light"
				color="blue"
				fullWidth
				mt="md"
				type="submit"
				radius="md"
			>
				Import
			</Button>
		</>
	);
};
