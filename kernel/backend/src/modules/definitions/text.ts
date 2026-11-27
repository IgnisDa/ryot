import type { ManifestText } from "@ryot-app/contract/modules/plugins/manifest-text";
import {
	KERNEL_NAMESPACE,
	type LocalMessage,
	type Message,
	stampNamespace,
} from "@ryot-app/i18n/message";

/** Stamps owner-authored text (definition names, policy rejections) with its owner's namespace: the plugin ID, or the kernel's. */
export const definitionText = (pluginId: null | string, text: LocalMessage): Message =>
	stampNamespace(pluginId ?? KERNEL_NAMESPACE, text);

/** Snapshots carry manifest text; stored rows carry it stamped, which owners restamp losslessly. */
export const storedManifestText = (message: Message): ManifestText => ({ key: message.key });
