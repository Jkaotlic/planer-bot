// Точка входа: `npm run e2e` из корня. Код возврата 1, если хоть один сценарий красный.
// Скриншоты и лог сервера — в e2e/.out, CI выкладывает их при падении.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setup, apiScenarios, lifecycle, results, srv, tg, here, getLog, cleanup } from "./api.mjs";
import { browserScenarios } from "./browser.mjs";
import { sleep } from "./lib.mjs";
const die = (e) => {
  console.error("HARNESS", e);
  try {
    srv?.kill("SIGKILL");
  } catch {}
  process.exit(2);
};
try {
  await setup();
  await apiScenarios();
  await browserScenarios();
  await lifecycle();
} catch (e) {
  die(e);
}
await sleep(300);
mkdirSync(resolve(here, ".out"), { recursive: true });
writeFileSync(resolve(here, ".out/server.log"), getLog());
writeFileSync(resolve(here, ".out/results.json"), JSON.stringify(results, null, 1));
srv.kill("SIGTERM");
await Promise.race([srv.exited, sleep(5000)]);
tg.close();
cleanup();
const f = results.filter((r) => !r.ok);
console.log(`\nИТОГО: ${results.length - f.length}/${results.length} PASS`);
process.exit(f.length ? 1 : 0);
