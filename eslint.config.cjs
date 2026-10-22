const globals = require("globals");
module.exports = [
  {
    files: ["suite/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        module: "readonly",
        require: "readonly",
        RezkaSuite: "readonly",
        RezkaSuiteRepository: "readonly",
        RezkaSuiteImporter: "readonly",
        RezkaSuiteExport: "readonly",
        RezkaSuiteJobs: "readonly",
        RezkaNative: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unreachable": "error",
      "no-dupe-args": "error",
      "no-dupe-keys": "error",
      "valid-typeof": "error",
      "constructor-super": "error",
      "no-this-before-super": "error",
    },
  },
];
