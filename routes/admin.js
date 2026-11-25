const express = require('express');
const { pool } = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { parseProductOptions } = require('../utils/cart');
const { ORDER_STATUSES, parseOrdersJson, formatKoreanDateTime } = require('../utils/orders');

const router = express.Router();

const VALID_CATEGORIES = ['NEW', 'BEST', 'OUTER', 'TOP', 'BOTTOM'];
const VALID_ROLES = ['user', 'admin'];
const SAFE_IMAGE_URL_REGEX = /^(\/(?!\/)|https?:\/\/)/i;

router.use(requireAdmin);

function parsePositiveInt(raw) {
  const value = typeof raw === 'string' ? raw.trim() : String(raw || '').trim();
  if (!/^[1-9]\d*$/.test(value)) return null;
  return Number(value);
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

function parseOptionListInput(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const seen = new Set();
  const result = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

function validateProductInput(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim().toUpperCase() : '';
  const priceRaw = typeof body.price === 'string' ? body.price.trim() : String(body.price ?? '').trim();
  const stockRaw = typeof body.stock === 'string' ? body.stock.trim() : String(body.stock ?? '').trim();
  const image = typeof body.image === 'string' ? body.image.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const sizesRaw = typeof body.sizes === 'string' ? body.sizes.trim() : '';
  const colorsRaw = typeof body.colors === 'string' ? body.colors.trim() : '';

  const formData = {
    name,
    category,
    price: priceRaw,
    stock: stockRaw,
    image,
    description,
    sizes: sizesRaw,
    colors: colorsRaw,
  };

  if (!name || name.length > 100) {
    return { error: '상품명은 1~100자로 입력해 주세요.', formData };
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return { error: '올바른 상품 카테고리를 선택해 주세요.', formData };
  }
  if (!/^\d+$/.test(priceRaw)) {
    return { error: '판매 가격은 0 이상의 정수로 입력해 주세요.', formData };
  }
  const price = Number(priceRaw);
  if (!Number.isSafeInteger(price) || price < 0 || price > 100000000) {
    return { error: '판매 가격은 0원 ~ 100,000,000원 사이로 입력해 주세요.', formData };
  }
  if (!/^\d+$/.test(stockRaw)) {
    return { error: '재고 수량은 0 이상의 정수로 입력해 주세요.', formData };
  }
  const stock = Number(stockRaw);
  if (!Number.isSafeInteger(stock) || stock < 0 || stock > 100000) {
    return { error: '재고 수량은 0 ~ 100,000개 사이로 입력해 주세요.', formData };
  }
  if (image) {
    if (image.length > 255) {
      return { error: '이미지 경로는 255자 이하로 입력해 주세요.', formData };
    }
    if (!SAFE_IMAGE_URL_REGEX.test(image)) {
      return { error: '이미지 경로는 "/" 또는 "http://", "https://"로 시작해야 합니다.', formData };
    }
  }
  if (description.length > 5000) {
    return { error: '상품 설명은 5,000자 이하로 입력해 주세요.', formData };
  }

  const sizes = parseOptionListInput(sizesRaw);
  if (sizes.some((s) => s.length > 20)) {
    return { error: '각 사이즈 옵션은 20자 이하로 입력해 주세요.', formData };
  }
  const colors = parseOptionListInput(colorsRaw);
  if (colors.some((c) => c.length > 30)) {
    return { error: '각 색상 옵션은 30자 이하로 입력해 주세요.', formData };
  }

  return {
    error: null,
    data: {
      name,
      category,
      price,
      stock,
      image: image || null,
      description: description || null,
      sizes,
      colors,
    },
    formData,
  };
}

function collectAllOrders(memberRows) {
  const allOrders = [];
  for (const member of memberRows) {
    const orders = parseOrdersJson(member.orders_json);
    for (const order of orders) {
      allOrders.push({
        ...order,
        member_id: member.id,
        member_userid: member.userid,
        member_name: member.name,
        member_email: member.email,
      });
    }
  }
  allOrders.sort((a, b) => new Date(b.order_date) - new Date(a.order_date));
  return allOrders;
}

function renderAdminNotFound(res, heading, message) {
  return res.status(404).render('error', {
    title: `${heading} | CLOSET`,
    statusCode: 404,
    heading,
    message,
  });
}

// 1. 관리자 대시보드
router.get('/', async (req, res, next) => {
  try {
    const [productStatsRows] = await pool.execute(`
      SELECT
        COUNT(*) AS totalProducts,
        COALESCE(SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END), 0) AS soldOutProducts,
        COALESCE(SUM(CASE WHEN stock > 0 AND stock <= 5 THEN 1 ELSE 0 END), 0) AS lowStockProducts
      FROM products
    `);
    const productStats = productStatsRows[0] || {
      totalProducts: 0,
      soldOutProducts: 0,
      lowStockProducts: 0,
    };

    const [recentProducts] = await pool.execute(
      'SELECT id, name, category, price, stock, image, created_at FROM products ORDER BY created_at DESC, id DESC LIMIT 5'
    );

    const [lowStockList] = await pool.execute(
      'SELECT id, name, category, price, stock FROM products WHERE stock <= 5 ORDER BY stock ASC, id ASC LIMIT 5'
    );

    const [memberRows] = await pool.execute(
      'SELECT id, userid, name, email, role, orders_json, created_at FROM members ORDER BY created_at DESC, id DESC'
    );

    const allOrders = collectAllOrders(memberRows);
    const activeOrders = allOrders.filter((order) => order.status !== '주문취소');
    const totalRevenue = activeOrders.reduce((sum, order) => sum + (Number(order.total_price) || 0), 0);
    const pendingOrdersCount = allOrders.filter(
      (order) => order.status === '주문접수' || order.status === '배송준비'
    ).length;

    const adminCount = memberRows.filter((m) => m.role === 'admin').length;
    const statusCounts = ORDER_STATUSES.reduce((acc, status) => {
      acc[status] = 0;
      return acc;
    }, {});
    for (const order of allOrders) {
      if (Object.prototype.hasOwnProperty.call(statusCounts, order.status)) {
        statusCounts[order.status] += 1;
      }
    }

    return res.render('admin/dashboard', {
      title: '관리자 대시보드 | CLOSET',
      stats: {
        totalProducts: Number(productStats.totalProducts) || 0,
        soldOutProducts: Number(productStats.soldOutProducts) || 0,
        lowStockProducts: Number(productStats.lowStockProducts) || 0,
        totalMembers: memberRows.length,
        adminCount,
        userCount: memberRows.length - adminCount,
        totalOrders: allOrders.length,
        pendingOrdersCount,
        totalRevenue,
        statusCounts,
      },
      orderStatuses: ORDER_STATUSES,
      recentProducts,
      lowStockList,
      recentOrders: allOrders.slice(0, 5),
      recentMembers: memberRows.slice(0, 5),
      formatKoreanDateTime,
    });
  } catch (err) {
    return next(err);
  }
});

// 2. 상품 관리 - 목록
router.get('/products', async (req, res, next) => {
  try {
    const rawCategory = typeof req.query.category === 'string' ? req.query.category.trim().toUpperCase() : '';
    const activeCategory = VALID_CATEGORIES.includes(rawCategory) ? rawCategory : '';
    const searchTerm = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 50) : '';

    const conditions = [];
    const params = [];

    if (activeCategory) {
      conditions.push('category = ?');
      params.push(activeCategory);
    }
    if (searchTerm) {
      conditions.push("name LIKE ? ESCAPE '\\\\'");
      params.push(`%${escapeLike(searchTerm)}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.execute(
      `SELECT id, name, category, price, image, stock, sizes, colors, created_at
       FROM products
       ${whereClause}
       ORDER BY id DESC`,
      params
    );

    const products = rows.map((p) => ({
      ...p,
      sizesList: parseProductOptions(p.sizes),
      colorsList: parseProductOptions(p.colors),
    }));

    return res.render('admin/products', {
      title: '상품 관리 | CLOSET 관리자',
      products,
      categories: VALID_CATEGORIES,
      activeCategory,
      searchTerm,
      formatKoreanDateTime,
    });
  } catch (err) {
    return next(err);
  }
});

// 상품 등록 폼
router.get('/products/new', (req, res) => {
  return res.render('admin/product-form', {
    title: '상품 등록 | CLOSET 관리자',
    isEdit: false,
    productId: null,
    categories: VALID_CATEGORIES,
    error: null,
    formData: {
      name: '',
      category: 'NEW',
      price: '',
      stock: '10',
      image: '',
      description: '',
      sizes: 'S, M, L',
      colors: 'BLACK, BEIGE',
    },
  });
});

// 상품 등록 처리
router.post('/products', async (req, res, next) => {
  const { error, data, formData } = validateProductInput(req.body);
  if (error) {
    return res.status(400).render('admin/product-form', {
      title: '상품 등록 | CLOSET 관리자',
      isEdit: false,
      productId: null,
      categories: VALID_CATEGORIES,
      error,
      formData,
    });
  }

  try {
    await pool.execute(
      `INSERT INTO products (name, category, price, image, description, stock, sizes, colors)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name,
        data.category,
        data.price,
        data.image,
        data.description,
        data.stock,
        JSON.stringify(data.sizes),
        JSON.stringify(data.colors),
      ]
    );

    req.session.flash = {
      type: 'success',
      message: `'${data.name}' 상품이 등록되었습니다.`,
    };
    return res.redirect('/admin/products');
  } catch (err) {
    return next(err);
  }
});

// 상품 수정 폼
router.get('/products/:id/edit', async (req, res, next) => {
  const productId = parsePositiveInt(req.params.id);
  if (!productId) {
    return renderAdminNotFound(res, '상품을 찾을 수 없습니다.', '올바르지 않은 상품 번호입니다.');
  }

  try {
    const [rows] = await pool.execute(
      'SELECT id, name, category, price, image, description, stock, sizes, colors FROM products WHERE id = ? LIMIT 1',
      [productId]
    );
    if (rows.length === 0) {
      return renderAdminNotFound(res, '상품을 찾을 수 없습니다.', '수정하려는 상품이 존재하지 않습니다.');
    }

    const product = rows[0];
    return res.render('admin/product-form', {
      title: '상품 수정 | CLOSET 관리자',
      isEdit: true,
      productId: product.id,
      categories: VALID_CATEGORIES,
      error: null,
      formData: {
        name: product.name,
        category: product.category,
        price: String(product.price),
        stock: String(product.stock),
        image: product.image || '',
        description: product.description || '',
        sizes: parseProductOptions(product.sizes).join(', '),
        colors: parseProductOptions(product.colors).join(', '),
      },
    });
  } catch (err) {
    return next(err);
  }
});

// 상품 수정 처리
router.post('/products/:id/edit', async (req, res, next) => {
  const productId = parsePositiveInt(req.params.id);
  if (!productId) {
    return renderAdminNotFound(res, '상품을 찾을 수 없습니다.', '올바르지 않은 상품 번호입니다.');
  }

  const { error, data, formData } = validateProductInput(req.body);
  if (error) {
    return res.status(400).render('admin/product-form', {
      title: '상품 수정 | CLOSET 관리자',
      isEdit: true,
      productId,
      categories: VALID_CATEGORIES,
      error,
      formData,
    });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE products
       SET name = ?, category = ?, price = ?, image = ?, description = ?, stock = ?, sizes = ?, colors = ?
       WHERE id = ?`,
      [
        data.name,
        data.category,
        data.price,
        data.image,
        data.description,
        data.stock,
        JSON.stringify(data.sizes),
        JSON.stringify(data.colors),
        productId,
      ]
    );

    if (!result || result.affectedRows === 0) {
      return renderAdminNotFound(res, '상품을 찾을 수 없습니다.', '수정하려는 상품이 존재하지 않습니다.');
    }

    req.session.flash = {
      type: 'success',
      message: `'${data.name}' 상품 정보가 수정되었습니다.`,
    };
    return res.redirect('/admin/products');
  } catch (err) {
    return next(err);
  }
});

// 상품 삭제 처리
router.post('/products/:id/delete', async (req, res, next) => {
  const productId = parsePositiveInt(req.params.id);
  if (!productId) {
    req.session.flash = { type: 'error', message: '올바르지 않은 상품 번호입니다.' };
    return res.redirect('/admin/products');
  }

  try {
    const [result] = await pool.execute('DELETE FROM products WHERE id = ?', [productId]);
    if (!result || result.affectedRows === 0) {
      req.session.flash = { type: 'error', message: '이미 삭제되었거나 존재하지 않는 상품입니다.' };
    } else {
      req.session.flash = { type: 'success', message: '상품이 삭제되었습니다.' };
    }
    return res.redirect('/admin/products');
  } catch (err) {
    return next(err);
  }
});

// 3. 회원 관리 - 목록
router.get('/members', async (req, res, next) => {
  try {
    const rawRole = typeof req.query.role === 'string' ? req.query.role.trim().toLowerCase() : '';
    const activeRole = VALID_ROLES.includes(rawRole) ? rawRole : '';
    const searchTerm = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 50) : '';

    const conditions = [];
    const params = [];

    if (activeRole) {
      conditions.push('role = ?');
      params.push(activeRole);
    }
    if (searchTerm) {
      const pattern = `%${escapeLike(searchTerm)}%`;
      conditions.push("(userid LIKE ? ESCAPE '\\\\' OR name LIKE ? ESCAPE '\\\\' OR email LIKE ? ESCAPE '\\\\')");
      params.push(pattern, pattern, pattern);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.execute(
      `SELECT id, userid, name, email, phone, address, role, orders_json, created_at
       FROM members
       ${whereClause}
       ORDER BY id DESC`,
      params
    );

    const members = rows.map((row) => {
      const orders = parseOrdersJson(row.orders_json);
      const validOrders = orders.filter((o) => o.status !== '주문취소');
      const totalSpent = validOrders.reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);
      return {
        id: row.id,
        userid: row.userid,
        name: row.name,
        email: row.email,
        phone: row.phone,
        address: row.address,
        role: row.role,
        created_at: row.created_at,
        orderCount: orders.length,
        totalSpent,
      };
    });

    return res.render('admin/members', {
      title: '회원 관리 | CLOSET 관리자',
      members,
      activeRole,
      searchTerm,
      formatKoreanDateTime,
    });
  } catch (err) {
    return next(err);
  }
});

// 회원 상세 조회
router.get('/members/:id', async (req, res, next) => {
  const memberId = parsePositiveInt(req.params.id);
  if (!memberId) {
    return renderAdminNotFound(res, '회원을 찾을 수 없습니다.', '올바르지 않은 회원 번호입니다.');
  }

  try {
    const [rows] = await pool.execute(
      'SELECT id, userid, name, email, phone, address, role, orders_json, created_at FROM members WHERE id = ? LIMIT 1',
      [memberId]
    );
    if (rows.length === 0) {
      return renderAdminNotFound(res, '회원을 찾을 수 없습니다.', '요청하신 회원이 존재하지 않습니다.');
    }

    const row = rows[0];
    const orders = parseOrdersJson(row.orders_json)
      .slice()
      .sort((a, b) => new Date(b.order_date) - new Date(a.order_date));
    const totalSpent = orders
      .filter((o) => o.status !== '주문취소')
      .reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);

    return res.render('admin/member-detail', {
      title: `회원 상세 (${row.userid}) | CLOSET 관리자`,
      member: {
        id: row.id,
        userid: row.userid,
        name: row.name,
        email: row.email,
        phone: row.phone,
        address: row.address,
        role: row.role,
        created_at: row.created_at,
        totalSpent,
      },
      orders,
      formatKoreanDateTime,
    });
  } catch (err) {
    return next(err);
  }
});

// 회원 권한 변경
router.post('/members/:id/role', async (req, res, next) => {
  const memberId = parsePositiveInt(req.params.id);
  const nextRole = typeof req.body.role === 'string' ? req.body.role.trim().toLowerCase() : '';
  const redirectBack = req.body.redirect_to === 'detail' && memberId
    ? `/admin/members/${memberId}`
    : '/admin/members';

  if (!memberId || !VALID_ROLES.includes(nextRole)) {
    req.session.flash = { type: 'error', message: '유효하지 않은 회원 또는 권한 요청입니다.' };
    return res.redirect('/admin/members');
  }

  if (memberId === Number(req.session.user.id) && nextRole !== 'admin') {
    req.session.flash = { type: 'error', message: '현재 로그인한 관리자 본인의 권한은 해제할 수 없습니다.' };
    return res.redirect(redirectBack);
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [targetRows] = await conn.execute(
      'SELECT id, role FROM members WHERE id = ? LIMIT 1 FOR UPDATE',
      [memberId]
    );

    if (targetRows.length === 0) {
      await conn.rollback();
      req.session.flash = { type: 'error', message: '존재하지 않는 회원입니다.' };
      return res.redirect(redirectBack);
    }

    const targetMember = targetRows[0];
    if (targetMember.role === 'admin' && nextRole !== 'admin') {
      const [adminRows] = await conn.execute(
        "SELECT id FROM members WHERE role = 'admin' FOR UPDATE"
      );
      if (adminRows.length <= 1) {
        await conn.rollback();
        req.session.flash = {
          type: 'error',
          message: '마지막 관리자 계정의 권한은 해제할 수 없습니다.',
        };
        return res.redirect(redirectBack);
      }
    }

    await conn.execute('UPDATE members SET role = ? WHERE id = ?', [nextRole, memberId]);
    await conn.commit();

    req.session.flash = {
      type: 'success',
      message: `회원 권한이 '${nextRole === 'admin' ? '관리자' : '일반회원'}'(으)로 변경되었습니다.`,
    };
    return res.redirect(redirectBack);
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (_rollbackErr) {
        // ignore rollback error
      }
    }
    return next(err);
  } finally {
    if (conn) conn.release();
  }
});

// 4. 주문 관리 - 목록
router.get('/orders', async (req, res, next) => {
  try {
    const rawStatus = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const activeStatus = ORDER_STATUSES.includes(rawStatus) ? rawStatus : '';
    const searchTerm = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 50) : '';

    const [memberRows] = await pool.execute(
      'SELECT id, userid, name, email, orders_json FROM members ORDER BY id ASC'
    );

    let orders = collectAllOrders(memberRows);

    if (activeStatus) {
      orders = orders.filter((order) => order.status === activeStatus);
    }

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      orders = orders.filter((order) => {
        const orderIdMatch = String(order.order_id || '').toLowerCase().includes(q);
        const useridMatch = String(order.member_userid || '').toLowerCase().includes(q);
        const memberNameMatch = String(order.member_name || '').toLowerCase().includes(q);
        const receiverMatch = String((order.shipping && order.shipping.name) || '').toLowerCase().includes(q);
        const itemMatch = Array.isArray(order.items) && order.items.some(
          (item) => String(item.product_name || '').toLowerCase().includes(q)
        );
        return orderIdMatch || useridMatch || memberNameMatch || receiverMatch || itemMatch;
      });
    }

    return res.render('admin/orders', {
      title: '주문 관리 | CLOSET 관리자',
      orders,
      statuses: ORDER_STATUSES,
      activeStatus,
      searchTerm,
      formatKoreanDateTime,
    });
  } catch (err) {
    return next(err);
  }
});

// 주문 상세 조회
router.get('/orders/:memberId/:orderId', async (req, res, next) => {
  const memberId = parsePositiveInt(req.params.memberId);
  const orderId = typeof req.params.orderId === 'string' ? req.params.orderId.trim() : '';

  if (!memberId || !orderId) {
    return renderAdminNotFound(res, '주문을 찾을 수 없습니다.', '올바르지 않은 주문 요청입니다.');
  }

  try {
    const [rows] = await pool.execute(
      'SELECT id, userid, name, email, phone, orders_json FROM members WHERE id = ? LIMIT 1',
      [memberId]
    );
    if (rows.length === 0) {
      return renderAdminNotFound(res, '주문을 찾을 수 없습니다.', '해당 주문의 회원 정보를 찾을 수 없습니다.');
    }

    const member = rows[0];
    const orders = parseOrdersJson(member.orders_json);
    const order = orders.find((o) => o.order_id === orderId);

    if (!order) {
      return renderAdminNotFound(res, '주문을 찾을 수 없습니다.', '요청하신 주문 내역이 존재하지 않습니다.');
    }

    return res.render('admin/order-detail', {
      title: `주문 관리 (${order.order_id}) | CLOSET 관리자`,
      member: {
        id: member.id,
        userid: member.userid,
        name: member.name,
        email: member.email,
        phone: member.phone,
      },
      order,
      statuses: ORDER_STATUSES,
      formatKoreanDateTime,
    });
  } catch (err) {
    return next(err);
  }
});

// 주문 상태 변경 (트랜잭션 + SELECT FOR UPDATE로 해당 주문의 status 값만 변경, 재고 미변경)
router.post('/orders/:memberId/:orderId/status', async (req, res, next) => {
  const memberId = parsePositiveInt(req.params.memberId);
  const orderId = typeof req.params.orderId === 'string' ? req.params.orderId.trim() : '';
  const nextStatus = typeof req.body.status === 'string' ? req.body.status.trim() : '';
  const redirectTarget = req.body.redirect_to === 'detail' && memberId && orderId
    ? `/admin/orders/${memberId}/${encodeURIComponent(orderId)}`
    : '/admin/orders';

  if (!memberId || !orderId || !ORDER_STATUSES.includes(nextStatus)) {
    req.session.flash = { type: 'error', message: '유효하지 않은 주문 상태 변경 요청입니다.' };
    return res.redirect('/admin/orders');
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [memberRows] = await conn.execute(
      'SELECT id, orders_json FROM members WHERE id = ? LIMIT 1 FOR UPDATE',
      [memberId]
    );

    if (memberRows.length === 0) {
      await conn.rollback();
      req.session.flash = { type: 'error', message: '회원 정보를 찾을 수 없습니다.' };
      return res.redirect('/admin/orders');
    }

    const orders = parseOrdersJson(memberRows[0].orders_json);
    const orderIndex = orders.findIndex((o) => o.order_id === orderId);

    if (orderIndex === -1) {
      await conn.rollback();
      req.session.flash = { type: 'error', message: '해당 주문을 찾을 수 없습니다.' };
      return res.redirect('/admin/orders');
    }

    const currentOrder = orders[orderIndex];
    orders[orderIndex] = {
      ...currentOrder,
      status: nextStatus,
    };

    await conn.execute(
      'UPDATE members SET orders_json = ? WHERE id = ?',
      [JSON.stringify(orders), memberId]
    );

    await conn.commit();
    req.session.flash = {
      type: 'success',
      message: `주문(${orderId}) 상태가 '${nextStatus}'(으)로 변경되었습니다.`,
    };
    return res.redirect(redirectTarget);
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (_rollbackErr) {
        // ignore rollback error
      }
    }
    return next(err);
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
