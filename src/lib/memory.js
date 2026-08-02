const fs = require("fs");
const path = require("path");
const { tinytutorDir } = require("./state");

const MEMORY_VERSION = 1;

function memoryPath(projectRoot) {
  return path.join(tinytutorDir(projectRoot), "memory.json");
}

function defaultMemory() {
  return {
    version: MEMORY_VERSION,
    milestones: [],
    weakTopics: [],
  };
}

function readMemory(projectRoot) {
  const file = memoryPath(projectRoot);
  if (!fs.existsSync(file)) return defaultMemory();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return { ...defaultMemory(), ...parsed };
  } catch {
    return defaultMemory();
  }
}

function writeMemory(projectRoot, memory) {
  const dir = tinytutorDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  const target = memoryPath(projectRoot);
  const tmp = path.join(dir, `memory.json.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, JSON.stringify(memory, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, target);
}

module.exports = { memoryPath, defaultMemory, readMemory, writeMemory };
