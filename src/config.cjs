const { DEFAULT_THUMBNAIL_FOLDER, normalizeAssetFolder } = require('./assets.cjs');
const DEFAULTS = { cardMode: 'compact', cardFormat: 'native', saveThumbnails: false, thumbnailFolder: DEFAULT_THUMBNAIL_FOLDER, timeoutMs: 4500, replaceTitle: true, useOEmbed: false };
function normalizeConfig(saved = {}, strict = false) {
  let thumbnailFolder;
  try { thumbnailFolder = normalizeAssetFolder(saved.thumbnailFolder); }
  catch (error) { if (strict) throw error; thumbnailFolder = DEFAULT_THUMBNAIL_FOLDER; }
  return {
    cardMode: saved.cardMode === 'expanded' ? 'expanded' : 'compact',
    cardFormat: saved.cardFormat === 'html' ? 'html' : 'native',
    saveThumbnails: saved.saveThumbnails === true, thumbnailFolder,
    timeoutMs: Math.max(1000, Math.min(15000, Number(saved.timeoutMs) || DEFAULTS.timeoutMs)),
    replaceTitle: saved.replaceTitle !== false, useOEmbed: saved.useOEmbed === true,
  };
}
module.exports = { DEFAULTS, normalizeConfig };
