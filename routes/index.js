const express = require('express');
const { pool, testConnection } = require('../config/db');

const router = express.Router();

const MAIN_CATEGORIES = [
  { code: 'NEW', label: '신상품', desc: '이번 시즌 새롭게 선보이는 컬렉션' },
  { code: 'BEST', label: '베스트', desc: '가장 사랑받는 CLOSET 시그니처' },
  { code: 'OUTER', label: '아우터', desc: '코트, 자켓, 트렌치 라인업' },
  { code: 'TOP', label: '상의', desc: '니트, 셔츠, 티셔츠 데일리 웨어' },
  { code: 'BOTTOM', label: '하의', desc: '슬랙스, 데님, 스커트 컬렉션' },
];

router.get('/', async (req, res, next) => {
  try {
    const [recommendedProducts] = await pool.execute(
      'SELECT id, name, category, price, image, stock, created_at FROM products ORDER BY id ASC LIMIT ?',
      ['4']
    );

    const [newProducts] = await pool.execute(
      'SELECT id, name, category, price, image, stock, created_at FROM products ORDER BY created_at DESC, id DESC LIMIT ?',
      ['8']
    );

    res.render('index', {
      title: 'CLOSET | 모던 미니멀 패션 스토어',
      categories: MAIN_CATEGORIES,
      recommendedProducts,
      newProducts,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/health', async (req, res) => {
  const status = await testConnection();
  res.status(status.ok ? 200 : 500).json({
    server: 'ok',
    database: status.ok ? 'connected' : 'disconnected',
    message: status.message,
  });
});

module.exports = router;
