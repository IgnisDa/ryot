import { type LoaderFunctionArgs, json } from "@remix-run/node";
import { z } from "zod";
import { zx } from "zodix";

const searchParamsSchema = z.object({
	code: z.string(),
	state: z.string(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	console.log(query);
	return json({ query });
};
