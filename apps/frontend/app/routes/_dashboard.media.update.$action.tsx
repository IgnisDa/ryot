import {
	Anchor,
	Button,
	Code,
	Container,
	FileInput,
	Group,
	JsonInput,
	NumberInput,
	Select,
	Stack,
	Switch,
	TextInput,
	Textarea,
	Title,
} from "@mantine/core";
import {
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaArgs,
	redirect,
	unstable_parseMultipartFormData,
} from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
	CreateCustomMetadataDocument,
	MediaLot,
	MetadataDetailsDocument,
	UpdateCustomMetadataDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { camelCase, changeCase, processSubmission } from "@ryot/ts-utils";
import { IconCalendar, IconPhoto, IconVideo } from "@tabler/icons-react";
import { $path } from "remix-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { useCoreDetails } from "~/lib/hooks";
import { s3FileUploader, serverGqlService } from "~/lib/utilities.server";

enum Action {
	Create = "create",
	Edit = "edit",
}

const searchParamsSchema = z.object({
	id: z.string().optional(),
	lot: z.nativeEnum(MediaLot).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
	const { action } = zx.parseParams(params, { action: z.nativeEnum(Action) });
	const query = zx.parseQuery(request, searchParamsSchema);
	const details = await match(action)
		.with(Action.Create, () => undefined)
		.with(Action.Edit, async () => {
			invariant(query.id);
			const { metadataDetails } = await serverGqlService.authenticatedRequest(
				request,
				MetadataDetailsDocument,
				{ metadataId: query.id },
			);
			return metadataDetails;
		})
		.exhaustive();
	return { query, action, details };
};

export const meta = (_args: MetaArgs<typeof loader>) => {
	return [{ title: "Create Media | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const uploaders = s3FileUploader("metadata");
	const formData = await unstable_parseMultipartFormData(request, uploaders);
	const submission = processSubmission(formData, schema);
	// biome-ignore lint/suspicious/noExplicitAny: required here
	const input: any = {
		...submission,
		[`${camelCase(submission.lot)}Specifics`]: submission.specifics
			? JSON.parse(submission.specifics)
			: undefined,
	};
	input.id = undefined;
	input.action = undefined;
	input.specifics = undefined;
	input.genres = input.genres?.split(",");
	input.creators = input.creators?.split(",");
	const id = await match(submission.action)
		.with(Action.Create, async () => {
			const { createCustomMetadata } =
				await serverGqlService.authenticatedRequest(
					request,
					CreateCustomMetadataDocument,
					{ input },
				);
			return createCustomMetadata.id;
		})
		.with(Action.Edit, async () => {
			invariant(submission.id);
			await serverGqlService.authenticatedRequest(
				request,
				UpdateCustomMetadataDocument,
				{ input: { existingMetadataId: submission.id, update: input } },
			);
			return submission.id;
		})
		.exhaustive();
	return redirect($path("/media/item/:id", { id }));
};

const optionalString = z.string().optional();
const optionalStringArray = z.array(z.string()).optional();

const schema = z.object({
	title: z.string(),
	id: optionalString,
	genres: optionalString,
	creators: optionalString,
	specifics: optionalString,
	images: optionalStringArray,
	videos: optionalStringArray,
	description: optionalString,
	action: z.nativeEnum(Action),
	isNsfw: z.boolean().optional(),
	lot: z.nativeEnum(MediaLot),
	publishYear: z.number().optional(),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const fileUploadNotAllowed = !coreDetails.fileStorageEnabled;

	return (
		<Container>
			<Form method="POST" encType="multipart/form-data">
				<input hidden name="action" defaultValue={loaderData.action} />
				{loaderData.details ? (
					<input hidden name="id" defaultValue={loaderData.details.id} />
				) : null}
				<Stack>
					<Title>
						{loaderData.details
							? `Updating ${loaderData.details.title}`
							: "Create Media"}
					</Title>
					<TextInput
						required
						autoFocus
						name="title"
						label="Title"
						defaultValue={loaderData.details?.title}
					/>
					<Group wrap="nowrap">
						<Select
							required
							name="lot"
							label="Type"
							defaultValue={loaderData.details?.lot || loaderData.query.lot}
							data={Object.values(MediaLot).map((v) => ({
								value: v,
								label: changeCase(v),
							}))}
						/>
						<Switch
							mt="md"
							name="isNsfw"
							label="Is it NSFW?"
							defaultChecked={loaderData.details?.isNsfw || undefined}
						/>
					</Group>
					<JsonInput
						formatOnBlur
						name="specifics"
						label="Specifics"
						defaultValue={JSON.stringify(
							loaderData.details?.movieSpecifics ||
								loaderData.details?.showSpecifics ||
								loaderData.details?.mangaSpecifics ||
								loaderData.details?.animeSpecifics ||
								loaderData.details?.podcastSpecifics ||
								loaderData.details?.bookSpecifics ||
								loaderData.details?.audioBookSpecifics ||
								loaderData.details?.visualNovelSpecifics ||
								loaderData.details?.videoGameSpecifics ||
								loaderData.details?.musicSpecifics,
						)}
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
						name="description"
						description="Markdown is supported"
						defaultValue={loaderData.details?.description || undefined}
					/>
					{!fileUploadNotAllowed ? (
						<FileInput
							multiple
							name="images"
							label="Images"
							leftSection={<IconPhoto />}
							accept="image/png,image/jpeg,image/jpg"
							description={
								loaderData.details &&
								"Please re-upload the images while updating the metadata, old ones will be deleted"
							}
						/>
					) : null}
					{!fileUploadNotAllowed ? (
						<FileInput
							multiple
							name="videos"
							label="Videos"
							leftSection={<IconVideo />}
							accept="video/mp4,video/x-m4v,video/*"
							description={
								loaderData.details &&
								"Please re-upload the videos while updating the metadata, old ones will be deleted"
							}
						/>
					) : null}
					<NumberInput
						name="publishYear"
						label="Publish year"
						leftSection={<IconCalendar />}
						defaultValue={loaderData.details?.publishYear || undefined}
					/>
					<TextInput
						name="creators"
						label="Creators"
						placeholder="Comma separated names"
						defaultValue={loaderData.details?.creators
							.flatMap((c) => c.items)
							.map((c) => c.name)
							.join(", ")}
					/>
					<TextInput
						name="genres"
						label="Genres"
						placeholder="Comma separated values"
						defaultValue={
							loaderData.details?.genres.map((g) => g.name).join(", ") ||
							undefined
						}
					/>
					<Button type="submit">Create</Button>
				</Stack>
			</Form>
		</Container>
	);
}
