module.exports = {
  extends: [
    "next/core-web-vitals",
    "next/typescript",
  ],
  rules: {
    // Images intentionally load directly from Cloudflare R2/CDN to avoid
    // routing media through Vercel optimization and transfer bandwidth.
    "@next/next/no-img-element": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "prefer-const": "off",
    "react/no-unescaped-entities": "off",
  },
}
