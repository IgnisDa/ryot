import type { Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";

export const MINIMUM_PASSWORD_LENGTH = 8;

export type CredentialsValues = { email: string; password: string };

export const normalizeCredentials = (values: CredentialsValues): CredentialsValues => ({
	password: values.password,
	email: values.email.trim().toLowerCase(),
});

export const validateEmail = (t: (message: Message) => Text, value: string) =>
	/^\S+@\S+\.\S+$/.test(value.trim())
		? undefined
		: t(kernelMessage("client.auth.validation.email"));

export const validatePassword = (t: (message: Message) => Text, value: string) =>
	value.length >= MINIMUM_PASSWORD_LENGTH
		? undefined
		: t(kernelMessage("client.auth.validation.password", { minimum: MINIMUM_PASSWORD_LENGTH }));

export const registrationName = (email: string) => email.split("@", 1)[0] || email;
