const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../config/db');
const { redirectIfAuthenticated } = require('../middleware/auth');
const { generateCsrfToken } = require('../middleware/csrf');

const router = express.Router();

const SALT_ROUNDS = 10;
const USERID_REGEX = /^[a-zA-Z0-9_]{4,20}$/;
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[0-9-]{9,20}$/;

function validateRegisterInput(body) {
  const userid = typeof body.userid === 'string' ? body.userid.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const passwordConfirm = typeof body.passwordConfirm === 'string' ? body.passwordConfirm : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const address = typeof body.address === 'string' ? body.address.trim() : '';

  const formData = { userid, name, email, phone, address };

  if (!userid || !password || !passwordConfirm || !name || !email || !phone || !address) {
    return { error: '모든 필수 항목을 입력해 주세요.', formData };
  }
  if (!USERID_REGEX.test(userid)) {
    return { error: '아이디는 영문, 숫자, 밑줄(_) 조합 4~20자로 입력해 주세요.', formData };
  }
  if (!PASSWORD_REGEX.test(password)) {
    return { error: '비밀번호는 영문과 숫자를 포함하여 8~64자로 입력해 주세요.', formData };
  }
  if (password !== passwordConfirm) {
    return { error: '비밀번호와 비밀번호 확인이 일치하지 않습니다.', formData };
  }
  if (name.length < 2 || name.length > 50) {
    return { error: '이름은 2~50자로 입력해 주세요.', formData };
  }
  if (!EMAIL_REGEX.test(email) || email.length > 100) {
    return { error: '올바른 이메일 형식을 입력해 주세요.', formData };
  }
  if (!PHONE_REGEX.test(phone)) {
    return { error: '전화번호는 숫자와 하이픈(-)을 포함해 9~20자로 입력해 주세요.', formData };
  }
  if (address.length > 255) {
    return { error: '주소는 255자 이하로 입력해 주세요.', formData };
  }

  return {
    error: null,
    data: { userid, password, name, email, phone, address },
    formData,
  };
}

// 회원가입 페이지
router.get('/register', redirectIfAuthenticated, (req, res) => {
  res.render('auth/register', {
    title: '회원가입 | CLOSET',
    error: null,
    formData: {},
  });
});

// 회원가입 처리
router.post('/register', redirectIfAuthenticated, async (req, res, next) => {
  const { error, data, formData } = validateRegisterInput(req.body);
  if (error) {
    return res.status(400).render('auth/register', {
      title: '회원가입 | CLOSET',
      error,
      formData,
    });
  }

  try {
    const [existing] = await pool.execute(
      'SELECT userid, email FROM members WHERE userid = ? OR email = ?',
      [data.userid, data.email]
    );

    if (existing.length > 0) {
      const dupUserid = existing.some((row) => row.userid === data.userid);
      const message = dupUserid
        ? '이미 사용 중인 아이디입니다.'
        : '이미 가입된 이메일입니다.';
      return res.status(409).render('auth/register', {
        title: '회원가입 | CLOSET',
        error: message,
        formData,
      });
    }

    const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);

    // role은 서버에서 무조건 'user'로 고정 저장 (클라이언트 지정 불가)
    await pool.execute(
      `INSERT INTO members (userid, password, name, email, phone, address, role, cart_json, orders_json)
       VALUES (?, ?, ?, ?, ?, ?, 'user', JSON_ARRAY(), JSON_ARRAY())`,
      [data.userid, hashedPassword, data.name, data.email, data.phone, data.address]
    );

    req.session.flash = {
      type: 'success',
      message: '회원가입이 완료되었습니다. 로그인해 주세요.',
    };
    return res.redirect('/auth/login');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).render('auth/register', {
        title: '회원가입 | CLOSET',
        error: '이미 사용 중인 아이디 또는 이메일입니다.',
        formData,
      });
    }
    return next(err);
  }
});

// 로그인 페이지
router.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('auth/login', {
    title: '로그인 | CLOSET',
    error: null,
    userid: '',
  });
});

// 로그인 처리
router.post('/login', redirectIfAuthenticated, async (req, res, next) => {
  const userid = typeof req.body.userid === 'string' ? req.body.userid.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!userid || !password) {
    return res.status(400).render('auth/login', {
      title: '로그인 | CLOSET',
      error: '아이디와 비밀번호를 모두 입력해 주세요.',
      userid,
    });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT id, userid, password, name, email, role FROM members WHERE userid = ? LIMIT 1',
      [userid]
    );

    if (rows.length === 0) {
      return res.status(401).render('auth/login', {
        title: '로그인 | CLOSET',
        error: '아이디 또는 비밀번호가 올바르지 않습니다.',
        userid,
      });
    }

    const member = rows[0];
    const isMatch = await bcrypt.compare(password, member.password);
    if (!isMatch) {
      return res.status(401).render('auth/login', {
        title: '로그인 | CLOSET',
        error: '아이디 또는 비밀번호가 올바르지 않습니다.',
        userid,
      });
    }

    // 세션 고정 공격 방지 및 비밀번호 제외한 안전한 정보만 세션에 저장
    return req.session.regenerate((regenErr) => {
      if (regenErr) return next(regenErr);

      req.session.user = {
        id: member.id,
        userid: member.userid,
        name: member.name,
        email: member.email,
        role: member.role,
      };
      req.session.csrfToken = generateCsrfToken();
      req.session.flash = {
        type: 'success',
        message: `${member.name}님, 환영합니다.`,
      };
      return res.redirect('/');
    });
  } catch (err) {
    return next(err);
  }
});

// 로그아웃 처리
router.post('/logout', (req, res, next) => {
  if (!req.session) {
    return res.redirect('/');
  }
  return req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('closet.sid');
    return res.redirect('/');
  });
});

module.exports = router;
