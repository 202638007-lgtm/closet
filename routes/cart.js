const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { parseCartJson, parseProductOptions } = require('../utils/cart');

const router = express.Router();

const POSITIVE_INT_REGEX = /^[1-9]\d*$/;

function isSameCartVariant(item, productId, size, color) {
  return (
    item.product_id === productId &&
    (item.size || '') === size &&
    (item.color || '') === color
  );
}

// 장바구니 조회
router.get('/', requireAuth, async (req, res, next) => {
  const memberId = req.session.user.id;

  try {
    const [memberRows] = await pool.execute(
      'SELECT cart_json FROM members WHERE id = ? LIMIT 1',
      [memberId]
    );

    if (memberRows.length === 0) {
      return res.redirect('/auth/login');
    }

    const rawCart = parseCartJson(memberRows[0].cart_json);
    if (rawCart.length === 0) {
      return res.render('cart/index', {
        title: '장바구니 | CLOSET',
        items: [],
        totalQuantity: 0,
        totalAmount: 0,
        hasStockIssue: false,
      });
    }

    const uniqueProductIds = [...new Set(rawCart.map((item) => item.product_id))];
    const placeholders = uniqueProductIds.map(() => '?').join(', ');

    const [productRows] = await pool.execute(
      `SELECT id, name, category, price, image, stock
       FROM products
       WHERE id IN (${placeholders})`,
      uniqueProductIds
    );

    const productMap = new Map(productRows.map((p) => [p.id, p]));
    const validCartItems = rawCart.filter((item) => productMap.has(item.product_id));

    if (validCartItems.length !== rawCart.length) {
      await pool.execute(
        'UPDATE members SET cart_json = ? WHERE id = ?',
        [JSON.stringify(validCartItems), memberId]
      );
      res.locals.cartCount = validCartItems.reduce((sum, item) => sum + item.quantity, 0);
    }

    const items = [];
    let totalQuantity = 0;
    let totalAmount = 0;
    let hasStockIssue = false;

    for (const cartItem of validCartItems) {
      const product = productMap.get(cartItem.product_id);

      const unitPrice = Number(product.price);
      const stock = Number(product.stock);
      const lineTotal = unitPrice * cartItem.quantity;
      const isStockInsufficient = stock <= 0 || cartItem.quantity > stock;

      if (isStockInsufficient) {
        hasStockIssue = true;
      }

      totalQuantity += cartItem.quantity;
      totalAmount += lineTotal;

      items.push({
        product_id: product.id,
        name: product.name,
        category: product.category,
        image: product.image,
        price: unitPrice,
        stock,
        size: cartItem.size,
        color: cartItem.color,
        quantity: cartItem.quantity,
        lineTotal,
        isStockInsufficient,
      });
    }

    return res.render('cart/index', {
      title: '장바구니 | CLOSET',
      items,
      totalQuantity,
      totalAmount,
      hasStockIssue,
    });
  } catch (err) {
    return next(err);
  }
});

