const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  ensureHookInstalled,
  writeSettings,
  readSettings,
  settingsPath,
  PRE_TOOL_USE_HOOK_MARKER,
  PRE_TOOL_USE_MATCHER,
} = require("../src/lib/settingsMerge");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tinytutor-settings-"));
}

test("ensureHookInstalled creates settings.json with both Stop and PreToolUse hooks when missing", () => {
  const dir = tempDir();
  const { changed, settings } = ensureHookInstalled(dir);
  assert.equal(changed, true);
  assert.equal(settings.hooks.Stop.length, 1);
  assert.equal(settings.hooks.PreToolUse.length, 1);
  assert.match(settings.hooks.PreToolUse[0].matcher, /Edit/);
  writeSettings(dir, settings);
  assert.ok(fs.existsSync(settingsPath(dir)));
});

test("ensureHookInstalled is idempotent", () => {
  const dir = tempDir();
  const first = ensureHookInstalled(dir);
  writeSettings(dir, first.settings);

  const second = ensureHookInstalled(dir);
  assert.equal(second.changed, false);
  assert.equal(second.settings.hooks.Stop.length, 1);
  assert.equal(second.settings.hooks.PreToolUse.length, 1);
});

test("ensureHookInstalled preserves unrelated existing settings and hooks", () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    settingsPath(dir),
    JSON.stringify({
      permissions: { allow: ["Bash(npm test)"] },
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }] },
    })
  );

  const { changed, settings } = ensureHookInstalled(dir);
  writeSettings(dir, settings);

  const written = readSettings(dir);
  assert.deepEqual(written.permissions, { allow: ["Bash(npm test)"] });
  // The pre-existing "Bash" PreToolUse hook survives, and ours is appended alongside it.
  assert.equal(written.hooks.PreToolUse.length, 2);
  assert.ok(written.hooks.PreToolUse.some((e) => e.matcher === "Bash"));
  assert.ok(written.hooks.PreToolUse.some((e) => e.matcher.includes("Edit")));
  assert.equal(written.hooks.Stop.length, 1);
  assert.equal(changed, true);
});

test("ensureHookInstalled syncs a stale PreToolUse matcher forward on re-run (e.g. upgrading to a version that also gates Bash), without duplicating the entry", () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    settingsPath(dir),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write|MultiEdit|NotebookEdit", // stale: predates Bash coverage
            hooks: [{ type: "command", command: `npx --yes ${PRE_TOOL_USE_HOOK_MARKER}`, timeout: 30 }],
          },
        ],
      },
    })
  );

  const { changed, settings } = ensureHookInstalled(dir);
  assert.equal(changed, true);
  assert.equal(settings.hooks.PreToolUse.length, 1);
  assert.equal(settings.hooks.PreToolUse[0].matcher, PRE_TOOL_USE_MATCHER);
});
