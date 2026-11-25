import { preferredLocale } from "@ryot-app/i18n/locale";
import { kernelLocales } from "@ryot-app/kernel-messages/catalog";

export const resolveDeviceLocale = (languages: ReadonlyArray<string> = navigator.languages) =>
	preferredLocale(languages, kernelLocales);
