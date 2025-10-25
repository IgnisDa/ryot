import { HttpApi, OpenApi } from "@effect/platform";

import { SystemGroup } from "./modules/system/contract";

export const AppContract = HttpApi.make("ryot")
	.add(SystemGroup)
	.annotate(OpenApi.Title, "Ryot API")
	.annotate(OpenApi.Description, "API documentation for the Ryot backend");
