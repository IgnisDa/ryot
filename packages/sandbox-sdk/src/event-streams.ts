import {
	EventStreamStepInput,
	EventStreamStepOutput,
} from "@ryot-app/contract/modules/events/stream-work";
import { KERNEL_EVENT_STREAM_WORKFLOW } from "@ryot-app/contract/modules/plugins/execution";
import { Schema } from "@ryot-app/sandbox-sdk/effect";

import { defineWorkflowReference } from "./workflow";

export { EventStreamStepInput, EventStreamStepOutput };

export const kernelDispatch = defineWorkflowReference({
	output: Schema.Void,
	workflowSlug: KERNEL_EVENT_STREAM_WORKFLOW,
	input: Schema.Struct({ id: Schema.String }),
});