// 장바구니 상품 추가
router.post('/add', requireAuth, async (req, res, next) => {
  const memberId = req.session.user.id;
  const rawProductId = typeof req.body.product_id === 'string' ? req.body.product_id.trim() : String(req.body.product_id || '').trim();
  const rawQuantity = typeof req.body.quantity === 'string' ? req.body.quantity.trim() : String(req.body.quantity || '1').trim();
  const rawSize = typeof req.body.size === 'string' ? req.body.size.trim() : '';
  const rawColor = typeof req.body.color === 'string' ? req.body.color.trim() : '';

  if (!POSITIVE_INT_REGEX.test(rawProductId)) {
    req.session.flash = { type: 'error', message: '유효하지 않은 상품 정보입니다.' };
    return res.redirect('/products');
  }

  const productId = Number(rawProductId);
  const redirectDetail = `/products/${productId}`;

  if (!POSITIVE_INT_REGEX.test(rawQuantity)) {
    req.session.flash = { type: 'error', message: '수량은 1 이상의 정수로 입력해 주세요.' };
    return res.redirect(redirectDetail);
  }

  const addQuantity = Number(rawQuantity);

  try {
    const [productRows] = await pool.execute(
      'SELECT id, name, price, stock, sizes, colors FROM products WHERE id = ? LIMIT 1',
      [productId]
    );

    if (productRows.length === 0) {
      req.session.flash = { type: 'error', message: '존재하지 않는 상품입니다.' };
      return res.redirect('/products');
    }

    const product = productRows[0];
    const stock = Number(product.stock);
    if (stock <= 0) {
      req.session.flash = { type: 'error', message: '품절된 상품은 장바구니에 담을 수 없습니다.' };
      return res.redirect(redirectDetail);
    }

    const availableSizes = parseProductOptions(product.sizes);
    const availableColors = parseProductOptions(product.colors);

    let selectedSize = '';
    if (availableSizes.length > 0) {
      if (!rawSize || !availableSizes.includes(rawSize)) {
        req.session.flash = { type: 'error', message: '유효한 사이즈를 선택해 주세요.' };
        return res.redirect(redirectDetail);
      }
      selectedSize = rawSize;
    }

    let selectedColor = '';
    if (availableColors.length > 0) {
      if (!rawColor || !availableColors.includes(rawColor)) {
        req.session.flash = { type: 'error', message: '유효한 색상을 선택해 주세요.' };
        return res.redirect(redirectDetail);
      }
      selectedColor = rawColor;
    }

    const [memberRows] = await pool.execute(
      'SELECT cart_json FROM members WHERE id = ? LIMIT 1',
      [memberId]
    );

    if (memberRows.length === 0) {
      return res.redirect('/auth/login');
    }

    const cart = parseCartJson(memberRows[0].cart_json);
    const existing = cart.find((item) =>
      isSameCartVariant(item, productId, selectedSize, selectedColor)
    );

    const nextQuantity = existing ? existing.quantity + addQuantity : addQuantity;
    if (nextQuantity > stock) {
      req.session.flash = {
        type: 'error',
        message: `재고 수량(${stock}개)을 초과하여 장바구니에 담을 수 없습니다.`,
      };
      return res.redirect(redirectDetail);
    }

    if (existing) {
      existing.quantity = nextQuantity;
    } else {
      cart.push({
        product_id: productId,
        quantity: addQuantity,
        size: selectedSize,
        color: selectedColor,
      });
    }

    await pool.execute(
      'UPDATE members SET cart_json = ? WHERE id = ?',
      [JSON.stringify(cart), memberId]
    );

    req.session.flash = { type: 'success', message: '장바구니에 상품을 담았습니다.' };
    return res.redirect('/cart');
  } catch (err) {
    return next(err);
  }
});

