import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: [
      "app/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "hooks/**/*.{ts,tsx}",
      "contexts/**/*.{ts,tsx}",
    ],
    ignores: ["app/api/**", "app/**/page.tsx", "app/**/layout.tsx", "app/page.tsx", "app/layout.tsx"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/*", "@/server/**"],
              allowTypeImports: true,
              message:
                "Client code must not import runtime values from server modules. Move shared constants/types to lib/config/ or use `import type`.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
