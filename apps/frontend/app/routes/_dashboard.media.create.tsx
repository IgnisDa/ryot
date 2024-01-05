import { $path } from "@ignisda/remix-routes";
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
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
	redirect,
} from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
	CreateCustomMediaDocument,
	MetadataLot,
	MetadataSource,
} from "@ryot/generated/graphql/backend/graphql";
import { camelCase } from "@ryot/ts-utils";
import { IconCalendar, IconPhoto, IconVideo } from "@tabler/icons-react";
import { z } from "zod";
import { MediaDetailsLayout } from "~/components/common";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getPresignedGetUrl, uploadFileAndGetKey } from "~/lib/generals";
import { getCoreEnabledFeatures } from "~/lib/graphql.server";
import { createToastHeaders } from "~/lib/toast.server";
import { processSubmission } from "~/lib/utilities.server";

export const loader = async (_args: LoaderFunctionArgs) => {
	const [coreEnabledFeatures] = await Promise.all([getCoreEnabledFeatures()]);
	return json({
		coreEnabledFeatures: { fileStorage: coreEnabledFeatures.fileStorage },
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Create Media | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.formData();
	const submission = processSubmission(formData, schema);
	// biome-ignore lint/suspicious/noExplicitAny: required here
	const input: any = {
		...submission,
		images: JSON.parse(submission.images || "[]"),
		videos: JSON.parse(submission.videos || "[]"),
		[`${camelCase(submission.lot)}Specifics`]: JSON.parse(
			submission.specifics || "{}",
		),
	};
	input.specifics = undefined;
	input.genres = input.genres?.split(", ");
	input.creators = input.creators?.split(", ");
	const { createCustomMedia } = await gqlClient.request(
		CreateCustomMediaDocument,
		{ input },
		await getAuthorizationHeader(request),
	);
	if (createCustomMedia.__typename === "IdObject")
		return redirect($path("/media/item/:id", { id: createCustomMedia.id }));
	return json({ status: "error", submission } as const, {
		headers: await createToastHeaders({
			type: "error",
			message: createCustomMedia.error,
		}),
	});
};

const optionalString = z.string().optional();

const schema = z.object({
	title: z.string(),
	lot: z.nativeEnum(MetadataLot),
	images: optionalString,
	videos: optionalString,
	description: optionalString,
	isNsfw: z.boolean().optional(),
	publishYear: z.number().optional(),
	genres: optionalString,
	creators: optionalString,
	specifics: optionalString,
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [imageUrls, setImageUrls] = useListState<{ key: string; url: string }>(
		[],
	);
	const [videoUrls, setVideoUrls] = useListState<{ key: string; url: string }>(
		[],
	);

	const fileUploadNowAllowed = !loaderData.coreEnabledFeatures.fileStorage;

	const uploadFiles = async (files: File[], to: "image" | "video") => {
		if (files.length > 0) {
			for (const file of files) {
				const key = await uploadFileAndGetKey(
					file.name,
					"metadata",
					file.type,
					await file.arrayBuffer(),
				);
				const url = await getPresignedGetUrl(key);
				if (to === "image") setImageUrls.append({ key, url });
				else if (to === "video") setVideoUrls.append({ key, url });
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
				images={imageUrls.map((i) => i.url)}
				externalLink={{ source: MetadataSource.Custom }}
			>
				<ScrollArea.Autosize mah={400}>
					<Box component={Form} method="post">
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
										<Anchor href="/backend/graphql" size="xs" target="_blank">
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
							<input
								hidden
								value={JSON.stringify(imageUrls.map((i) => i.key))}
								name="images"
								readOnly
							/>
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
							<input
								hidden
								value={JSON.stringify(videoUrls.map((v) => v.key))}
								name="videos"
								readOnly
							/>
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
