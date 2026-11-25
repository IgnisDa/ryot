import { parseWithZod } from "@conform-to/zod/v4";
import { Effect } from "effect";
import type { z } from "zod";

export const processSubmission = <S extends z.ZodType>(form: FormData, schema: S) => {
	const submission = parseWithZod(form, { schema });
	return submission.status === "success"
		? Effect.succeed(submission.value)
		: Effect.fail(Response.json({ submission, status: "idle" }, { status: 422 }));
};

export const getActionIntent = (request: Request) =>
	new URL(request.url).searchParams.get("intent");
