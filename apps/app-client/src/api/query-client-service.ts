import { Context } from "effect";

import type { appQueryClient } from "./query-client";

type GetAppQueryClient = typeof appQueryClient;

export class AppQueryClient extends Context.Service<
	AppQueryClient,
	{ readonly get: GetAppQueryClient }
>()("@ryot/app-client/AppQueryClient") {}
