import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { ProseProgram } from "@/components/prose-program";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    ProseProgram,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
