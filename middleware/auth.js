/**
 * Authentication and authorization middlewares.
 */

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  if (req.accepts(['html', 'json']) === 'json') {
    return res.status(401).json({ message: '로그인이 필요합니다.' });
  }
  req.session.flash = {
    type: 'error',
    message: '로그인 후 이용할 수 있는 서비스입니다.',
  };
  return res.redirect('/auth/login');
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    req.session.flash = {
      type: 'error',
      message: '관리자 로그인이 필요합니다.',
    };
    return res.redirect('/auth/login');
  }
  if (req.session.user.role !== 'admin') {
    if (req.accepts(['html', 'json']) === 'json') {
      return res.status(403).json({ message: '접근 권한이 없습니다.' });
    }
    return res.status(403).render('error', {
      title: '접근 권한 없음 | CLOSET',
      statusCode: 403,
      heading: '접근 권한이 없습니다.',
      message: '관리자만 접근할 수 있는 페이지입니다.',
    });
  }
  return next();
}

function redirectIfAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return res.redirect('/');
  }
  return next();
}

module.exports = {
  requireAuth,
  requireAdmin,
  redirectIfAuthenticated,
};
