require('dotenv').config();

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { pool } = require('../config/db');

const SALT_ROUNDS = 10;
const USERID_REGEX = /^[a-zA-Z0-9_]{4,20}$/;
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[0-9-]{9,20}$/;
const VALID_CATEGORIES = new Set(['NEW', 'BEST', 'OUTER', 'TOP', 'BOTTOM']);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const DEMO_PRODUCTS = [
  {
    name: '베이직 오버핏 코트',
    category: 'OUTER',
    price: 189000,
    image: '/images/demo-coat.svg',
    description: '여유로운 드롭 숄더 실루엣과 단정한 테일러드 칼라가 돋보이는 데일리 울 블렌드 코트입니다.',
    stock: 15,
    sizes: ['M', 'L', 'XL'],
    colors: ['BLACK', 'BEIGE', 'CHARCOAL'],
  },
  {
    name: '클래식 울 자켓',
    category: 'OUTER',
    price: 149000,
    image: '/images/demo-jacket.svg',
    description: '탄탄한 울 소재로 핏을 깔끔하게 잡아주며 다양한 이너와 매치하기 좋은 싱글 자켓입니다.',
    stock: 12,
    sizes: ['S', 'M', 'L'],
    colors: ['BLACK', 'BROWN'],
  },
  {
    name: '데일리 니트',
    category: 'TOP',
    price: 69000,
    image: '/images/demo-knit.svg',
    description: '부드러운 터치감의 원사를 사용해 단독 또는 아우터 이너로 활용도가 높은 크루넥 니트입니다.',
    stock: 25,
    sizes: ['S', 'M', 'L'],
    colors: ['IVORY', 'BEIGE', 'NAVY'],
  },
  {
    name: '오버핏 셔츠',
    category: 'NEW',
    price: 59000,
    image: '/images/demo-shirt.svg',
    description: '고밀도 코튼 포플린 원단으로 자연스러운 구김과 여유로운 착용감을 선사하는 신상 셔츠입니다.',
    stock: 30,
    sizes: ['M', 'L', 'XL'],
    colors: ['WHITE', 'SKYBLUE', 'BEIGE'],
  },
  {
    name: '베이직 맨투맨',
    category: 'BEST',
    price: 49000,
    image: '/images/demo-sweatshirt.svg',
    description: '탄탄한 헤비웨이트 코튼 쭈리 원단과 깔끔한 넥 라인 시보리가 특징인 베스트 스웨트셔츠입니다.',
    stock: 28,
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['MELANGE', 'BLACK', 'OATMEAL'],
  },
  {
    name: '와이드 데님 팬츠',
    category: 'BOTTOM',
    price: 79000,
    image: '/images/demo-denim.svg',
    description: '자연스럽게 떨어지는 와이드 스트레이트 핏으로 다리가 길어 보이는 데일리 데님 팬츠입니다.',
    stock: 20,
    sizes: ['S', 'M', 'L'],
    colors: ['INDIGO', 'BLACK'],
  },
  {
    name: '코튼 팬츠',
    category: 'BOTTOM',
    price: 64000,
    image: '/images/demo-cotton-pants.svg',
    description: '원턱 디테일과 쾌적한 코튼 트윌 소재로 편안하면서도 포멀한 무드를 내는 치노 팬츠입니다.',
    stock: 22,
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['BEIGE', 'KHAKI', 'BLACK'],
  },
  {
    name: '데일리 티셔츠',
    category: 'TOP',
    price: 29000,
    image: '/images/demo-tshirt.svg',
    description: '비침 없는 적당한 두께감과 목 늘어짐을 줄인 수피마 코튼 반팔 티셔츠입니다.',
    stock: 40,
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['WHITE', 'BLACK', 'BEIGE'],
  },
];

/**
 * Validate required DEMO_MEMBER_* environment variables without exposing secrets.
 */
