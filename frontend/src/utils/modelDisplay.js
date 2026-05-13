export const AGORA_ICON_URL = 'https://arteus.tech/agora_logo.ico';

let modelAliasRegistry = {};

export function setModelAliases(aliases) {
  modelAliasRegistry = aliases && typeof aliases === 'object' ? aliases : {};
}

export function isAgoraModel(model) {
  return typeof model === 'string' && model.startsWith('agora/');
}

export function getModelDisplayName(model) {
  if (!model) return 'Model';
  const alias = modelAliasRegistry[model];
  if (alias) return alias;
  if (isAgoraModel(model)) return 'Agora';
  return model.split('/')[1] || model;
}

export function getModelIconUrl(model) {
  if (isAgoraModel(model)) return AGORA_ICON_URL;
  return null;
}
