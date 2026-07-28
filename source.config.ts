import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';

// You can customize Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.dev/docs/mdx/collections
export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: {
        light: 'solarized-dark',
        dark: 'solarized-dark',
      },
      transformers: [
        {
          // Expose the fence language so styles can treat prose-shaped
          // fences (markdown) differently from alignment-sensitive ones.
          name: 'lang-attribute',
          pre(node) {
            node.properties['data-lang'] = this.options.lang;
          },
        },
      ],
    },
  },
});