// 장바구니 수량 변경
router.post('/update', requireAuth, async (req, res, next) => {
  const memberId = req.session.user.id;
  const rawProductId = typeof req.body.product_id === 'string' ? req.body.product_id.trim() : String(req.body.product_id || '').trim();
  const size = typeof req.body.size === 'string' ? req.body.size.trim() : '';
  const color = typeof req.body.color === 'string' ? req.body.color.trim() : '';
  const action = typeof req.body.action === 'string' ? req.body.action.trim() : 'set';
  const rawQuantity = typeof req.body.quantity === 'string' ? req.body.quantity.trim() : String(req.body.quantity || '').trim();

  if (!POSITIVE_INT_REGEX.test(rawProductId)) {
    req.session.flash = { type: 'error', message: '올바르지 않은 상품 요청입니다.' };
    return res.redirect('/cart');
  }

  const productId = Number(rawProductId);

  try {
    const [memberRows] = await pool.execute(
      'SELECT cart_json FROM members WHERE id = ? LIMIT 1',
      [memberId]
    );
    if (memberRows.length === 0) {
      return res.redirect('/auth/login');
    }

    const cart = parseCartJson(memberRows[0].cart_json);
    const targetItem = cart.find((item) =>
      isSameCartVariant(item, productId, size, color)
    );

    if (!targetItem) {
      req.session.flash = { type: 'error', message: '장바구니에서 해당 상품을 찾을 수 없습니다.' };
      return res.redirect('/cart');
    }

    let nextQuantity = targetItem.quantity;
    if (action === 'increase') {
      nextQuantity = targetItem.quantity + 1;
    } else if (action === 'decrease') {
      if (targetItem.quantity <= 1) {
        req.session.flash = { type: 'error', message: '최소 주문 수량은 1개입니다.' };
        return res.redirect('/cart');
      }
      nextQuantity = targetItem.quantity - 1;
    } else {
      if (!POSITIVE_INT_REGEX.test(rawQuantity)) {
        req.session.flash = { type: 'error', message: '수량은 1 이상의 정수로 입력해 주세요.' };
        return res.redirect('/cart');
      }
      nextQuantity = Number(rawQuantity);
    }

    const [productRows] = await pool.execute(
      'SELECT id, stock FROM products WHERE id = ? LIMIT 1',
      [productId]
    );

    if (productRows.length === 0) {
      req.session.flash = { type: 'error', message: '존재하지 않는 상품입니다.' };
      return res.redirect('/cart');
    }

    const stock = Number(productRows[0].stock);
    if (stock <= 0) {
      req.session.flash = { type: 'error', message: '품절된 상품입니다.' };
      return res.redirect('/cart');
    }

    if (nextQuantity > stock) {
      req.session.flash = {
        type: 'error',
        message: `현재 재고(${stock}개)보다 큰 수량은 설정할 수 없습니다.`,
      };
      return res.redirect('/cart');
    }

    targetItem.quantity = nextQuantity;

    await pool.execute(
      'UPDATE members SET cart_json = ? WHERE id = ?',
      [JSON.stringify(cart), memberId]
    );

    req.session.flash = { type: 'success', message: '장바구니 수량이 변경되었습니다.' };
    return res.redirect('/cart');
  } catch (err) {
    return next(err);
  }
});

// 장바구니 상품 삭제
router.post('/remove', requireAuth, async (req, res, next) => {
  const memberId = req.session.user.id;
  const rawProductId = typeof req.body.product_id === 'string' ? req.body.product_id.trim() : String(req.body.product_id || '').trim();
  const size = typeof req.body.size === 'string' ? req.body.size.trim() : '';
  const color = typeof req.body.color === 'string' ? req.body.color.trim() : '';

  if (!POSITIVE_INT_REGEX.test(rawProductId)) {
    req.session.flash = { type: 'error', message: '올바르지 않은 상품 요청입니다.' };
    return res.redirect('/cart');
  }

  const productId = Number(rawProductId);

  try {
    const [memberRows] = await pool.execute(
      'SELECT cart_json FROM members WHERE id = ? LIMIT 1',
      [memberId]
    );
    if (memberRows.length === 0) {
      return res.redirect('/auth/login');
    }

    const cart = parseCartJson(memberRows[0].cart_json);
    const targetIdx = cart.findIndex((item) =>
      isSameCartVariant(item, productId, size, color)
    );

    if (targetIdx === -1) {
      req.session.flash = { type: 'error', message: '장바구니에 해당 상품이 존재하지 않습니다.' };
      return res.redirect('/cart');
    }

    cart.splice(targetIdx, 1);

    await pool.execute(
      'UPDATE members SET cart_json = ? WHERE id = ?',
      [JSON.stringify(cart), memberId]
    );

    req.session.flash = { type: 'success', message: '선택한 상품을 장바구니에서 삭제했습니다.' };
    return res.redirect('/cart');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
