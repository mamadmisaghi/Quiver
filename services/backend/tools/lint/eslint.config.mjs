// M3.5: flat config. Type-agnostic recommended rules; tsc --noEmit is the type gate.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["tools/lint/node_modules/**", "node_modules/**", "**/node_modules/**", "foundry/**", "dist/**", "data/**", "contracts/dist/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off", // used deliberately at untyped boundaries (JSON, viem)
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
