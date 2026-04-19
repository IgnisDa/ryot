export const sandboxRunnerSource = `
const decoder = new TextDecoder();
const encoder = new TextEncoder();
let buffer = "";

const formatArg = (value) => {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

async function readLine() {
  const chunk = new Uint8Array(65536);
  while (true) {
    const count = await Deno.stdin.read(chunk);
    if (count === null) {
      Deno.exit(0);
    }
    buffer += decoder.decode(chunk.subarray(0, count));
    const newlineIdx = buffer.indexOf("\\n");
    if (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      return line;
    }
  }
}

const createApiStub = (fnName, apiBase, executionId, token) => {
  return async (...args) => {
    const response = await fetch(
      apiBase + "/rpc/" + encodeURIComponent(executionId) + "/" + encodeURIComponent(fnName),
      {
      method: "POST",
      body: JSON.stringify({ args }),
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      },
    );

    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error ?? "API call failed");
    }

    return body.result;
  };
};

const writeResult = async (payload) => {
  await Deno.stdout.write(encoder.encode(JSON.stringify(payload) + "\\n"));
};

const createRequestConsole = (logs) => ({
  log: (...args) => {
    logs.push(args.map(formatArg).join(" "));
  },
  warn: (...args) => {
    logs.push("[warn] " + args.map(formatArg).join(" "));
  },
  error: (...args) => {
    logs.push("[error] " + args.map(formatArg).join(" "));
  },
  info: (...args) => {
    logs.push(args.map(formatArg).join(" "));
  },
  debug: (...args) => {
    logs.push(args.map(formatArg).join(" "));
  },
});

while (true) {
  const line = await readLine();
  if (!line.trim()) {
    continue;
  }

  const logs = [];
  const previousConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  try {
    const payload = JSON.parse(line);
    const code = payload.code;
    const token = payload.token;
    const apiBase = payload.apiBase;
    const scriptSlug = payload.scriptSlug;
    const driverName = payload.driverName;
    const context = payload.context ?? {};
    const executionId = payload.executionId;
    const apiFunctions = Array.isArray(payload.apiFunctions) ? payload.apiFunctions : [];

    const requestConsole = createRequestConsole(logs);
    console.log = requestConsole.log;
    console.warn = requestConsole.warn;
    console.error = requestConsole.error;
    console.info = requestConsole.info;
    console.debug = requestConsole.debug;

    const driverRegistry = {};
    const driver = (name, fn) => {
      driverRegistry[name] = fn;
    };

    const stubs = {};
    for (const fnName of apiFunctions) {
      stubs[fnName] = createApiStub(fnName, apiBase, executionId, token);
    }

    const stubNames = Object.keys(stubs);
    const wrapperCode =
      "const driver = arguments[0]; " +
      "return (async function sandboxMain({ " +
      stubNames.join(", ") +
      " }, context) {\\n" +
      code +
      "\\n})";

    const factory = new Function(wrapperCode);
    const userFunction = factory(driver);
    await userFunction(stubs, context);

    if (!driverName) {
      await writeResult({
        success: false,
        error: "driverName is required",
				logs: logs.join("\\n") || null,
      });
      continue;
    }

    const driverFn = driverRegistry[driverName];
    if (!driverFn) {
      await writeResult({
        success: false,
        error: 'Driver "' + driverName + '" is not defined in this script',
				logs: logs.join("\\n") || null,
      });
      continue;
    }

    const meta = scriptSlug ? { sandboxScriptSlug: scriptSlug } : undefined;
    const value = await driverFn(context, meta);
    await writeResult({
      success: true,
      value: value ?? null,
		logs: logs.join("\\n") || null,
    });
  } catch (error) {
    await writeResult({
      success: false,
      error: error instanceof Error ? error.message : String(error),
		logs: logs.join("\\n") || null,
    });
  } finally {
    console.log = previousConsole.log;
    console.warn = previousConsole.warn;
    console.error = previousConsole.error;
    console.info = previousConsole.info;
    console.debug = previousConsole.debug;
  }
}
`.trimStart();
