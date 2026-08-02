const path = require("path");
const { removeHookInstalled, writeSettings, settingsPath } = require("../lib/settingsMerge");

function uninstall() {
  const projectRoot = process.cwd();
  const { changed, settings } = removeHookInstalled(projectRoot);

  if (changed) {
    writeSettings(projectRoot, settings);
    console.log(`Unregistered tinytutor hooks from ${path.relative(projectRoot, settingsPath(projectRoot))}.`);
  } else {
    console.log("No tinytutor hooks found in .claude/settings.json.");
  }

  console.log(`
tinytutor hooks have been removed.

If you also wish to delete local history and settings, run:
  rm -rf .tinytutor
`);
}

module.exports = { uninstall };
