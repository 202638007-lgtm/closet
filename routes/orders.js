const crypto = require('crypto');
const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { parseCartJson, parseProductOptions } = require('../utils/cart');
const {
  parseOrdersJson,
  generateOrderId,
  formatKoreanDateTime,
  validateShippingInput,
} = require('../utils/orders');

const router = express.Router();

// 동시 중복 주문 제출 방지용 세션-토큰 인메모리 락
const inFlightOrderTokens = new Set();

function buildCartItemsWithProducts(cartItems, productMap) {
  const items = [];
  let totalQuantity = 0;
  let totalPrice = 0;

  for (const cartItem of cartItems) {
    const product = productMap.get(cartItem.product_id);
    if (!product) {
      return { error: '장바구니에 존재하지 않거나 삭제된 상품이 포함되어 있습니다.' };
    }

    const stock = Number(product.stock);
    if (stock <= 0 || cartItem.quantity > stock) {
      return { error: `'${product.name}' 상품의 재고가 부족합니다. (남은 재고: ${stock}개)` };
    }

    const availableSizes = parseProductOptions(product.sizes);
    if (availableSizes.length > 0 && (!cartItem.size || !availableSizes.includes(cartItem.size))) {
      return { error: `'${product.name}' 상품의 사이즈 옵션이 유효하지 않습니다.` };
    }

    const availableColors = parseProductOptions(product.colors);
    if (availableColors.length > 0 && (!cartItem.color || !availableColors.includes(cartItem.color))) {
      return { error: `'${product.name}' 상품의 색상 옵션이 유효하지 않습니다.` };
    }

    const unitPrice = Number(product.price);
    const lineTotal = unitPrice * cartItem.quantity;

    totalQuantity += cartItem.quantity;
    totalPrice += lineTotal;

    items.push({
      product_id: product.id,
      product_name: product.name,
      price: unitPrice,
      quantity: cartItem.quantity,
      size: availableSizes.length > 0 ? cartItem.size : '',
      color: availableColors.length > 0 ? cartItem.color : '',
      image: product.image || '/images/no-image.svg',
      lineTotal,
    });
  }

  return { error: null, items, totalQuantity, totalPrice };
}

function validateAggregateStock(cartItems, productMap) {
  const qtyByProduct = new Map();
  for (const item of cartItems) {
    qtyByProduct.set(item.product_id, (qtyByProduct.get(item.product_id) || 0) + item.quantity);
  }

  for (const [productId, totalQty] of qtyByProduct.entries()) {
    const product = productMap.get(productId);
    if (!product) {
      return { error: '주문 대상 상품 중 존재하지 않는 상품이 있습니다.' };
    }
    const stock = Number(product.stock);
    if (stock <= 0 || totalQty > stock) {
      return { error: `'${product.name}' 상품의 재고가 부족합니다. (요청: ${totalQty}개 / 남은 재고: ${stock}개)` };
    }
  }

  return { error: null, qtyByProduct };
}

function createCheckoutToken(req) {
  const token = crypto.randomBytes(16).toString('hex');
  req.session.checkoutToken = token;
  return token;
}

// 주문 내역 페이지
router.get('/', requireAuth, async (req, res, next) => {
  const memberId = req.session.user.id;

  try {
    const [rows] = await pool.execute(
      'SELECT orders_json FROM members WHERE id = ? LIMIT 1',
      [memberId]
    );

    if (rows.length === 0) {
      return res.redirect('/auth/login');
    }

    const orders = parseOrdersJson(rows[0].orders_json)
      .slice()
      .sort((a, b) => new Date(b.order_date) - new Date(a.order_date));

    return res.render('orders/list', {
      title: '주문 내역 | CLOSET',
      orders,
      formatKoreanDateTime,
    });
  } catch (err) {
    return next(err);
  }
});

