const express = require('express');
const { pool } = require('../config/db');
const { parseProductOptions } = require('../utils/cart');

const router = express.Router();

const VALID_CATEGORIES = ['NEW', 'BEST', 'OUTER', 'TOP', 'BOTTOM'];
const MAX_SEARCH_LENGTH = 50;

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

// 상품 전체 목록 / 카테고리별 조회 / 상품명 검색
router.get('/', async (req, res, next) => {
  try {
    const rawCategory = typeof req.query.category === 'string' ? req.query.category.trim().toUpperCase() : '';
    const rawSearch =
      typeof req.query.search === 'string'
        ? req.query.search.trim()
        : typeof req.query.q === 'string'
          ? req.query.q.trim()
          : '';

    let validationError = null;
    let statusCode = 200;

    if (rawCategory && !VALID_CATEGORIES.includes(rawCategory)) {
      validationError = '등록되지 않은 카테고리입니다. 아래 카테고리에서 상품을 확인해 주세요.';
      statusCode = 400;
    } else if (rawSearch.length > MAX_SEARCH_LENGTH) {
      validationError = `검색어는 ${MAX_SEARCH_LENGTH}자 이하로 입력해 주세요.`;
      statusCode = 400;
    }

    if (validationError) {
      return res.status(statusCode).render('products/list', {
        title: '상품 목록 | CLOSET',
        products: [],
        categories: VALID_CATEGORIES,
        activeCategory: '',
        searchTerm: rawSearch.slice(0, MAX_SEARCH_LENGTH),
        validationError,
      });
    }

    const conditions = [];
    const params = [];

    if (rawCategory) {
      conditions.push('category = ?');
      params.push(rawCategory);
    }

    if (rawSearch) {
      conditions.push("name LIKE ? ESCAPE '\\\\'");
      params.push(`%${escapeLike(rawSearch)}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT id, name, category, price, image, description, stock, sizes, colors, created_at
      FROM products
      ${whereClause}
      ORDER BY created_at DESC, id DESC
    `;

    const [rows] = await pool.execute(sql, params);

    const pageTitle = rawCategory
      ? `${rawCategory} | CLOSET`
      : rawSearch
        ? `'${rawSearch}' 검색 결과 | CLOSET`
        : '전체 상품 | CLOSET';

    return res.render('products/list', {
      title: pageTitle,
      products: rows,
      categories: VALID_CATEGORIES,
      activeCategory: rawCategory,
      searchTerm: rawSearch,
      validationError: null,
    });
  } catch (err) {
    return next(err);
  }
});

// 상품 상세 페이지
router.get('/:id', async (req, res, next) => {
  const rawId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
  if (!/^[1-9]\d*$/.test(rawId)) {
    return res.status(404).render('products/not-found', {
      title: '상품을 찾을 수 없습니다 | CLOSET',
      message: '올바르지 않은 상품 번호입니다.',
    });
  }

  const productId = Number(rawId);

  try {
    const [rows] = await pool.execute(
      `SELECT id, name, category, price, image, description, stock, sizes, colors, created_at
       FROM products
       WHERE id = ?
       LIMIT 1`,
      [productId]
    );

    if (rows.length === 0) {
      return res.status(404).render('products/not-found', {
        title: '상품을 찾을 수 없습니다 | CLOSET',
        message: '요청하신 상품이 존재하지 않거나 판매가 종료되었습니다.',
      });
    }

    const product = rows[0];
    const sizes = parseProductOptions(product.sizes);
    const colors = parseProductOptions(product.colors);

    return res.render('products/detail', {
      title: `${product.name} | CLOSET`,
      product,
      sizes,
      colors,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
