import { localMessageBuilder, messageBuilder } from "@ryot-app/i18n/builder";
import { KERNEL_NAMESPACE } from "@ryot-app/i18n/message";

import type { KernelCatalog } from "./catalog.generated";

export const kernelMessage = messageBuilder<KernelCatalog>(KERNEL_NAMESPACE);

/** Manifest text of kernel definitions; the kernel namespace is stamped where it is served. */
export const kernelText = localMessageBuilder<KernelCatalog>();
