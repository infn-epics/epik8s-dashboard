/**
 * The LLM model the voice session should use: the operator's pick if it is
 * still one of the configured models, otherwise the configured default (or
 * the first configured model).
 *
 * Pure and derived on every render rather than synced into state - see
 * VoiceContext.jsx for why that matters (a state write from inside the
 * connect effect made every page load connect twice).
 */
export function resolveVoiceModel(models, defaultModel, selectedModel) {
  const configured = Array.isArray(models) ? models : [];
  if (selectedModel && configured.some((entry) => entry.id === selectedModel)) return selectedModel;
  return defaultModel || configured[0]?.id || '';
}