function validateDemoMemberEnv(env = process.env) {
  const userid = typeof env.DEMO_MEMBER_USERID === 'string' ? env.DEMO_MEMBER_USERID.trim() : '';
  const password = typeof env.DEMO_MEMBER_PASSWORD === 'string' ? env.DEMO_MEMBER_PASSWORD : '';
  const name = typeof env.DEMO_MEMBER_NAME === 'string' ? env.DEMO_MEMBER_NAME.trim() : '';
  const email = typeof env.DEMO_MEMBER_EMAIL === 'string' ? env.DEMO_MEMBER_EMAIL.trim().toLowerCase() : '';
  const phone = typeof env.DEMO_MEMBER_PHONE === 'string' ? env.DEMO_MEMBER_PHONE.trim() : '';
  const address = typeof env.DEMO_MEMBER_ADDRESS === 'string' ? env.DEMO_MEMBER_ADDRESS.trim() : '';

  const missing = [];
  if (!userid) missing.push('DEMO_MEMBER_USERID');
  if (!password) missing.push('DEMO_MEMBER_PASSWORD');
  if (!name) missing.push('DEMO_MEMBER_NAME');
  if (!email) missing.push('DEMO_MEMBER_EMAIL');
  if (!phone) missing.push('DEMO_MEMBER_PHONE');
  if (!address) missing.push('DEMO_MEMBER_ADDRESS');

  if (missing.length > 0) {
    return {
      ok: false,
      error: `필수 환경변수(${missing.join(', ')})를 모두 설정해 주세요.`,
    };
  }

  if (!USERID_REGEX.test(userid)) {
    return { ok: false, error: 'DEMO_MEMBER_USERID는 영문, 숫자, 밑줄(_) 조합 4~20자여야 합니다.' };
  }
  if (!PASSWORD_REGEX.test(password)) {
    return { ok: false, error: 'DEMO_MEMBER_PASSWORD는 영문과 숫자를 포함해 8~64자여야 합니다.' };
  }
  if (name.length < 2 || name.length > 50) {
    return { ok: false, error: 'DEMO_MEMBER_NAME은 2~50자여야 합니다.' };
  }
  if (!EMAIL_REGEX.test(email) || email.length > 100) {
    return { ok: false, error: 'DEMO_MEMBER_EMAIL 형식이 올바르지 않습니다.' };
  }
  if (!PHONE_REGEX.test(phone)) {
    return { ok: false, error: 'DEMO_MEMBER_PHONE은 숫자와 하이픈(-)을 포함해 9~20자여야 합니다.' };
  }
  if (address.length > 255) {
    return { ok: false, error: 'DEMO_MEMBER_ADDRESS는 255자 이하여야 합니다.' };
  }

  return {
    ok: true,
    member: { userid, password, name, email, phone, address },
  };
}

/**
 * Verify all demo products have valid categories and existing local image files under public/.
 */
