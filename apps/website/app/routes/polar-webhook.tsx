import { handlePolarWebhook } from "~/features/billing/webhooks.server";
import { runPromise } from "~/server/runtime.server";

import type { Route } from "./+types/polar-webhook";

export const action = ({ request }: Route.ActionArgs) => runPromise(handlePolarWebhook(request));
