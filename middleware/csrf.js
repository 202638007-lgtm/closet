const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function ensureCsrfToken(req, res, next) {
  if (!req.session) {
    return next(new Error('세션이 초기화되지 않았습니다.'));
  }
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  res.locals.csrfToken = req.session.csrfToken;
  return next();
}

function verifyCsrfToken(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const sessionToken = req.session ? req.session.csrfToken : '';
  const submittedToken =
    (req.body && typeof req.body._csrf === 'string' ? req.body._csrf : '') ||
    (typeof req.get('x-csrf-token') === 'string' ? req.get('x-csrf-token') : '');

  if (!sessionToken || !submittedToken) {
    return res.status(403).send('잘못된 요청입니다. 페이지를 새로고침한 후 다시 시도해 주세요.');
  }

  const a = Buffer.from(sessionToken, 'utf8');
  const b = Buffer.from(submittedToken, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).send('보안 토큰이 유효하지 않습니다. 페이지를 새로고침한 후 다시 시도해 주세요.');
  }

  return next();
}

module.exports = {
  generateCsrfToken,
  ensureCsrfToken,
  verifyCsrfToken,
};
