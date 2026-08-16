import { parseWithZod } from "@conform-to/zod/v4";
import invariant from "tiny-invariant";
import type { z } from "zod";

export const processSubmission = <Schema extends z.ZodType>(formData: FormData, schema: Schema) => {
	const submission = parseWithZod(formData, { schema });
	if (submission.status !== "success") {
		// oxlint-disable-next-line only-throw-error
		throw Response.json({ submission, status: "idle" } as const, { status: 422 });
	}
	return submission.value;
};

export const getActionIntent = (request: Request) => {
	const url = new URL(request.url);
	const intent = url.searchParams.get("intent");
	invariant(intent);
	return intent;
};
