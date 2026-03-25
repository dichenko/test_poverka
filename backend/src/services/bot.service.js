const crypto = require('crypto');
const config = require('../config');

function createTokenSource(maxUserId) {
  return `${maxUserId}:${config.miniappSharedSecret}`;
}

function generateMiniappToken(maxUserId) {
  return crypto.createHash('sha256').update(createTokenSource(maxUserId)).digest('hex');
}

function validateMiniappToken(maxUserId, token) {
  if (!maxUserId || !token) {
    return false;
  }

  const expectedToken = generateMiniappToken(maxUserId);
  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expectedToken);

  if (tokenBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
}

function buildMiniappLink(maxUserId) {
  const url = new URL(config.miniappPublicUrl);
  url.searchParams.set('user_id', maxUserId);
  url.searchParams.set('token', generateMiniappToken(maxUserId));
  return url.toString();
}

function normalizeText(text) {
  return String(text || '').trim().toLowerCase();
}

function isConfirmationText(text) {
  return normalizeText(text) === 'подтверждаю';
}

module.exports = {
  buildMiniappLink,
  generateMiniappToken,
  validateMiniappToken,
  normalizeText,
  isConfirmationText
};
