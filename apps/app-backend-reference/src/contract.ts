import { HttpApi, OpenApi } from "@effect/platform";

import { AudibleGroup } from "./modules/audible/contract";
import { GodModeGroup } from "./modules/god-mode/contract";
import { PatternsGroup } from "./modules/patterns/contract";
import { SandboxGroup } from "./modules/sandbox/contract";
import { UploadsGroup } from "./modules/uploads/contract";

export const AppContract = HttpApi.make("ryot-reference")
	.add(AudibleGroup)
	.add(GodModeGroup)
	.add(SandboxGroup)
	.add(PatternsGroup)
	.add(UploadsGroup)
	.annotate(OpenApi.Title, "Ryot Reference API")
	.annotate(OpenApi.Description, "API documentation for the Ryot reference backend");
