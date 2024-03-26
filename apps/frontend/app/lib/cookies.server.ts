import {
	type CookieOptions,
	createCookie,
	createCookieSessionStorage,
} from "@remix-run/node";
import { ApplicationKey } from "./generals";
import { expectedEnvironmentVariables } from "./utilities.server";

const envVariables = expectedEnvironmentVariables.parse(process.env);

const commonCookieOptions = {
	sameSite: "lax",
	path: "/",
	httpOnly: true,
	secrets: (process.env.SESSION_SECRET || "").split(","),
	secure:
		process.env.NODE_ENV === "production"
			? !envVariables.FRONTEND_INSECURE_COOKIES
			: false,
} satisfies CookieOptions;

export const authCookie = createCookie(
	ApplicationKey.Auth,
	commonCookieOptions,
);

export const userPreferencesCookie = createCookie(
	ApplicationKey.UserPreferences,
	commonCookieOptions,
);

export const coreDetailsCookie = createCookie(
	ApplicationKey.CoreDetails,
	commonCookieOptions,
);

export const userDetailsCookie = createCookie(
	ApplicationKey.UserDetails,
	commonCookieOptions,
);

export const userCollectionsListCookie = createCookie(
	ApplicationKey.UserCollectionsList,
	commonCookieOptions,
);

export const toastSessionStorage = createCookieSessionStorage({
	cookie: { ...commonCookieOptions, name: ApplicationKey.Toast },
});

export const colorSchemeCookie = createCookie(ApplicationKey.ColorScheme, {
	maxAge: 60 * 60 * 24 * 365,
});
