import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  reactStrictMode: true,
  async redirects() {
    return [
      // The early docs lived under /start/*, then under /openprose/*. The
      // site now covers one topic, so the pages live at the root; keep every
      // old link alive.
      {
        source: "/start/what-is-openprose",
        destination: "/",
        permanent: false,
      },
      {
        source: "/openprose",
        destination: "/",
        permanent: false,
      },
      {
        source: "/openprose/:path*",
        destination: "/:path*",
        permanent: false,
      },
      // The docs site covers the language. The harness reference lives with
      // the packages in the openprose/prose repo; send the old harness routes
      // there. Temporary redirects on purpose: these routes may host docs
      // again when the harness documentation is reworked.
      {
        source: "/reactor",
        destination:
          "https://github.com/openprose/prose#reactor-the-recommended-harness",
        permanent: false,
      },
      {
        source: "/reactor/:path*",
        destination:
          "https://github.com/openprose/prose#reactor-the-recommended-harness",
        permanent: false,
      },
      {
        source: "/sdk/:path*",
        destination:
          "https://github.com/openprose/prose/tree/main/packages/reactor",
        permanent: false,
      },
      {
        source: "/sdk",
        destination:
          "https://github.com/openprose/prose/tree/main/packages/reactor",
        permanent: false,
      },
      {
        source: "/cli/:path*",
        destination:
          "https://github.com/openprose/prose/tree/main/packages/reactor-cli",
        permanent: false,
      },
      {
        source: "/reactor-devtools/:path*",
        destination:
          "https://github.com/openprose/prose/tree/main/packages/reactor-devtools",
        permanent: false,
      },
      {
        source: "/reactor-devtools",
        destination:
          "https://github.com/openprose/prose/tree/main/packages/reactor-devtools",
        permanent: false,
      },
    ];
  },
};

export default withMDX(config);
