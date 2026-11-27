import { unknownToMessage } from "@ryot-app/contract/errors";

import { IntegrationRunError } from "./jobs";

export const toIntegrationWorkflowError = (cause: unknown) =>
	new IntegrationRunError({ message: unknownToMessage(cause) });
