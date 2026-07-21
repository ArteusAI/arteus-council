export const AGORA_ICON_URL = 'https://arteus-adm.ru/agora_logo.ico';

export function isAgoraModel(model) {
  return typeof model === 'string' && model.startsWith('agora/');
}

export function getModelDisplayName(model) {
  if (!model) return 'Model';
  if (isAgoraModel(model)) return 'Agora';
  return model.split('/')[1] || model;
}

export function getModelIconUrl(model) {
  if (isAgoraModel(model)) return AGORA_ICON_URL;
  return null;
}
