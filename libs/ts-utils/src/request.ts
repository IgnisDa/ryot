import { parseWithZod } from "@conform-to/zod/v4";
import type { Params } from "react-router";
import invariant from "tiny-invariant";
import type { output, z } from "zod";

export const processSubmission = <Schema extends z.ZodType>(formData: FormData, schema: Schema) => {
	const submission = parseWithZod(formData, { schema });
	if (submission.status !== "success") {
		// oxlint-disable-next-line only-throw-error
		throw Response.json({ status: "idle", submission } as const, {
			status: 422,
		});
	}
	return submission.value;
};

export const getActionIntent = (request: Request) => {
	const url = new URL(request.url);
	const intent = url.searchParams.get("intent");
	invariant(intent);
	return intent;
};

export const parseSearchQuery = <Schema extends z.ZodType>(
	request: Request,
	schema: Schema,
): output<Schema> => {
	const entries: Record<string, string> = {};
	const searchParams = new URL(request.url).searchParams;
	searchParams.forEach((value, key) => {
		entries[key] = value;
	});
	return schema.parse(entries);
};

export const parseParameters = <Schema extends z.ZodType>(
	params: Params,
	schema: Schema,
): output<Schema> => {
	const parsed = schema.parse(params);
	return parsed;
};
