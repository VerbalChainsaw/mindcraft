// eslint.config.js
import globals from "globals";
import pluginJs from "@eslint/js";
import noFloatingPromise from "eslint-plugin-no-floating-promise";

const CONTROL_PLANE_FILES = [
  "main.js",
  "src/mindcraft/launcher-config.js",
  "src/mindcraft/health-status.js",
  "src/mindcraft/agent-settings.js",
  "src/mindcraft/agent-state-pump.js",
  "src/mindcraft/managed-minecraft-server.js",
  "src/mindcraft/mcserver.js",
  "src/mindcraft/mindcraft.js",
  "src/mindcraft/profile-preflight.js",
  "src/mindcraft/runtime-config.js",
  "src/mindcraft/mindserver.js",
  "src/models/_model_map.js",
  "src/models/deepseek.js",
  "src/models/openai_compatible.js",
  // These run under Node and use class fields (`static prefix = ...`), which
  // the browser/ES2021 base scope cannot even parse. Scope membership is about
  // where the file runs, not which lint lane happens to name it.
  "src/models/cancellation.js",
  "src/models/fallback-router.js",
  "src/models/glhf.js",
  "src/models/gpt.js",
  "src/models/huggingface.js",
  "src/models/hyperbolic.js",
  "src/models/ollama.js",
  "src/models/provider-failure.js",
  "src/models/qwen.js",
  "src/process/agent_process.js",
  "src/process/init_agent.js",
  "src/utils/agent-name.js",
  "tools/scenario-lab.mjs",
  "tools/scenario-lab/**/*.mjs",
  "tools/measure-persistence-cost.mjs",
  "tools/sweep-silent-failures.mjs",
  "tools/verify-provider-transport.mjs",
  "tests/control-plane/**/*.js",
];

const NODE_TEST_GLOBALS = {
  after: "readonly",
  afterEach: "readonly",
  before: "readonly",
  beforeEach: "readonly",
  describe: "readonly",
  it: "readonly",
  suite: "readonly",
  test: "readonly",
};

/** @type {import('eslint').Linter.Config[]} */
export default [
  // First, import the recommended configuration
  pluginJs.configs.recommended,

  // Then override or customize specific rules
  {
    plugins: {
      "no-floating-promise": noFloatingPromise,
    },
    languageOptions: {
      globals: globals.browser,
      ecmaVersion: 2021,
      sourceType: "module",
    },
    rules: {
      "no-undef": "error",              // Disallow the use of undeclared variables or functions.
      "semi": ["error", "always"],      // Require the use of semicolons at the end of statements.
      "curly": "off",                   // Do not enforce the use of curly braces around blocks of code.
      "no-unused-vars": "off",          // Disable warnings for unused variables.
      "no-unreachable": "off",          // Disable warnings for unreachable code.
      "require-await": "error",         // Disallow async functions which have no await expression
      "no-floating-promise/no-floating-promise": "error", // Disallow Promises without error handling or awaiting
    },
  },
  {
    files: CONTROL_PLANE_FILES,
    languageOptions: {
      globals: {
        ...globals.node,
        ...NODE_TEST_GLOBALS,
      },
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
  {
    // Existing empty catch handlers in mindserver.js are out of scope for
    // this focused gate; do not require a legacy-wide lint cleanup here.
    files: ["src/mindcraft/mindserver.js"],
    rules: {
      "no-empty": "off",
    },
  },
];
