import { badRequest } from "@ryot-app/contract/errors";
import { kernelMessage } from "@ryot-app/kernel-messages/message";

export const missingObject = () => badRequest(kernelMessage("error.storage.object-missing"));
export const writeFailed = () => badRequest(kernelMessage("error.storage.write-failed"));
export const deleteFailed = () => badRequest(kernelMessage("error.storage.delete-failed"));
