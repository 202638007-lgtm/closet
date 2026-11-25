require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const { testConnection, pool } = require('./config/db');
const { ensureCsrfToken, verifyCsrfToken } = require('./middleware/csrf');
const { parseCartJson, getCartTotalQuantity } = require('./utils/cart');
const indexRouter = require('./routes/index');
const authRouter = require('./routes/auth');
const productsRouter = require('./routes/products');
const cartRouter = require('./routes/cart');
const ordersRouter = require('./routes/orders');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  app.set('trust proxy', 1);
}

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session setup
app.use(
  session({
    name: 'closet.sid',
    secret: process.env.SESSION_SECRET || 'closet-dev-fallback-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

// CSRF protection & common template locals
app.use(ensureCsrfToken);
app.use(verifyCsrfToken);

app.use(async (req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.searchQuery =
    typeof req.query.search === 'string'
      ? req.query.search
      : typeof req.query.q === 'string'
        ? req.query.q
        : '';
  res.locals.currentUser = req.session && req.session.user ? req.session.user : null;
  res.locals.cartCount = 0;

  if (req.method === 'GET' && req.session && req.session.user) {
    try {
      const [rows] = await pool.execute(
        'SELECT cart_json FROM members WHERE id = ? LIMIT 1',
        [req.session.user.id]
      );
      if (rows.length > 0) {
        const items = parseCartJson(rows[0].cart_json);
        res.locals.cartCount = getCartTotalQuantity(items);
      }
    } catch (_err) {
      res.locals.cartCount = 0;
    }
  }

  if (req.method === 'GET' && req.session && req.session.flash) {
    res.locals.flash = req.session.flash;
    delete req.session.flash;
  } else {
    res.locals.flash = null;
  }
  next();
});

// Routes
app.use('/', indexRouter);
app.use('/auth', authRouter);
app.use('/products', productsRouter);
app.use('/cart', cartRouter);
app.use('/orders', ordersRouter);
app.use('/admin', adminRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).send('페이지를 찾을 수 없습니다.');
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  const isDbError = Boolean(err.code && String(err.code).startsWith('ER_')) || err.code === 'ECONNREFUSED';
  const message = isDbError
    ? '데이터베이스 처리 중 오류가 발생했습니다.'
    : '서버 내부 오류가 발생했습니다.';
  res.status(500).send(message);
});

async function startServer() {
  const dbStatus = await testConnection();
  if (!dbStatus.ok) {
    console.warn('[Startup Warning]', dbStatus.message);
  } else {
    console.log('[DB]', dbStatus.message);
  }

  app.listen(PORT, () => {
    console.log(`[Server] CLOSET server is running on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = app;
