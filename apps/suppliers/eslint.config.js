import base from "@quagga/eslint-config";

export default [
  ...base,
  {
    ignores: ["**/.next/**", "**/out/**", "**/dist/**"],
  },
];
