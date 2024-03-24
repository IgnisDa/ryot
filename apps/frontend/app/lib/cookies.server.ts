import { createCookie, createCookieSessionStorage } from "@remix-run/node";
import { ApplicationKey } from "./generals";

const commonCookieOptions = {
	name: ApplicationKey.Toast,
	sameSite: "lax",
	path: "/",
	httpOnly: true,
	secrets: (process.env.SESSION_SECRET || "").split(","),
	secure: process.env.NODE_ENV === "production",
} as const;

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

export const toastSessionStorage = createCookieSessionStorage({
	cookie: commonCookieOptions,
});

export const colorSchemeCookie = createCookie(ApplicationKey.ColorScheme, {
	maxAge: 60 * 60 * 24 * 365,
});
