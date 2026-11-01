import { installJsdomBlobClone } from "@ryot-app/testing/jsdom-blob-clone";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

window.scrollTo = () => undefined;
installJsdomBlobClone();

afterEach(cleanup);
