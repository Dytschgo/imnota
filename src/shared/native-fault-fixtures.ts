// Fixture values shared by the fault smoke and the renderer. Kept free of zod so the renderer's
// startup bundle can use them without loading the fault schemas.
export const FAULT_QUEUED_NAME = 'Fixture queued metadata';
export const FAULT_MARKDOWN = '# Fixture recovery\n\nfixture-draft-text\n';
export const FAULT_DESCRIPTION = 'fixture-draft-shot';
