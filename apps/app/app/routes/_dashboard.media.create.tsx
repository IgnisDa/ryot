import {
	Anchor,
	Box,
	Button,
	Code,
	Container,
	FileInput,
	Group,
	JsonInput,
	NumberInput,
	ScrollArea,
	Select,
	Stack,
	Switch,
	TextInput,
	Textarea,
	Title,
} from "@mantine/core";
import { useListState } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
	MetadataLot,
	MetadataSource,
} from "@ryot/generated/graphql/backend/graphql";
import { camelCase } from "@ryot/ts-utils";
import { IconCalendar, IconPhoto, IconVideo } from "@tabler/icons-react";
import { MediaDetailsLayout } from "~/components/common";
import { getCoreEnabledFeatures } from "~/lib/graphql.server";
import { uploadFileAndGetKey } from "~/lib/utilities";

export const loader = async (_args: LoaderFunctionArgs) => {
	const [coreEnabledFeatures] = await Promise.all([getCoreEnabledFeatures()]);
	return json({ coreEnabledFeatures });
};

export const meta: MetaFunction = () => {
	return [{ title: "Create Media | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [imageUrls, setImageUrls] = useListState<string>([]);
	const [videoUrls, setVideoUrls] = useListState<string>([]);

	const fileUploadNowAllowed = !loaderData.coreEnabledFeatures.fileStorage;

	const uploadFiles = async (files: File[], to: "image" | "video") => {
		if (files.length > 0) {
			for (const file of files) {
				const uploadedKey = await uploadFileAndGetKey(
					file.name,
					file.type,
					await file.arrayBuffer(),
				);
				if (to === "image") setImageUrls.append(uploadedKey);
				else if (to === "video") setVideoUrls.append(uploadedKey);
			}
			notifications.show({
				title: "Success",
				message: `Uploaded ${files.length} files`,
			});
		}
	};

	return (
		<Container>
			<MediaDetailsLayout
				images={imageUrls}
				externalLink={{ source: MetadataSource.Custom }}
			>
				<ScrollArea.Autosize mah={400}>
					<Box
						component="form"
						onSubmit={(values) => {
							// biome-ignore lint/suspicious/noExplicitAny: required
							const input: any = {
								...values,
								images,
								videos,
								[`${camelCase(values.lot)}Specifics`]: JSON.parse(
									values.specifics || "{}",
								),
							};
							input.specifics = undefined;
							input.genres = input.genres?.split(", ");
							input.creators = input.creators?.split(", ");
							createCustomMedia.mutate({ input });
						}}
					>
						<Stack>
							<Title>Create Media</Title>
							<TextInput label="Title" required autoFocus name="title" />
							<Group>
								<Select
									label="Type"
									data={Object.values(MetadataLot)}
									required
									name="lot"
								/>
								<Switch mt="md" label="Is it NSFW?" name="isNsfw" />
							</Group>
							<JsonInput
								label="Specifics"
								formatOnBlur
								required
								name="specifics"
								description={
									<>
										Please search for <Code>Specifics</Code> inputs at the{" "}
										<Anchor
											href="/graphql"
											size="xs"
											target="_blank"
											rel="noopener noreferrer"
										>
											graphql endpoint
										</Anchor>{" "}
										for the required JSON structure
									</>
								}
							/>
							<Textarea
								label="Description"
								description="Markdown is supported"
								name="description"
							/>
							<input hidden value={imageUrls} name="images" />
							<FileInput
								label="Images"
								multiple
								disabled={fileUploadNowAllowed}
								description={
									fileUploadNowAllowed &&
									"Please set the S3 variables required to enable file uploading"
								}
								onChange={(f) => uploadFiles(f, "image")}
								accept="image/png,image/jpeg,image/jpg"
								leftSection={<IconPhoto />}
							/>
							<input hidden value={videoUrls} name="videos" />
							<FileInput
								label="Videos"
								multiple
								disabled={fileUploadNowAllowed}
								description={
									fileUploadNowAllowed &&
									"Please set the S3 variables required to enable file uploading"
								}
								onChange={(f) => uploadFiles(f, "video")}
								accept="video/mp4,video/x-m4v,video/*"
								leftSection={<IconVideo />}
							/>
							<NumberInput
								label="Publish year"
								leftSection={<IconCalendar />}
								name="publishYear"
							/>
							<TextInput
								label="Creators"
								placeholder="Comma separated names"
								name="creators"
							/>
							<TextInput
								label="Genres"
								placeholder="Comma separated values"
								name="genres"
							/>
							<Button type="submit">Create</Button>
						</Stack>
					</Box>
				</ScrollArea.Autosize>
			</MediaDetailsLayout>
		</Container>
	);
}
