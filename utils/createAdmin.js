require('dotenv').config();

const bcrypt = require('bcrypt');
const { pool } = require('../config/db');

const SALT_ROUNDS = 10;
const USERID_REGEX = /^[a-zA-Z0-9_]{4,20}$/;
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function createAdmin() {
  const userid = typeof process.env.ADMIN_USERID === 'string' ? process.env.ADMIN_USERID.trim() : '';
  const password = typeof process.env.ADMIN_PASSWORD === 'string' ? process.env.ADMIN_PASSWORD : '';
  const name = typeof process.env.ADMIN_NAME === 'string' ? process.env.ADMIN_NAME.trim() : '';
  const email = typeof process.env.ADMIN_EMAIL === 'string' ? process.env.ADMIN_EMAIL.trim().toLowerCase() : '';

  if (!userid || !password || !name || !email) {
    console.error('[오류] 필수 환경변수(ADMIN_USERID, ADMIN_PASSWORD, ADMIN_NAME, ADMIN_EMAIL)를 모두 설정해 주세요.');
    process.exitCode = 1;
    return;
  }

  if (!USERID_REGEX.test(userid)) {
    console.error('[오류] ADMIN_USERID는 영문, 숫자, 밑줄(_) 조합 4~20자여야 합니다.');
    process.exitCode = 1;
    return;
  }

  if (!PASSWORD_REGEX.test(password)) {
    console.error('[오류] ADMIN_PASSWORD는 영문과 숫자를 포함해 8~64자여야 합니다.');
    process.exitCode = 1;
    return;
  }

  if (name.length < 2 || name.length > 50) {
    console.error('[오류] ADMIN_NAME은 2~50자여야 합니다.');
    process.exitCode = 1;
    return;
  }

  if (!EMAIL_REGEX.test(email) || email.length > 100) {
    console.error('[오류] ADMIN_EMAIL 형식이 올바르지 않습니다.');
    process.exitCode = 1;
    return;
  }

  try {
    const [existing] = await pool.execute(
      'SELECT id, userid, email, role FROM members WHERE userid = ? OR email = ? LIMIT 1',
      [userid, email]
    );

    if (existing.length > 0) {
      const row = existing[0];
      console.error(
        `[중단] 동일한 아이디(${row.userid}) 또는 이메일(${row.email})이 이미 존재합니다. 기존 계정은 변경하거나 승격하지 않았습니다.`
      );
      process.exitCode = 1;
      return;
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const [result] = await pool.execute(
      `INSERT INTO members (userid, password, name, email, role, cart_json, orders_json)
       VALUES (?, ?, ?, ?, 'admin', JSON_ARRAY(), JSON_ARRAY())`,
      [userid, hashedPassword, name, email]
    );

    console.log('[완료] 관리자 계정이 생성되었습니다.');
    console.log(`- 회원 번호: ${result.insertId}`);
    console.log(`- 아이디: ${userid}`);
    console.log(`- 이름: ${name}`);
    console.log(`- 이메일: ${email}`);
    console.log('- 권한: admin');
  } catch (err) {
    console.error('[오류] 관리자 계정 생성 중 문제가 발생했습니다:', err.code || err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  createAdmin();
}

module.exports = { createAdmin };
