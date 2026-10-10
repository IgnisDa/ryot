import { Context } from "effect";
import type { Workflow } from "effect/workflow";

export class AdmittedWorkflowCatalogue extends Context.Service<
	AdmittedWorkflowCatalogue,
	ReadonlyArray<Workflow.Any>
>()("AdmittedWorkflowCatalogue") {}
