import { createCookie } from "@remix-run/node";
import { COOKIES_KEYS } from "~/lib/constants.server";

export const authCookie = createCookie(COOKIES_KEYS.authCookieName, {});
