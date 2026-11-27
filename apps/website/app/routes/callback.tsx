import { finishOidcSignIn } from "~/features/account/sign-in.server";
import { runPromise } from "~/server/runtime.server";

import type { Route } from "./+types/callback";

export const loader = ({ request }: Route.LoaderArgs) => runPromise(finishOidcSignIn(request));
