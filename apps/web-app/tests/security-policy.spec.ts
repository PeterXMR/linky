import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import vercel from "../vercel.json" with { type: "json" };
import { setBaseStorage } from "./helpers/appState";

test.use({ serviceWorkers: "block" });

test("security headers cover the shell, assets, WASM and errors", async ({
  request,
}) => {
  for (const path of [
    "/",
    "/index.html",
    "/icon.svg",
    "/sqlite-wasm/sqlite3.wasm",
    "/missing-security-test",
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(
      path === "/missing-security-test" ? 404 : 200,
    );
    for (const { key, value } of vercel.headers[0].headers) {
      expect(response.headers()[key.toLowerCase()], `${path}: ${key}`).toBe(
        value,
      );
    }
    if (
      path === "/" ||
      path === "/index.html" ||
      path.startsWith("/sqlite-wasm/")
    ) {
      expect(response.headers()["cache-control"]).toBe("no-store");
    }
  }
});

test("built CSP covers every script, blocks injected code and allows local services", async ({
  page,
}) => {
  await setBaseStorage(page);
  await page.goto("/");
  const { policy, firstTag, scripts } = await page.evaluate(() => ({
    policy:
      document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute("content") ?? "",
    firstTag: document.head.firstElementChild?.getAttribute("http-equiv"),
    scripts: Array.from(
      document.querySelectorAll("script:not([src])"),
      (script) => script.textContent,
    ),
  }));
  expect(firstTag).toBe("Content-Security-Policy");
  expect(scripts.length).toBeGreaterThan(0);
  for (const script of scripts) {
    expect(policy).toContain(
      `'sha256-${createHash("sha256").update(script).digest("base64")}'`,
    );
  }
  expect(policy).not.toContain("fonts.googleapis.com");
  expect(policy).not.toContain("fonts.gstatic.com");

  const violations = await page.evaluate(async () => {
    const violations: string[] = [];
    const blocked = new Promise<void>((resolve) => {
      document.addEventListener("securitypolicyviolation", (event) => {
        if (event.blockedURI === "inline") {
          violations.push(event.effectiveDirective);
          if (violations.length === 2) resolve();
        }
      });
    });
    const script = document.createElement("script");
    script.textContent = 'document.body.dataset.injectedScript = "ran"';
    document.body.append(script);
    const button = document.createElement("button");
    button.setAttribute(
      "onclick",
      'document.body.dataset.injectedHandler = "ran"',
    );
    document.body.append(button);
    button.click();
    await blocked;
    button.remove();
    script.remove();
    return {
      violations,
      scriptRan: document.body.dataset.injectedScript,
      handlerRan: document.body.dataset.injectedHandler,
    };
  });
  expect(violations.violations.sort()).toEqual([
    "script-src-attr",
    "script-src-elem",
  ]);
  expect(violations.scriptRan).toBeUndefined();
  expect(violations.handlerRan).toBeUndefined();

  for (const port of [3338, 3339]) {
    expect(
      await page.evaluate(
        async (port) => (await fetch(`http://localhost:${port}/v1/info`)).ok,
        port,
      ),
    ).toBe(true);
  }
  expect(
    await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const socket = new WebSocket("ws://localhost:7777");
          socket.onopen = () => {
            socket.close();
            resolve(true);
          };
          socket.onerror = () => {
            socket.close();
            resolve(false);
          };
        }),
    ),
  ).toBe(true);
});

test("the app cannot be embedded even by the same origin", async ({ page }) => {
  await page.route("**/security-frame-host", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<iframe src="/index.html"></iframe>',
    }),
  );
  const blocked = page.waitForEvent("console", (message) =>
    message.text().includes("frame-ancestors"),
  );
  await page.goto("/security-frame-host");
  await blocked;
  await expect(page.frameLocator("iframe").locator("#root")).toHaveCount(0);
});
