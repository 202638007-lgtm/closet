const crypto = require('crypto');

const PHONE_REGEX = /^[0-9-]{9,20}$/;
const ORDER_STATUSES = ['주문접수', '배송준비', '배송중', '배송완료', '주문취소'];

function parseOrdersJson(raw) {
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

  return list.filter((order) => order && typeof order === 'object' && typeof order.order_id === 'string');
}

function generateOrderId() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `ORD-${y}${m}${d}-${suffix}`;
}

function formatKoreanDateTime(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return String(isoString || '');
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function validateShippingInput(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  const detail_address = typeof body.detail_address === 'string' ? body.detail_address.trim() : '';
  const memo = typeof body.memo === 'string' ? body.memo.trim() : '';

  const formData = { name, phone, address, detail_address, memo };

  if (!name || !phone || !address) {
    return { error: '배송받는 사람 이름, 연락처, 배송지 주소를 모두 입력해 주세요.', formData };
  }
  if (name.length < 2 || name.length > 50) {
    return { error: '배송받는 사람 이름은 2~50자로 입력해 주세요.', formData };
  }
  const digitsOnly = phone.replace(/-/g, '');
  if (!PHONE_REGEX.test(phone) || digitsOnly.length < 9 || digitsOnly.length > 15) {
    return { error: '올바른 연락처 형식을 입력해 주세요. (예: 010-1234-5678)', formData };
  }
  if (address.length > 255 || detail_address.length > 255) {
    return { error: '주소는 255자 이하로 입력해 주세요.', formData };
  }
  if (memo.length > 255) {
    return { error: '배송 메모는 255자 이하로 입력해 주세요.', formData };
  }

  return {
    error: null,
    data: { name, phone, address, detail_address, memo },
    formData,
  };
}

module.exports = {
  ORDER_STATUSES,
  parseOrdersJson,
  generateOrderId,
  formatKoreanDateTime,
  validateShippingInput,
};
