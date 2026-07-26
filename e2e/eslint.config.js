import base from "@quagga/eslint-config";

export default [
  ...base,
  {
    ignores: ["playwright-report/**", "test-results/**"],
  },
];
