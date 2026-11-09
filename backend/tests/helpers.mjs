import { config } from "../src/config/index.js";
import { createPool } from "../src/db/pool.js";
import { createApp } from "../src/app.js";
import { migrate } from "../scripts/migrate.mjs";
import { replaceAll, loadSnapshot } from "../src/repositories/unitOfWork.js";
import { seed, DEMO_PASSWORD } from "../src/seed/data.js";
import { hashSecret } from "../src/utils/passwords.js";

export const pool = createPool(config.testDatabaseUrl);
await migrate(pool);
const passwordHash = await hashSecret(DEMO_PASSWORD);

const fakeOidc = {
  enabled: true,
  profile: null,
  authorizationUrl: ({ state }) => `https://accounts.example/auth?state=${state}`,
  exchange: async () => fakeOidc.profile,
};
export { fakeOidc };

const app = createApp({ pool, allowDemoHeader: true, oidc: fakeOidc, limitLogin: false, quiet: false });
const server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
export const baseUrl = `http://127.0.0.1:${server.address().port}`;
export const deps = app.locals.deps;

export async function closeTests() {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
}

export function clientFor(token) {
  return async (path, method = "GET", body, user = 1) => {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    else if (deps.allowDemoHeader) headers["x-demo-user"] = String(user);
    const response = await fetch(baseUrl + "/api" + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: response.status, data, headers: response.headers };
  };
}

export async function load(data = seed(), { today } = {}) {
  await replaceAll(pool, data);
  await pool.query("UPDATE users SET password_hash = $1", [passwordHash]);
  deps.today = typeof today === "function" ? today : () => today || new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  deps.state.reconciledOn = null;
}

export async function freshClient({ today, allowDemoHeader = true } = {}) {
  await load(seed(), { today });
  deps.allowDemoHeader = allowDemoHeader;
  return clientFor();
}

export async function freshApi({ today, allowDemoHeader = true } = {}) {
  await load(seed(), { today });
  deps.allowDemoHeader = allowDemoHeader;
  return { client: (token) => clientFor(token) };
}

export async function fixture(data, today = "2027-07-02") {
  await load(data, { today });
  deps.allowDemoHeader = true;
  return {
    call: clientFor(),
    read: async () => {
      const client = await pool.connect();
      try {
        return await loadSnapshot(client);
      } finally {
        client.release();
      }
    },
    cleanup: async () => {},
  };
}
