import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

window.scrollTo = () => undefined;

afterEach(cleanup);
