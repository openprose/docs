import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  reactStrictMode: true,
  async redirects() {
    return [
      // The early docs lived under /start/*. PR #2 restructured them into
      // /openprose/*. Keep the old "What is OpenProse?" link alive: it now
      // maps to the OpenProse overview page (content/docs/openprose/index.mdx).
      {
        source: "/start/what-is-openprose",
        destination: "/openprose",
        permanent: true,
      },
    ];
  },
};

export default withMDX(config);
