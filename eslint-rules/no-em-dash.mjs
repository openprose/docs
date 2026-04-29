// U+2014 constructed from code point so this file does not contain a literal em dash,
// which would cause the rule to flag itself.
const EM_DASH = String.fromCodePoint(0x2014);

export const noEmDash = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow em dashes (" + EM_DASH + ") in source files; use -- instead.",
    },
    schema: [],
    messages: {
      emDash:
        "Em dash (" + EM_DASH + ") is banned per house style. Use -- instead.",
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === "string" && node.value.includes(EM_DASH)) {
          context.report({ node, messageId: "emDash" });
        }
      },
      TemplateElement(node) {
        if (node.value && node.value.raw && node.value.raw.includes(EM_DASH)) {
          context.report({ node, messageId: "emDash" });
        }
      },
      JSXText(node) {
        if (node.value.includes(EM_DASH)) {
          context.report({ node, messageId: "emDash" });
        }
      },
    };
  },
};
