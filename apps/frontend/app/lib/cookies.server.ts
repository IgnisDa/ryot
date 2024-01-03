import { createCookie, createCookieSessionStorage } from "@remix-run/node";
import { COOKIES_KEYS } from "~/lib/generals";

export const authCookie = createCookie(COOKIES_KEYS.auth, {});
export const colorSchemeCookie = createCookie(COOKIES_KEYS.colorScheme, {
	maxAge: 60 * 60 * 24 * 365,
});
export const toastSessionStorage = createCookieSessionStorage({
	cookie: {
		name: "en_toast",
		sameSite: "lax",
		path: "/",
		httpOnly: true,
		secrets: (process.env.SESSION_SECRET || "").split(","),
		secure: process.env.NODE_ENV === "production",
	},
});
