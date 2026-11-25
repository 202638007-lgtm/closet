/**
 * Shared helpers for safely parsing and normalizing members.cart_json.
 */

function parseCartJson(raw) {
  let list = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        list = parsed;
      }
    } catch (_err) {
      return [];
    }
  } else {
    return [];
  }

  return list
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const productId = Number(item.product_id);
      const quantity = Number(item.quantity);
      if (!Number.isInteger(productId) || productId <= 0) return null;
      if (!Number.isInteger(quantity) || quantity <= 0) return null;

      return {
        product_id: productId,
        quantity,
        size: typeof item.size === 'string' ? item.size.trim() : '',
        color: typeof item.color === 'string' ? item.color.trim() : '',
      };
    })
    .filter(Boolean);
}

function getCartTotalQuantity(cartItems) {
  return cartItems.reduce((sum, item) => sum + item.quantity, 0);
}

function parseProductOptions(raw) {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch (_err) {
      return [];
    }
  }
  return [];
}

module.exports = {
  parseCartJson,
  getCartTotalQuantity,
  parseProductOptions,
};
