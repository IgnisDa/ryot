export const MINIMUM_PASSWORD_LENGTH = 8;

export type CredentialsValues = { email: string; password: string };

export const normalizeCredentials = (values: CredentialsValues): CredentialsValues => ({
	password: values.password,
	email: values.email.trim().toLowerCase(),
});

export const validateEmail = (value: string) =>
	/^\S+@\S+\.\S+$/.test(value.trim()) ? undefined : "Enter a valid email address.";

export const validatePassword = (value: string) =>
	value.length >= MINIMUM_PASSWORD_LENGTH
		? undefined
		: `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`;

export const registrationName = (email: string) => email.split("@", 1)[0] || email;