function verifyDemoProducts(products = DEMO_PRODUCTS) {
  const issues = [];
  for (const product of products) {
    if (!VALID_CATEGORIES.has(product.category)) {
      issues.push(`${product.name}: 지원하지 않는 카테고리(${product.category})`);
    }
    if (!product.image || !product.image.startsWith('/')) {
      issues.push(`${product.name}: 이미지 경로 형식 오류`);
      continue;
    }
    const relPath = product.image.replace(/^\/+/, '');
    const fullPath = path.join(PUBLIC_DIR, relPath);
    if (!fs.existsSync(fullPath)) {
      issues.push(`${product.name}: 이미지 파일 없음 (${product.image})`);
    }
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Insert demo user (role='user') and demo products idempotently inside a transaction.
 */
async function seedDemoData() {
  const envCheck = validateDemoMemberEnv(process.env);
  if (!envCheck.ok) {
    console.error('[중단]', envCheck.error);
    process.exitCode = 1;
    return { ok: false, reason: envCheck.error };
  }

  const productCheck = verifyDemoProducts(DEMO_PRODUCTS);
  if (!productCheck.ok) {
    console.error('[중단] 상품 정의 검증 실패:', productCheck.issues.join('; '));
    process.exitCode = 1;
    return { ok: false, reason: productCheck.issues.join('; ') };
  }

  const { member } = envCheck;
  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // 1. 일반 회원 중복 확인 및 등록 (role은 무조건 'user'로 고정)
    const [existingMembers] = await conn.execute(
      'SELECT id, userid, email FROM members WHERE userid = ? OR email = ? LIMIT 1',
      [member.userid, member.email]
    );

    let createdMember = null;
    let skippedMember = null;

    if (existingMembers.length > 0) {
      skippedMember = {
        id: existingMembers[0].id,
        userid: existingMembers[0].userid,
        email: existingMembers[0].email,
      };
    } else {
      const hashedPassword = await bcrypt.hash(member.password, SALT_ROUNDS);
      const [memberResult] = await conn.execute(
        `INSERT INTO members (userid, password, name, email, phone, address, role, cart_json, orders_json)
         VALUES (?, ?, ?, ?, ?, ?, 'user', JSON_ARRAY(), JSON_ARRAY())`,
        [member.userid, hashedPassword, member.name, member.email, member.phone, member.address]
      );
      createdMember = {
        id: memberResult.insertId,
        userid: member.userid,
        name: member.name,
        email: member.email,
        role: 'user',
      };
    }

    // 2. 시연 상품 중복 확인(이름 + 카테고리) 및 등록
    const createdProducts = [];
    const skippedProducts = [];

    for (const item of DEMO_PRODUCTS) {
      const [existingProducts] = await conn.execute(
        'SELECT id, name, category FROM products WHERE name = ? AND category = ? LIMIT 1',
        [item.name, item.category]
      );

      if (existingProducts.length > 0) {
        skippedProducts.push({
          id: existingProducts[0].id,
          name: existingProducts[0].name,
          category: existingProducts[0].category,
        });
        continue;
      }

      const [prodResult] = await conn.execute(
        `INSERT INTO products (name, category, price, image, description, stock, sizes, colors)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.name,
          item.category,
          item.price,
          item.image,
          item.description,
          item.stock,
          JSON.stringify(item.sizes),
          JSON.stringify(item.colors),
        ]
      );

      createdProducts.push({
        id: prodResult.insertId,
        name: item.name,
        category: item.category,
        price: item.price,
        stock: item.stock,
      });
    }

    await conn.commit();

    console.log('[완료] 시연용 데이터 등록 처리가 완료되었습니다.');
    if (createdMember) {
      console.log(
        `- 일반 회원 생성: #${createdMember.id} (${createdMember.userid} / ${createdMember.name} / role=${createdMember.role})`
      );
    } else if (skippedMember) {
      console.log(
        `- 일반 회원 건너뜀(기존 존재): #${skippedMember.id} (${skippedMember.userid})`
      );
    }
    console.log(`- 신규 등록 상품: ${createdProducts.length}개`);
    for (const p of createdProducts) {
      console.log(`  * #${p.id} [${p.category}] ${p.name} (${p.price.toLocaleString('ko-KR')}원, 재고 ${p.stock}개)`);
    }
    if (skippedProducts.length > 0) {
      console.log(`- 중복 건너뛴 상품: ${skippedProducts.length}개`);
      for (const p of skippedProducts) {
        console.log(`  * #${p.id} [${p.category}] ${p.name}`);
      }
    }

    return { ok: true, createdMember, skippedMember, createdProducts, skippedProducts };
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (_) {}
    }
    console.error('[오류] 시연용 데이터 등록 중 문제가 발생해 롤백했습니다:', err.code || err.message);
    process.exitCode = 1;
    return { ok: false, reason: err.code || err.message };
  } finally {
    if (conn) conn.release();
    await pool.end();
  }
}

if (require.main === module) {
  seedDemoData();
}

module.exports = {
  DEMO_PRODUCTS,
  validateDemoMemberEnv,
  verifyDemoProducts,
  seedDemoData,
};
