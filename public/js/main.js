document.addEventListener('DOMContentLoaded', () => {
  const menuBtn = document.getElementById('mobileMenuBtn');
  const closeBtn = document.getElementById('mobileCloseBtn');
  const drawer = document.getElementById('mobileNavDrawer');
  const backdrop = document.getElementById('mobileNavBackdrop');

  function openDrawer() {
    if (!drawer || !backdrop || !menuBtn) return;
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    menuBtn.setAttribute('aria-expanded', 'true');
    backdrop.hidden = false;
    document.body.classList.add('no-scroll');
  }

  function closeDrawer() {
    if (!drawer || !backdrop || !menuBtn) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
    backdrop.hidden = true;
    document.body.classList.remove('no-scroll');
  }

  if (menuBtn) {
    menuBtn.addEventListener('click', openDrawer);
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeDrawer);
  }

  if (backdrop) {
    backdrop.addEventListener('click', closeDrawer);
  }

  if (drawer) {
    drawer.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeDrawer);
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeDrawer();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      closeDrawer();
    }
  });

  // Search form trim check
  document.querySelectorAll('.header-search-form, .mobile-search-form, .inline-search-form').forEach((form) => {
    form.addEventListener('submit', (event) => {
      const input = form.querySelector('input[name="search"]');
      if (input) {
        input.value = input.value.trim();
        if (!input.value) {
          event.preventDefault();
          input.focus();
        }
      }
    });
  });

  // Detail page quantity stepper
  const detailQtyInput = document.getElementById('detailQuantity');
  if (detailQtyInput) {
    document.querySelectorAll('[data-qty-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const delta = Number(btn.getAttribute('data-qty-step')) || 0;
        const min = Number(detailQtyInput.getAttribute('min')) || 1;
        const max = Number(detailQtyInput.getAttribute('max')) || 9999;
        const current = Number(detailQtyInput.value) || min;
        const next = Math.min(max, Math.max(min, current + delta));
        detailQtyInput.value = String(next);
      });
    });
  }

  // Checkout double-submit guard
  const checkoutForm = document.getElementById('checkoutForm');
  const checkoutSubmitBtn = document.getElementById('checkoutSubmitBtn');
  if (checkoutForm && checkoutSubmitBtn) {
    checkoutForm.addEventListener('submit', () => {
      if (checkoutSubmitBtn.disabled) return;
      checkoutSubmitBtn.disabled = true;
      checkoutSubmitBtn.textContent = '주문 처리 중...';
    });
  }

  // Confirm dialog for destructive actions (e.g. admin product deletion)
  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      const msg = form.getAttribute('data-confirm');
      if (msg && !window.confirm(msg)) {
        event.preventDefault();
      }
    });
  });
});