// 주문서 페이지
router.get('/checkout', requireAuth, async (req, res, next) => {
  const memberId = req.session.user.id;

  try {
    const [memberRows] = await pool.execute(
      'SELECT id, name, phone, address, cart_json FROM members WHERE id = ? LIMIT 1',
      [memberId]
    );

    if (memberRows.length === 0) {
      return res.redirect('/auth/login');
    }

    const member = memberRows[0];
    const cart = parseCartJson(member.cart_json);
    if (cart.length === 0) {
      req.session.flash = { type: 'error', message: '장바구니가 비어 있어 주문할 수 없습니다.' };
      return res.redirect('/cart');
    }

    const uniqueIds = [...new Set(cart.map((item) => item.product_id))].sort((a, b) => a - b);
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const [productRows] = await pool.execute(
      `SELECT id, name, price, image, stock, sizes, colors FROM products WHERE id IN (${placeholders})`,
      uniqueIds
    );

    const productMap = new Map(productRows.map((p) => [p.id, p]));
    const stockValidation = validateAggregateStock(cart, productMap);
    if (stockValidation.error) {
      req.session.flash = { type: 'error', message: stockValidation.error };
      return res.redirect('/cart');
    }

    const built = buildCartItemsWithProducts(cart, productMap);
    if (built.error) {
      req.session.flash = { type: 'error', message: built.error };
      return res.redirect('/cart');
    }

    const checkoutToken = createCheckoutToken(req);

    return res.render('orders/checkout', {
      title: '주문서 작성 | CLOSET',
      items: built.items,
      totalQuantity: built.totalQuantity,
      totalPrice: built.totalPrice,
      checkoutToken,
      error: null,
      shippingData: {
        name: member.name || '',
        phone: member.phone || '',
        address: member.address || '',
        detail_address: '',
        memo: '',
      },
    });
  } catch (err) {
    return next(err);
  }
});

// 주문 생성 처리 (트랜잭션 + FOR UPDATE)
router.post('/', requireAuth, async (req, res, next) => {
  const memberId = req.session.user.id;
  const submittedToken = typeof req.body.checkout_token === 'string' ? req.body.checkout_token.trim() : '';
  const sessionToken = req.session.checkoutToken;
  const lockKey = `${memberId}:${submittedToken}`;

  if (!submittedToken || !sessionToken || submittedToken !== sessionToken || inFlightOrderTokens.has(lockKey)) {
    req.session.flash = {
      type: 'error',
      message: '이미 처리된 주문이거나 유효하지 않은 주문 요청입니다.',
    };
    return res.redirect('/orders');
  }

  const shippingResult = validateShippingInput(req.body);
  if (shippingResult.error) {
    try {
      const [memberRows] = await pool.execute(
        'SELECT cart_json FROM members WHERE id = ? LIMIT 1',
        [memberId]
      );
      const cart = memberRows.length > 0 ? parseCartJson(memberRows[0].cart_json) : [];
      if (cart.length === 0) {
        req.session.flash = { type: 'error', message: '장바구니가 비어 있습니다.' };
        return res.redirect('/cart');
      }

      const uniqueIds = [...new Set(cart.map((item) => item.product_id))].sort((a, b) => a - b);
      const placeholders = uniqueIds.map(() => '?').join(', ');
      const [productRows] = await pool.execute(
        `SELECT id, name, price, image, stock, sizes, colors FROM products WHERE id IN (${placeholders})`,
        uniqueIds
      );
      const productMap = new Map(productRows.map((p) => [p.id, p]));
      const built = buildCartItemsWithProducts(cart, productMap);
      if (built.error) {
        req.session.flash = { type: 'error', message: built.error };
        return res.redirect('/cart');
      }

      const freshToken = createCheckoutToken(req);
      return res.status(400).render('orders/checkout', {
        title: '주문서 작성 | CLOSET',
        items: built.items,
        totalQuantity: built.totalQuantity,
        totalPrice: built.totalPrice,
        checkoutToken: freshToken,
        error: shippingResult.error,
        shippingData: shippingResult.formData,
      });
    } catch (err) {
      return next(err);
    }
  }

  inFlightOrderTokens.add(lockKey);
  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // 1. 회원 행 잠금 후 장바구니/주문내역 조회
    const [memberRows] = await conn.execute(
      'SELECT id, cart_json, orders_json FROM members WHERE id = ? LIMIT 1 FOR UPDATE',
      [memberId]
    );

    if (memberRows.length === 0) {
      await conn.rollback();
      return res.redirect('/auth/login');
    }

    const cart = parseCartJson(memberRows[0].cart_json);
    if (cart.length === 0) {
      await conn.rollback();
      req.session.flash = { type: 'error', message: '장바구니가 비어 있어 주문할 수 없습니다.' };
      return res.redirect('/cart');
    }

    // 2. 교착 상태 방지를 위해 상품 ID 오름차순 정렬 후 행 잠금 조회
    const sortedProductIds = [...new Set(cart.map((item) => item.product_id))].sort((a, b) => a - b);
    const placeholders = sortedProductIds.map(() => '?').join(', ');
    const [productRows] = await conn.execute(
      `SELECT id, name, price, image, stock, sizes, colors
       FROM products
       WHERE id IN (${placeholders})
       ORDER BY id ASC
       FOR UPDATE`,
      sortedProductIds
    );

    const productMap = new Map(productRows.map((p) => [p.id, p]));

    // 3. 재고 및 옵션 재검증
    const aggCheck = validateAggregateStock(cart, productMap);
    if (aggCheck.error) {
      await conn.rollback();
      req.session.flash = { type: 'error', message: aggCheck.error };
      return res.redirect('/cart');
    }

    const built = buildCartItemsWithProducts(cart, productMap);
    if (built.error) {
      await conn.rollback();
      req.session.flash = { type: 'error', message: built.error };
      return res.redirect('/cart');
    }

    // 4. 상품별 재고 차감 (음수 재고 방지 조건 포함)
    for (const productId of sortedProductIds) {
      const deductQty = aggCheck.qtyByProduct.get(productId);
      const [updateResult] = await conn.execute(
        'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?',
        [deductQty, productId, deductQty]
      );
      if (!updateResult || updateResult.affectedRows !== 1) {
        await conn.rollback();
        req.session.flash = { type: 'error', message: '재고 확인 중 문제가 발생하여 주문이 취소되었습니다.' };
        return res.redirect('/cart');
      }
    }

    // 5. 주문 스냅샷 생성 및 orders_json 추가 + cart_json 초기화
    const orderId = generateOrderId();
    const newOrder = {
      order_id: orderId,
      order_date: new Date().toISOString(),
      status: '주문접수',
      items: built.items.map((item) => ({
        product_id: item.product_id,
        product_name: item.product_name,
        price: item.price,
        quantity: item.quantity,
        size: item.size,
        color: item.color,
        image: item.image,
      })),
      total_quantity: built.totalQuantity,
      total_price: built.totalPrice,
      shipping: shippingResult.data,
    };

    const existingOrders = parseOrdersJson(memberRows[0].orders_json);
    existingOrders.push(newOrder);

    await conn.execute(
      'UPDATE members SET orders_json = ?, cart_json = JSON_ARRAY() WHERE id = ?',
      [JSON.stringify(existingOrders), memberId]
    );

    // 6. 커밋
    await conn.commit();
    delete req.session.checkoutToken;

    return res.redirect(`/orders/complete/${encodeURIComponent(orderId)}`);
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
    inFlightOrderTokens.delete(lockKey);
    if (conn) conn.release();
  }
});

