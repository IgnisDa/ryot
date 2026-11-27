import { handlePaddleWebhook } from "~/features/billing/webhooks.server";
import { runPromise } from "~/server/runtime.server";

import type { Route } from "./+types/paddle-webhook";

export const action = ({ request }: Route.ActionArgs) => runPromise(handlePaddleWebhook(request));
