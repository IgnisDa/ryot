import { createCookie, createCookieSessionStorage } from "@remix-run/node";

const commonCookieOptions = {
	name: "Toast",
	sameSite: "lax",
	path: "/",
	httpOnly: true,
	secrets: (process.env.SESSION_SECRET || "").split(","),
	secure: process.env.NODE_ENV === "production",
} as const;

export const authCookie = createCookie("Auth", commonCookieOptions);

export const userPreferencesCookie = createCookie(
	"UserPreferences",
	commonCookieOptions,
);

export const coreDetailsCookie = createCookie(
	"CoreDetails",
	commonCookieOptions,
);

export const userDetailsCookie = createCookie(
	"UserDetails",
	commonCookieOptions,
);

export const userCollectionsListCookie = createCookie(
	"UserCollectionsList",
	commonCookieOptions,
);

export const toastSessionStorage = createCookieSessionStorage({
	cookie: commonCookieOptions,
});

export const colorSchemeCookie = createCookie("ColorScheme", {
	maxAge: 60 * 60 * 24 * 365,
});