// 주문 완료 페이지
router.get('/complete/:orderId', requireAuth, async (req, res, next) => {
  const memberId = req.session.user.id;
  const orderId = typeof req.params.orderId === 'string' ? req.params.orderId.trim() : '';

  try {
    const [rows] = await pool.execute(
      'SELECT orders_json FROM members WHERE id = ? LIMIT 1',
      [memberId]
    );

    if (rows.length === 0) {
      return res.redirect('/auth/login');
    }

    const orders = parseOrdersJson(rows[0].orders_json);
    const order = orders.find((o) => o.order_id === orderId);

    if (!order) {
      return res.status(404).render('orders/not-found', {
        title: '주문을 찾을 수 없습니다 | CLOSET',
        message: '요청하신 주문 내역을 찾을 수 없습니다.',
      });
    }

    return res.render('orders/complete', {
      title: '주문 완료 | CLOSET',
      order,
      formatKoreanDateTime,
    });
  } catch (err) {
    return next(err);
  }
});

// 주문 상세 페이지
router.get('/:orderId', requireAuth, async (req, res, next) => {
  const memberId = req.session.user.id;
  const orderId = typeof req.params.orderId === 'string' ? req.params.orderId.trim() : '';

  try {
    const [rows] = await pool.execute(
      'SELECT orders_json FROM members WHERE id = ? LIMIT 1',
      [memberId]
    );

    if (rows.length === 0) {
      return res.redirect('/auth/login');
    }

    const orders = parseOrdersJson(rows[0].orders_json);
    const order = orders.find((o) => o.order_id === orderId);

    if (!order) {
      return res.status(404).render('orders/not-found', {
        title: '주문을 찾을 수 없습니다 | CLOSET',
        message: '해당 주문 내역이 존재하지 않거나 조회 권한이 없습니다.',
      });
    }

    return res.render('orders/detail', {
      title: `주문 상세 (${order.order_id}) | CLOSET`,
      order,
      formatKoreanDateTime,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
