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
      // old link alive. These moves are final, so the redirects are
      // permanent (308): browsers cache them and search engines drop the
      // old URL and pass its signals to the new one. A temporary redirect
      // would keep the old URLs listed as separate pages. The harness group
      // below stays temporary; see its comment.
      {
        source: "/start/what-is-openprose",
        destination: "/",
        permanent: true,
      },
      // The bare entry is required: `/:path*` cannot produce `/` when the
      // wildcard matches zero segments.
      {
        source: "/openprose",
        destination: "/",
        permanent: true,
      },
      {
        source: "/openprose/:path*",
        destination: "/:path*",
        permanent: true,
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
