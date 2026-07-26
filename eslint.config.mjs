import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // 게임 루프가 ref로 최신 값을 읽는 곳이 많아 exhaustive-deps는 경고로 둡니다.
      // 끄지는 않습니다 — 실제 stale closure를 잡아주는 룰이라서.
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];

export default config;
