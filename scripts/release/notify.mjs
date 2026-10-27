import { receiptSchema, validateSchema } from './contract.mjs';
export function formatReleaseNotification(receipt) {
  validateSchema(receiptSchema, receipt, 'receipt');
  return {
    version: '1.0',
    source: 'custom',
    content: {
      textType: 'client-markdown',
      title: `Docs ${receipt.environment} release`,
      description: `Release ${receipt.sourceSha.slice(0, 12)}: ${receipt.result}. ${receipt.checks.filter(c => !c.ok).length} checks require attention.`
    }
  };
}
