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
	PasswordInput,
	Progress,
	Select,
	Stack,
	Tabs,
	TextInput,
	Title,
	Tooltip,
} from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
} from "@remix-run/node";
import { Form, Link, useActionData } from "@remix-run/react";
import {
	GenerateAuthTokenDocument,
	ImportSource,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, cloneDeep } from "@ryot/ts-utils";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { produce } from "immer";
import { parse } from "postcss";
import { useState } from "react";
import { $path } from "remix-routes";
import { namedAction } from "remix-utils/named-action";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { createToastHeaders } from "~/lib/toast.server";
import { fileToText } from "~/lib/utilities";
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
	});
};

const deleteSchema = z.object({
	integrationId: zx.NumAsString,
});

export default function Page() {
	const actionData = useActionData<typeof action>();
	const [deployImportSource, setDeployImportSource] = useState<ImportSource>();
	const [progress, setProgress] = useState<number | null>(null);
	const clipboard = useClipboard();

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
											/>
										</Flex>
									</Alert>
								</Box>
							) : undefined}
						</Stack>
					</Tabs.Panel>
					<Tabs.Panel value="import">
						<Box
							component="form"
							onSubmit={async (e) => {
								e.preventDefault();
								const yes = confirm(
									"Are you sure you want to deploy an import job? This action is irreversible.",
								);
								if (yes) {
									if (deployImportSource) {
										const values = await match(deployImportSource)
											.with(ImportSource.Goodreads, () => ({
												goodreads: goodreadsImportForm.values,
											}))
											.with(ImportSource.Trakt, () => ({
												trakt: traktImportForm.values,
											}))
											.with(ImportSource.MediaTracker, () => ({
												mediaTracker: mediaTrackerImportForm.values,
											}))
											.with(ImportSource.Movary, async () => ({
												movary: {
													ratings: await fileToText(
														movaryImportForm.values.ratings,
													),
													history: await fileToText(
														movaryImportForm.values.history,
													),
													watchlist: await fileToText(
														movaryImportForm.values.watchlist,
													),
												},
											}))
											.with(ImportSource.StoryGraph, async () => ({
												storyGraph: {
													export: await fileToText(
														storyGraphImportForm.values.export,
													),
												},
											}))
											.with(ImportSource.MediaJson, async () => ({
												mediaJson: {
													export: await fileToText(
														mediaJsonImportForm.values.export,
													),
												},
											}))
											.with(ImportSource.Mal, async () => ({
												mal: {
													animePath: malImportForm.values.mangaPath,
													mangaPath: malImportForm.values.mangaPath,
												},
											}))
											.with(ImportSource.StrongApp, async () => {
												const newExercises = cloneDeep(uniqueExercises);
												newExercises.forEach((e) => (e.targetId = undefined));
												clipboard.copy(JSON.stringify(newExercises));
												notifications.show({
													title: "Important",
													autoClose: false,
													color: "yellow",
													message:
														"Mappings have been copied to your clipboard. Please paste them into a JSON file and store it securely. You might need it later.",
												});
												return {
													strongApp: {
														exportPath: strongAppImportForm.values.exportPath,
														// biome-ignore lint/suspicious/noExplicitAny: required here
														mapping: newExercises as any,
													},
												};
											})
											.exhaustive();
										if (values) {
											deployImportJob.mutate({
												input: {
													source: deployImportSource,
													...values,
												},
											});
										}
									}
								}
							}}
						>
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
														{...mediaTrackerImportForm.getInputProps("apiUrl")}
													/>
													<PasswordInput
														mt="sm"
														label="API Key"
														required
														{...mediaTrackerImportForm.getInputProps("apiKey")}
													/>
												</>
											))
											.with(ImportSource.Goodreads, () => (
												<>
													<TextInput
														label="RSS URL"
														required
														{...goodreadsImportForm.getInputProps("rssUrl")}
													/>
												</>
											))
											.with(ImportSource.Trakt, () => (
												<>
													<TextInput
														label="Username"
														required
														{...traktImportForm.getInputProps("username")}
													/>
												</>
											))
											.with(ImportSource.Movary, () => (
												<>
													<FileInput
														label="History CSV file"
														accept=".csv"
														required
														{...movaryImportForm.getInputProps("history")}
													/>
													<FileInput
														label="Ratings CSV file"
														accept=".csv"
														required
														{...movaryImportForm.getInputProps("ratings")}
													/>
													<FileInput
														label="Watchlist CSV file"
														accept=".csv"
														required
														{...movaryImportForm.getInputProps("watchlist")}
													/>
												</>
											))
											.with(ImportSource.StoryGraph, () => (
												<>
													<FileInput
														label="CSV export file"
														accept=".csv"
														required
														{...storyGraphImportForm.getInputProps("export")}
													/>
												</>
											))
											.with(ImportSource.MediaJson, () => (
												<>
													<FileInput
														label="JSON export file"
														accept=".json"
														required
														{...mediaJsonImportForm.getInputProps("export")}
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
																const clonedFile = new File([file], file.name, {
																	type: file.type,
																});
																const text = await fileToText(clonedFile);
																const csvText: {
																	"Exercise Name": string;
																}[] = parse(text, {
																	columns: true,
																	skip_empty_lines: true,
																	delimiter: ";",
																});
																const exerciseNames = new Set(
																	csvText.map((s) => s["Exercise Name"].trim()),
																);
																setUniqueExercises(
																	[...exerciseNames]
																		.toSorted()
																		.map((e) => ({ sourceName: e })),
																);
																const path = await uploadFile(file);
																strongAppImportForm.setFieldValue(
																	"exportPath",
																	path,
																);
															}
														}}
													/>
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
