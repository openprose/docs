export function isPreviewMode(): boolean {
  const flag = process.env.DOCS_PREVIEW_MODE;
  return flag !== "false";
}
