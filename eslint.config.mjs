import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import { noEmDash } from "./eslint-rules/no-em-dash.mjs";

// eslint-plugin-react@7.x calls context.getFilename() which was removed in
// ESLint 10. Pinning the React version here bypasses the detection path that
// triggers the crash (detectReactVersion -> resolveBasedir -> getFilename).
const reactVersionSettings = {
  settings: {
    react: { version: "19" },
  },
};

const houseRules = {
  plugins: {
    house: {
      rules: { "no-em-dash": noEmDash },
    },
  },
  rules: {
    "house/no-em-dash": "error",
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".source/**",
    // Ignored because eslint-config-next's Babel parser crashes on .mjs files
    // (missing ESLint 10 scope API). Side-effect: no-em-dash does not check
    // next.config.mjs, postcss.config.mjs, or eslint.config.mjs — acceptable
    // because config files are not prose-facing content.
    "*.mjs",
    "eslint-rules/**",
  ]),
  reactVersionSettings,
  houseRules,
]);

export default eslintConfig;
