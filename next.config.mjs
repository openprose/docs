import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  reactStrictMode: true,
  async redirects() {
    const PROSE_REPO = "https://github.com/openprose/prose";

    // The docs site covers the language. The harness reference lives with
    // the packages in the openprose/prose repo; send the old harness routes
    // there. Temporary redirects on purpose: these routes may host docs
    // again when the harness documentation is reworked. A `/:path*` source
    // also matches the bare prefix, so one entry covers a whole section.
    const harnessRoutes = {
      reactor: `${PROSE_REPO}#reactor-the-recommended-harness`,
      sdk: `${PROSE_REPO}/tree/main/packages/reactor`,
      cli: `${PROSE_REPO}/tree/main/packages/reactor-cli`,
      "reactor-devtools": `${PROSE_REPO}/tree/main/packages/reactor-devtools`,
    };

    return [
      // The early docs lived under /start/*, then under /openprose/*. The
      // site now covers one topic, so the pages live at the root; keep every
      // old link alive.
      {
        source: "/start/what-is-openprose",
        destination: "/",
        permanent: false,
      },
      // The bare entry is required: `/:path*` cannot produce `/` when the
      // wildcard matches zero segments.
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
      ...Object.entries(harnessRoutes).map(([prefix, destination]) => ({
        source: `/${prefix}/:path*`,
        destination,
        permanent: false,
      })),
    ];
  },
};

export default withMDX(config);
