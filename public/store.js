(() => {
  const $ = (id) => document.getElementById(id);
  const money = (n) => 'Rs ' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const TILE_COLORS = ['tile-amber', 'tile-coral', 'tile-crimson'];

  let token = localStorage.getItem('customer_token') || '';
  let customer = null;
  let products = [];
  let cart = {}; // product_id -> { product, qty }
  let favoriteIds = new Set(); // product ids the shopper has saved
  let reviewSummary = {}; // product_id -> { avg_rating, count }
  let currentReviewProductId = null; // which product the reviews overlay is showing
  let reviewStarValue = 0;
  let feedbackStarValue = 0;

  // ---- Language switch (English / Urdu) ----
  const I18N = {
    en: {
      login: 'Log in', createAccount: 'Create account', whatsappNumber: 'WhatsApp number', password: 'Password',
      forgotPassword: 'Forgot password?',
      yourName: 'Your name', ownerName: 'Owner name', enterYourName: 'Enter your name', shopName: 'Shop name', yourShopName: "Your shop's name",
      phoneNumber: 'Cell number', address: 'Address', enterFullAddress: 'Enter your full address',
      atLeast6Chars: 'At least 6 characters', resetPassword: 'Reset password',
      newHere: 'New here?', alreadyMember: 'Already a member?', welcomeBack: 'Welcome back',
      loginSubtext: 'Log in to your account to continue ordering.', noAccountYet: "Don't have an account?",
      createOne: 'Create one', createYourAccount: 'Create your account',
      signupSubtext: "Tell us about your shop - it only takes a minute.", alreadyHaveAccount: 'Already have an account?',
      authVisualTitle: 'Your shop, always in sync.',
      authVisualSubtitle: 'Order directly from your phone or laptop - every order reaches us instantly.',
      authFeature1: 'Real-time order tracking', authFeature2: 'Your details saved for faster checkout',
      authFeature3: 'Direct WhatsApp updates',
      resetPasswordNote: "Enter the WhatsApp number on your account. We'll send a new password to it.",
      sendNewPassword: 'Send new password', chooseYour: 'Choose your', products: 'products',
      heroSubtitle: "Add what you need to your cart, then confirm your order - our team will contact you on WhatsApp.",
      searchProducts: 'Search products...', noProductsListed: 'No products are listed right now.',
      footerNote: 'After placing your order, our team will contact you on WhatsApp.', viewCart: 'View cart',
      account: 'Account', myOrders: 'My Orders', myFavorites: 'My Favorites', feedback: 'Feedback',
      settings: 'Settings', cart: 'Cart', yourCart: 'Your cart', cartEmpty: 'Your cart is empty.', total: 'Total',
      reviewOrder: 'Review order', confirmOrder: 'Confirm order',
      checkoutNote: 'This order will be placed using your saved details below. Need to change something? Use the "Edit info" link.',
      orderNote: 'Order note (optional)', orderNotePlaceholder: 'e.g. deliver after 5pm', placeOrder: 'Place order',
      yourAccount: 'Your account', saved: 'Saved.', saveChanges: 'Save changes', logOut: 'Log out',
      orderReceived: 'Order received!', orderReceivedNote: 'Thank you! Our team will contact you on WhatsApp shortly.',
      ok: 'OK', noOrdersYet: "You haven't placed any orders yet.",
      noFavoritesYet: "You haven't saved any products yet - tap the heart on a product to save it here.",
      ratingsReviews: 'Ratings & Reviews', yourRating: 'Your rating', yourReviewOptional: 'Your review (optional)',
      whatDidYouThink: 'What did you think?', submitReview: 'Submit review',
      feedbackNote: "Tell us how we're doing - about our service, delivery, or this website.",
      yourFeedbackOptional: 'Your feedback (optional)', submitFeedback: 'Submit feedback',
      currentPassword: 'Current password', newPassword: 'New password', confirmNewPassword: 'Confirm new password',
      passwordChanged: 'Password changed.', changePassword: 'Change password', reorder: 'Reorder',
      noReviewsYet: 'No reviews yet - be the first!', pickARating: 'Please pick a star rating.',
      rateThis: 'Rate this', switchLang: 'اردو',
      statusConfirmed: 'Confirmed', statusCancelled: 'Cancelled', statusPending: 'Pending',
      adjusted: 'Adjusted', adjustedNote: 'The quantity on some item(s) was changed by the shop before confirming - check the crossed-out vs bold amount below.',
    },
    ur: {
      login: 'لاگ ان', createAccount: 'اکاؤنٹ بنائیں', whatsappNumber: 'واٹس ایپ نمبر', password: 'پاسورڈ',
      forgotPassword: 'پاسورڈ بھول گئے؟',
      yourName: 'آپ کا نام', ownerName: 'مالک کا نام', enterYourName: 'اپنا نام لکھیں', shopName: 'دکان کا نام', yourShopName: 'آپ کی دکان کا نام',
      phoneNumber: 'سیل نمبر', address: 'پتہ', enterFullAddress: 'اپنا مکمل پتہ لکھیں',
      atLeast6Chars: 'کم از کم 6 حروف', resetPassword: 'پاسورڈ ری سیٹ کریں',
      newHere: 'نئے ہیں؟', alreadyMember: 'پہلے سے اکاؤنٹ ہے؟', welcomeBack: 'خوش آمدید',
      loginSubtext: 'آرڈر جاری رکھنے کے لیے اپنے اکاؤنٹ میں لاگ ان کریں۔', noAccountYet: 'اکاؤنٹ نہیں ہے؟',
      createOne: 'بنائیں', createYourAccount: 'اپنا اکاؤنٹ بنائیں',
      signupSubtext: 'اپنی دکان کے بارے میں بتائیں - صرف ایک منٹ لگے گا۔', alreadyHaveAccount: 'پہلے سے اکاؤنٹ ہے؟',
      authVisualTitle: 'آپ کی دکان، ہمیشہ منسلک۔',
      authVisualSubtitle: 'اپنے فون یا لیپ ٹاپ سے براہ راست آرڈر کریں - ہر آرڈر فوری طور پر ہم تک پہنچے گا۔',
      authFeature1: 'آرڈر کی حقیقی وقت میں ٹریکنگ', authFeature2: 'تیز چیک آؤٹ کے لیے آپ کی معلومات محفوظ',
      authFeature3: 'براہ راست واٹس ایپ اپڈیٹس',
      resetPasswordNote: 'اپنے اکاؤنٹ کا واٹس ایپ نمبر لکھیں۔ ہم اس پر نیا پاسورڈ بھیج دیں گے۔',
      sendNewPassword: 'نیا پاسورڈ بھیجیں', chooseYour: 'اپنی', products: 'مصنوعات چنیں',
      heroSubtitle: 'جو چاہیے کارٹ میں شامل کریں، پھر آرڈر کنفرم کریں - ہماری ٹیم واٹس ایپ پر رابطہ کرے گی۔',
      searchProducts: 'مصنوعات تلاش کریں...', noProductsListed: 'فی الحال کوئی پروڈکٹ موجود نہیں ہے۔',
      footerNote: 'آرڈر دینے کے بعد ہماری ٹیم واٹس ایپ پر آپ سے رابطہ کرے گی۔', viewCart: 'کارٹ دیکھیں',
      account: 'اکاؤنٹ', myOrders: 'میرے آرڈرز', myFavorites: 'پسندیدہ', feedback: 'رائے دیں',
      settings: 'سیٹنگز', cart: 'کارٹ', yourCart: 'آپ کا کارٹ', cartEmpty: 'آپ کا کارٹ خالی ہے۔', total: 'کل رقم',
      reviewOrder: 'آرڈر دیکھیں', confirmOrder: 'آرڈر کنفرم کریں',
      checkoutNote: 'یہ آرڈر آپ کی محفوظ کردہ تفصیلات کے ساتھ بھیجا جائے گا۔ کچھ بدلنا ہو تو "معلومات ترمیم کریں" پر کلک کریں۔',
      orderNote: 'آرڈر نوٹ (اختیاری)', orderNotePlaceholder: 'مثلاً شام 5 بجے کے بعد ڈیلیور کریں', placeOrder: 'آرڈر دیں',
      yourAccount: 'آپ کا اکاؤنٹ', saved: 'محفوظ ہو گیا۔', saveChanges: 'تبدیلیاں محفوظ کریں', logOut: 'لاگ آؤٹ',
      orderReceived: 'آرڈر موصول ہو گیا!', orderReceivedNote: 'شکریہ! ہماری ٹیم جلد ہی واٹس ایپ پر رابطہ کرے گی۔',
      ok: 'ٹھیک ہے', noOrdersYet: 'ابھی تک آپ نے کوئی آرڈر نہیں دیا۔',
      noFavoritesYet: 'ابھی تک آپ نے کوئی پروڈکٹ پسندیدہ میں شامل نہیں کی - دل کے نشان پر کلک کر کے شامل کریں۔',
      ratingsReviews: 'ریٹنگ اور رائے', yourRating: 'اپنی ریٹنگ دیں', yourReviewOptional: 'اپنی رائے (اختیاری)',
      whatDidYouThink: 'آپ کا کیا خیال ہے؟', submitReview: 'رائے بھیجیں',
      feedbackNote: 'ہمیں بتائیں ہم کیسا کام کر رہے ہیں - سروس، ڈلیوری یا اس ویب سائٹ کے بارے میں۔',
      yourFeedbackOptional: 'آپ کی رائے (اختیاری)', submitFeedback: 'رائے بھیجیں',
      currentPassword: 'موجودہ پاسورڈ', newPassword: 'نیا پاسورڈ', confirmNewPassword: 'نیا پاسورڈ دوبارہ لکھیں',
      passwordChanged: 'پاسورڈ تبدیل ہو گیا۔', changePassword: 'پاسورڈ تبدیل کریں', reorder: 'دوبارہ آرڈر کریں',
      noReviewsYet: 'ابھی تک کوئی رائے موجود نہیں - سب سے پہلے آپ لکھیں!', pickARating: 'براہ کرم ستارے منتخب کریں۔',
      rateThis: 'ریٹ کریں', switchLang: 'English',
      statusConfirmed: 'کنفرم', statusCancelled: 'منسوخ', statusPending: 'زیر التوا',
      adjusted: 'تبدیل شدہ', adjustedNote: 'دکان نے کنفرم کرنے سے پہلے کچھ اشیاء کی مقدار تبدیل کی ہے - نیچے کٹی ہوئی اور موٹی مقدار دیکھیں۔',
    },
  };
  let lang = localStorage.getItem('store_lang') || 'en';
  function t(key) { return (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key; }
  function applyI18n() {
    document.documentElement.lang = lang === 'ur' ? 'ur' : 'en';
    document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    const langBtn = $('langBtn');
    if (langBtn) langBtn.textContent = t('switchLang');
  }
  function setLang(next) {
    lang = next;
    localStorage.setItem('store_lang', lang);
    applyI18n();
    renderProducts(); // rating lines / reorder button text depend on lang
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---- Show/Hide toggle for every password field on the page ----
  function wirePasswordToggles() {
    document.querySelectorAll('input[type="password"]').forEach((input) => {
      if (input.closest('.pw-wrap')) return; // already wired
      const wrap = document.createElement('div');
      wrap.className = 'pw-wrap';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pw-toggle-btn';
      btn.textContent = 'Show';
      btn.addEventListener('click', () => {
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.textContent = showing ? 'Show' : 'Hide';
      });
      wrap.appendChild(btn);
    });
  }
  wirePasswordToggles();

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(path, { headers, ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  // ---- Store branding (shown on both the auth gate and the shop) ----
  async function loadStoreInfo() {
    try {
      const data = await fetch('/api/store-info').then((r) => r.json());
      const store = data.store || {};
      const initials = (store.store_name || 'IT').trim().slice(0, 2).toUpperCase();
      for (const nameEl of [$('brandName'), $('sidebarBrand')]) nameEl.textContent = store.store_name || 'IQBAL TRADER';
      $('authName').textContent = store.store_name || 'IQBAL TRADER';
      if (store.tagline) $('brandTag').textContent = store.tagline;
      document.title = store.store_name || 'Online Order';
      for (const markEl of [$('brandMark'), $('authMark')]) {
        if (store.logo_image) {
          markEl.innerHTML = `<img src="${store.logo_image}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
          markEl.classList.add('has-image');
        } else {
          markEl.textContent = initials;
          markEl.classList.remove('has-image');
        }
      }
    } catch (e) { console.error(e); }
  }

  // ---- 3D tilt effect for product tiles ----
  function attachTilt(el) {
    const strength = 10;
    el.addEventListener('mousemove', (e) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      el.style.transform = `rotateY(${x * strength}deg) rotateX(${-y * strength}deg) translateZ(0)`;
    });
    el.addEventListener('mouseleave', () => {
      el.style.transform = 'rotateY(0deg) rotateX(0deg)';
    });
  }

  // ---- Auth gate ----
  function showAuthGate() {
    $('authGate').style.display = 'flex';
    $('shopRoot').style.display = 'none';
    showLoginView();
  }
  function showShop() {
    $('authGate').style.display = 'none';
    $('shopRoot').style.display = 'block';
    loadProducts();
    loadFavoriteIds();
  }

  function showLoginView() {
    $('loginForm').style.display = 'block'; $('signupForm').style.display = 'none';
    $('loginError').style.display = 'none'; $('signupError').style.display = 'none';
  }
  function showSignupView() {
    $('signupForm').style.display = 'block'; $('loginForm').style.display = 'none';
    $('loginError').style.display = 'none'; $('signupError').style.display = 'none';
  }
  ['goToSignup2'].forEach((id) => $(id).addEventListener('click', (e) => { e.preventDefault(); showSignupView(); }));
  ['goToLogin2'].forEach((id) => $(id).addEventListener('click', (e) => { e.preventDefault(); showLoginView(); }));

  // ---- Sidebar (Account / Cart) ----
  function openSidebar() {
    $('sidebar').classList.add('open');
    $('sidebarOverlay').style.display = 'block';
  }
  function closeSidebar() {
    $('sidebar').classList.remove('open');
    $('sidebarOverlay').style.display = 'none';
  }
  $('langBtn').addEventListener('click', () => setLang(lang === 'ur' ? 'en' : 'ur'));
  $('menuBtn').addEventListener('click', openSidebar);
  $('closeSidebar').addEventListener('click', closeSidebar);
  $('sidebarOverlay').addEventListener('click', closeSidebar);

  // ---- Forgot password ----
  $('forgotPasswordLink').addEventListener('click', (e) => {
    e.preventDefault();
    $('f_whatsapp').value = $('l_whatsapp').value.trim();
    $('forgotError').style.display = 'none';
    $('forgotMsg').style.display = 'none';
    $('forgotOverlay').style.display = 'flex';
  });
  $('closeForgot').addEventListener('click', () => $('forgotOverlay').style.display = 'none');
  $('forgotOverlay').addEventListener('click', (e) => { if (e.target.id === 'forgotOverlay') $('forgotOverlay').style.display = 'none'; });

  $('forgotSubmitBtn').addEventListener('click', async () => {
    const errEl = $('forgotError');
    const msgEl = $('forgotMsg');
    errEl.style.display = 'none';
    msgEl.style.display = 'none';
    const whatsapp = $('f_whatsapp').value.trim();
    if (!whatsapp) { errEl.textContent = 'Please enter your WhatsApp number.'; errEl.style.display = 'block'; return; }
    const btn = $('forgotSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
      const data = await api('/api/customers/forgot-password', { method: 'POST', body: JSON.stringify({ whatsapp }) });
      msgEl.textContent = data.message || 'If this WhatsApp number has an account, a new password has been sent to it.';
      msgEl.style.display = 'block';
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send new password';
    }
  });

  $('loginBtn').addEventListener('click', async () => {
    const errEl = $('loginError');
    errEl.style.display = 'none';
    const whatsapp = $('l_whatsapp').value.trim();
    const password = $('l_password').value;
    if (!whatsapp || !password) { errEl.textContent = 'Please enter your WhatsApp number and password.'; errEl.style.display = 'block'; return; }
    try {
      const data = await api('/api/customers/login', { method: 'POST', body: JSON.stringify({ whatsapp, password }) });
      token = data.token;
      customer = data.customer;
      localStorage.setItem('customer_token', token);
      showShop();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  });

  $('signupBtn').addEventListener('click', async () => {
    const errEl = $('signupError');
    errEl.style.display = 'none';
    const name = $('s_name').value.trim();
    const whatsapp = $('s_whatsapp').value.trim();
    const shop_name = $('s_shop').value.trim();
    const phone = $('s_phone').value.trim();
    const address = $('s_address').value.trim();
    const password = $('s_password').value;

    if (!name) { errEl.textContent = 'Please enter the owner name.'; errEl.style.display = 'block'; return; }
    if (!shop_name) { errEl.textContent = 'Please enter your shop name.'; errEl.style.display = 'block'; return; }
    if (!phone) { errEl.textContent = 'Please enter your cell number.'; errEl.style.display = 'block'; return; }
    if (!whatsapp) { errEl.textContent = 'Please enter your WhatsApp number.'; errEl.style.display = 'block'; return; }
    if (!address) { errEl.textContent = 'Please enter your address.'; errEl.style.display = 'block'; return; }
    if (!password || password.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'block'; return; }
    try {
      const data = await api('/api/customers/signup', {
        method: 'POST',
        body: JSON.stringify({ customer_type: 'new', name, whatsapp, shop_name, phone, address, password }),
      });
      token = data.token;
      customer = data.customer;
      localStorage.setItem('customer_token', token);
      showShop();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  });

  // ---- Products ----
  let selectedUnit = {}; // product_id -> 'carton' | 'box' | 'piece' | 'single'
  let searchQuery = '';
  let selectedCategory = '';

  async function loadProducts() {
    try {
      const data = await fetch('/api/products').then((r) => r.json());
      products = data.products || [];
      renderCategoryChips();
      await loadReviewSummary();
      renderProducts();
    } catch (e) { console.error(e); }
  }

  async function loadReviewSummary() {
    try {
      const data = await fetch('/api/reviews/summary').then((r) => r.json());
      reviewSummary = data.summary || {};
    } catch (e) { console.error(e); }
  }

  async function loadFavoriteIds() {
    try {
      const data = await api('/api/customers/me/favorites');
      favoriteIds = new Set((data.products || []).map((p) => p.id));
      updateFavoritesCount();
      renderProducts();
    } catch (e) { console.error(e); }
  }

  function updateFavoritesCount() {
    const el = $('favoritesCount');
    if (el) el.textContent = favoriteIds.size;
  }

  async function toggleFavorite(productId) {
    const wasFav = favoriteIds.has(productId);
    try {
      if (wasFav) {
        favoriteIds.delete(productId);
        await api(`/api/customers/me/favorites/${productId}`, { method: 'DELETE' });
      } else {
        favoriteIds.add(productId);
        await api('/api/customers/me/favorites', { method: 'POST', body: JSON.stringify({ product_id: productId }) });
      }
    } catch (e) {
      // Roll back on failure so the heart doesn't lie about what's saved.
      if (wasFav) favoriteIds.add(productId); else favoriteIds.delete(productId);
    }
    updateFavoritesCount();
    renderProducts();
  }

  function starsHtml(avg) {
    const rounded = Math.round(Number(avg) || 0);
    return '&#9733;'.repeat(Math.max(0, Math.min(5, rounded))) + '&#9734;'.repeat(5 - Math.max(0, Math.min(5, rounded)));
  }

  function renderCategoryChips() {
    const cats = [...new Set(products.map((p) => (p.category || '').trim()).filter(Boolean))];
    const box = $('categoryChips');
    if (cats.length === 0) { box.innerHTML = ''; return; }
    box.innerHTML = `<button class="category-chip ${selectedCategory === '' ? 'active' : ''}" data-cat="">All</button>`
      + cats.map((c) => `<button class="category-chip ${selectedCategory === c ? 'active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
    box.querySelectorAll('.category-chip').forEach((btn) => {
      btn.addEventListener('click', () => { selectedCategory = btn.dataset.cat; renderCategoryChips(); renderProducts(); });
    });
  }

  $('searchInput').addEventListener('input', (e) => { searchQuery = e.target.value.trim().toLowerCase(); renderProducts(); });

  // Returns the list of buyable options for a product - one for 'single'
  // products, two or three for carton/box/piece ones.
  function unitOptions(p) {
    if (p.packing_type === 'carton_box_piece') {
      return [
        { key: 'carton', label: 'Carton', price: Number(p.price_carton) },
        { key: 'box', label: 'Box', price: Number(p.price_box) },
        { key: 'piece', label: 'Piece', price: Number(p.price_piece) },
      ];
    }
    if (p.packing_type === 'carton_piece') {
      return [
        { key: 'carton', label: 'Carton', price: Number(p.price_carton) },
        { key: 'piece', label: 'Piece', price: Number(p.price_piece) },
      ];
    }
    return [{ key: 'single', label: p.unit, price: Number(p.price) }];
  }

  function cartKey(productId, unitKey) { return productId + '::' + unitKey; }

  function renderProducts() {
    const grid = $('productGrid');
    grid.innerHTML = '';
    const visible = products.filter((p) => {
      const matchesSearch = !searchQuery || p.name.toLowerCase().includes(searchQuery);
      const matchesCategory = !selectedCategory || (p.category || '').trim() === selectedCategory;
      return matchesSearch && matchesCategory;
    });
    $('emptyMsg').style.display = visible.length ? 'none' : 'block';
    visible.forEach((p, i) => {
      const inStock = p.in_stock !== false;
      const options = unitOptions(p);
      const which = selectedUnit[p.id] || options[0].key;
      const info = options.find((o) => o.key === which) || options[0];
      const qty = cart[cartKey(p.id, info.key)]?.qty || 0;

      const wrap = document.createElement('div');
      wrap.className = 'tile-wrap' + (inStock ? '' : ' out-of-stock');
      const tile = document.createElement('div');
      tile.className = 'product-tile ' + TILE_COLORS[i % TILE_COLORS.length];
      const isFav = favoriteIds.has(p.id);
      const summary = reviewSummary[p.id];
      const ratingBadge = summary
        ? `<div class="rating-badge" data-open-reviews="${p.id}"><span class="star-ic">&#9733;</span><span class="avg-num">${summary.avg_rating}</span><span class="rating-count">(${summary.count})</span></div>`
        : `<div class="rating-badge no-reviews" data-open-reviews="${p.id}"><span class="star-ic">&#9734;</span><span>${t('rateThis')}</span></div>`;
      tile.innerHTML = `
        ${!inStock ? '<div class="out-of-stock-badge">Out of stock</div>' : ''}
        <button class="fav-btn ${isFav ? 'active' : ''}" data-fav="${p.id}" aria-label="Favorite" type="button">${isFav ? '&#9829;' : '&#9825;'}</button>
        <div class="product-name">${escapeHtml(p.name)}</div>
        ${p.description ? `<div class="product-desc">${escapeHtml(p.description)}</div>` : ''}
        <div class="product-img-box">${p.image ? `<img src="${p.image}" alt="${escapeHtml(p.name)}" />` : `<div class="product-img-placeholder">No image</div>`}</div>
        ${options.length > 1 ? `
          <div class="unit-toggle">
            ${options.map((o) => `<button class="unit-opt ${o.key === which ? 'active' : ''}" data-unit="${o.key}">${escapeHtml(o.label)}</button>`).join('')}
          </div>
        ` : ''}
        <div class="tile-footer">
          <div class="product-price">${money(info.price)} <span class="unit">${info.label ? '/ ' + escapeHtml(info.label) : ''}</span></div>
          ${ratingBadge}
        </div>
        <div class="qty-row">
          <button class="qty-btn minus" ${inStock ? '' : 'disabled'}>-</button>
          <span class="qty-val">${qty}</span>
          <button class="qty-btn plus" ${inStock ? '' : 'disabled'}>+</button>
        </div>
      `;
      if (options.length > 1) {
        tile.querySelectorAll('.unit-opt').forEach((btn) => {
          btn.addEventListener('click', () => {
            selectedUnit[p.id] = btn.dataset.unit;
            renderProducts();
          });
        });
      }
      if (inStock) {
        tile.querySelector('.minus').addEventListener('click', () => changeQty(p, info, -1));
        tile.querySelector('.plus').addEventListener('click', () => changeQty(p, info, 1));
      }
      tile.querySelector('.fav-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleFavorite(p.id); });
      tile.querySelector('[data-open-reviews]').addEventListener('click', (e) => { e.stopPropagation(); openReviews(p); });
      attachTilt(tile);
      wrap.appendChild(tile);
      grid.appendChild(wrap);
    });
  }

  function changeQty(product, info, delta) {
    const key = cartKey(product.id, info.key);
    const current = cart[key]?.qty || 0;
    const next = Math.max(0, current + delta);
    if (next === 0) delete cart[key];
    else cart[key] = { product, unitKey: info.key, unitLabel: info.label, price: info.price, qty: next };
    renderProducts();
    if ($('cartOverlay').style.display === 'flex') renderCart();
    updateCartCount();
  }

  function cartTotal() {
    return Object.values(cart).reduce((s, l) => s + l.qty * (l.price || 0), 0);
  }

  function updateCartCount() {
    const count = Object.values(cart).reduce((s, l) => s + l.qty, 0);
    $('cartCount').textContent = count;

    const bar = $('stickyCartBar');
    if (count > 0) {
      $('stickyCartCount').textContent = count + (count === 1 ? ' item' : ' items');
      $('stickyCartTotal').textContent = money(cartTotal());
      bar.style.display = 'flex';
    } else {
      bar.style.display = 'none';
    }
  }

  // ---- Cart drawer ----
  function openCart() { renderCart(); $('cartOverlay').style.display = 'flex'; }
  $('cartBtn').addEventListener('click', () => { closeSidebar(); openCart(); });
  $('stickyCartBtn').addEventListener('click', openCart);
  $('closeCart').addEventListener('click', () => $('cartOverlay').style.display = 'none');
  $('cartOverlay').addEventListener('click', (e) => { if (e.target.id === 'cartOverlay') $('cartOverlay').style.display = 'none'; });

  function renderCart() {
    const lines = Object.values(cart);
    const box = $('cartLines');
    box.innerHTML = '';
    $('cartEmptyNote').style.display = lines.length ? 'none' : 'block';
    $('cartTotalRow').style.display = lines.length ? 'flex' : 'none';
    for (const l of lines) {
      const info = { key: l.unitKey, label: l.unitLabel, price: l.price };
      const row = document.createElement('div');
      row.className = 'cart-line';
      row.innerHTML = `
        <div>
          <div class="name">${escapeHtml(l.product.name)} ${l.unitLabel ? `<span class="sub">(${escapeHtml(l.unitLabel)})</span>` : ''}</div>
          <div class="sub">${l.qty} x ${money(l.price)}</div>
        </div>
        <div class="qty-row" style="margin-top:0;">
          <button class="qty-btn minus">-</button>
          <span class="qty-val">${l.qty}</span>
          <button class="qty-btn plus">+</button>
        </div>
      `;
      row.querySelector('.minus').addEventListener('click', () => changeQty(l.product, info, -1));
      row.querySelector('.plus').addEventListener('click', () => changeQty(l.product, info, 1));
      box.appendChild(row);
    }
    $('cartTotal').textContent = money(cartTotal());
  }

  // ---- Checkout (review saved profile, then place order) ----
  $('checkoutBtn').addEventListener('click', () => {
    if (Object.keys(cart).length === 0) return;
    $('cartOverlay').style.display = 'none';
    renderCheckoutProfile();
    $('checkoutNote').value = '';
    $('checkoutOverlay').style.display = 'flex';
  });
  $('closeCheckout').addEventListener('click', () => $('checkoutOverlay').style.display = 'none');
  $('checkoutOverlay').addEventListener('click', (e) => { if (e.target.id === 'checkoutOverlay') $('checkoutOverlay').style.display = 'none'; });

  function renderCheckoutProfile() {
    const box = $('checkoutProfileBox');
    box.innerHTML = `
      <div class="profile-row"><span>Name</span><span>${escapeHtml(customer.name)}</span></div>
      ${customer.shop_name ? `<div class="profile-row"><span>Shop</span><span>${escapeHtml(customer.shop_name)}</span></div>` : ''}
      <div class="profile-row"><span>WhatsApp</span><span>${escapeHtml(customer.whatsapp)}</span></div>
      ${customer.address ? `<div class="profile-row"><span>Address</span><span>${escapeHtml(customer.address)}</span></div>` : ''}
      <div class="profile-row" style="border-bottom:none;"><a href="#" id="editInfoLink" style="color:var(--gold); font-weight:700;">Edit info</a></div>
    `;
    $('editInfoLink').addEventListener('click', (e) => { e.preventDefault(); $('checkoutOverlay').style.display = 'none'; openProfile(); });
  }

  $('submitOrderBtn').addEventListener('click', async () => {
    const errEl = $('checkoutError');
    errEl.style.display = 'none';
    const items = Object.values(cart).map((l) => ({ product_name: l.product.name, quantity: l.qty, unit: l.unitLabel, price: l.price }));
    const note = $('checkoutNote').value.trim();
    const btn = $('submitOrderBtn');
    btn.disabled = true;
    btn.textContent = 'Placing order...';
    try {
      await api('/api/orders', { method: 'POST', body: JSON.stringify({ items, note }) });
      cart = {};
      updateCartCount();
      renderProducts();
      $('checkoutOverlay').style.display = 'none';
      $('successOverlay').style.display = 'flex';
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Place order';
    }
  });
  $('successCloseBtn').addEventListener('click', () => $('successOverlay').style.display = 'none');

  // ---- Profile modal ----
  $('profileBtn').addEventListener('click', () => { closeSidebar(); openProfile(); });
  $('closeProfile').addEventListener('click', () => $('profileOverlay').style.display = 'none');
  $('profileOverlay').addEventListener('click', (e) => { if (e.target.id === 'profileOverlay') $('profileOverlay').style.display = 'none'; });

  function openProfile() {
    $('p_name').value = customer.name || '';
    $('p_shop').value = customer.shop_name || '';
    $('p_phone').value = customer.phone || '';
    $('p_address').value = customer.address || '';
    $('profileError').style.display = 'none';
    $('profileMsg').style.display = 'none';
    $('profileOverlay').style.display = 'flex';
  }

  $('saveProfileBtn').addEventListener('click', async () => {
    const errEl = $('profileError');
    const msgEl = $('profileMsg');
    errEl.style.display = 'none';
    msgEl.style.display = 'none';
    const name = $('p_name').value.trim();
    if (!name) { errEl.textContent = 'Please enter your name.'; errEl.style.display = 'block'; return; }
    try {
      const data = await api('/api/customers/me', {
        method: 'PUT',
        body: JSON.stringify({ name, shop_name: $('p_shop').value.trim(), phone: $('p_phone').value.trim(), address: $('p_address').value.trim() }),
      });
      customer = data.customer;
      msgEl.style.display = 'block';
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  });

  $('logoutBtn').addEventListener('click', async () => {
    try { await api('/api/customers/logout', { method: 'POST' }); } catch {}
    token = '';
    customer = null;
    localStorage.removeItem('customer_token');
    $('profileOverlay').style.display = 'none';
    showAuthGate();
  });

  // ---- My Orders ----
  $('myOrdersBtn').addEventListener('click', () => { closeSidebar(); openMyOrders(); });
  $('closeMyOrders').addEventListener('click', () => $('myOrdersOverlay').style.display = 'none');
  $('myOrdersOverlay').addEventListener('click', (e) => { if (e.target.id === 'myOrdersOverlay') $('myOrdersOverlay').style.display = 'none'; });

  async function openMyOrders() {
    $('myOrdersOverlay').style.display = 'flex';
    $('myOrdersList').innerHTML = '<p class="info-note">Loading...</p>';
    $('myOrdersEmptyNote').style.display = 'none';
    try {
      const data = await api('/api/customers/me/orders');
      renderMyOrders(data.orders || []);
    } catch (e) {
      $('myOrdersList').innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
    }
  }

  function statusLabel(status) {
    if (status === 'confirmed') return t('statusConfirmed');
    if (status === 'cancelled') return t('statusCancelled');
    return t('statusPending');
  }

  function orderItemLineHtml(it) {
    const unit = escapeHtml(it.unit || '');
    const hasAdjustment = it.confirmed_quantity != null && Number(it.confirmed_quantity) !== Number(it.quantity);
    const qtyPart = hasAdjustment
      ? `<span style="text-decoration:line-through; opacity:.55;">${it.quantity}</span> &rarr; <b style="color:var(--gold);">${it.confirmed_quantity}</b> ${unit}`
      : `${it.quantity} ${unit}`;
    return `${escapeHtml(it.product_name)} - ${qtyPart} x ${money(it.price)}`;
  }

  function orderBillTotal(o) {
    return o.items.reduce((s, it) => s + (it.confirmed_quantity != null ? Number(it.confirmed_quantity) : Number(it.quantity)) * Number(it.price), 0);
  }

  function renderMyOrders(orders) {
    const box = $('myOrdersList');
    box.innerHTML = '';
    $('myOrdersEmptyNote').style.display = orders.length ? 'none' : 'block';
    for (const o of orders) {
      const card = document.createElement('div');
      card.className = 'order-card';
      const dateStr = (o.order_date || '').toString().replace('T', ' ').slice(0, 16);
      card.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
          <span style="font-weight:700; font-size:13px;">${dateStr}</span>
          <div style="display:flex; align-items:center; gap:6px;">
            ${o.altered ? `<span class="pill-adjusted">${t('adjusted')}</span>` : ''}
            <span class="pill-status ${o.status === 'cancelled' ? 'pill-cancelled' : o.status === 'confirmed' ? 'pill-confirmed' : 'pill-new'}">${statusLabel(o.status)}</span>
          </div>
        </div>
        <div class="items">${o.items.map(orderItemLineHtml).join('<br>')}</div>
        ${o.altered ? `<div class="info-note" style="margin-top:6px; font-size:11.5px;">${t('adjustedNote')}</div>` : ''}
        <div style="font-weight:700; margin-top:8px;">${money(orderBillTotal(o))}</div>
        <button class="btn btn-navy reorder-btn" style="width:100%; margin-top:10px;">${t('reorder')}</button>
      `;
      card.querySelector('.reorder-btn').addEventListener('click', () => reorder(o));
      box.appendChild(card);
    }
  }

  // Adds every item from a past order back into the cart, matched against
  // today's product list/prices by name (a discontinued item is skipped).
  function reorder(order) {
    for (const it of order.items) {
      const product = products.find((p) => p.name === it.product_name);
      if (!product || product.in_stock === false) continue;
      const options = unitOptions(product);
      const matchedOption = options.find((o) => o.label === it.unit) || options[0];
      const key = cartKey(product.id, matchedOption.key);
      const current = cart[key]?.qty || 0;
      cart[key] = { product, unitKey: matchedOption.key, unitLabel: matchedOption.label, price: matchedOption.price, qty: current + Number(it.quantity) };
    }
    updateCartCount();
    renderProducts();
    $('myOrdersOverlay').style.display = 'none';
    openCart();
  }

  // ---- My Favorites ----
  $('favoritesBtn').addEventListener('click', () => { closeSidebar(); openFavorites(); });
  $('closeFavorites').addEventListener('click', () => $('favoritesOverlay').style.display = 'none');
  $('favoritesOverlay').addEventListener('click', (e) => { if (e.target.id === 'favoritesOverlay') $('favoritesOverlay').style.display = 'none'; });

  function openFavorites() {
    $('favoritesOverlay').style.display = 'flex';
    renderFavorites();
  }

  function renderFavorites() {
    const favProducts = products.filter((p) => favoriteIds.has(p.id));
    const box = $('favoritesList');
    box.innerHTML = '';
    $('favoritesEmptyNote').style.display = favProducts.length ? 'none' : 'block';
    for (const p of favProducts) {
      const options = unitOptions(p);
      const info = options[0];
      const card = document.createElement('div');
      card.className = 'order-card';
      card.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span style="font-weight:700; font-size:13.5px;">${escapeHtml(p.name)}</span>
          <span>${money(info.price)}${info.label ? ' / ' + escapeHtml(info.label) : ''}</span>
        </div>
        <div style="display:flex; gap:8px; margin-top:10px;">
          <button class="btn btn-navy add-cart-btn" style="flex:1;" ${p.in_stock === false ? 'disabled' : ''}>${p.in_stock === false ? 'Out of stock' : 'Add to cart'}</button>
          <button class="btn btn-outline remove-fav-btn">Remove</button>
        </div>
      `;
      card.querySelector('.add-cart-btn').addEventListener('click', () => { changeQty(p, info, 1); $('favoritesOverlay').style.display = 'none'; openCart(); });
      card.querySelector('.remove-fav-btn').addEventListener('click', async () => { await toggleFavorite(p.id); renderFavorites(); });
      box.appendChild(card);
    }
  }

  // ---- Star picker (shared logic for product reviews + general feedback) ----
  function wireStarPicker(pickerId, onChange) {
    const stars = document.querySelectorAll(`#${pickerId} .star-pick`);
    stars.forEach((star) => {
      star.addEventListener('click', () => {
        const val = Number(star.dataset.val);
        onChange(val);
        stars.forEach((s) => s.classList.toggle('filled', Number(s.dataset.val) <= val));
      });
    });
  }
  wireStarPicker('reviewStarPicker', (val) => { reviewStarValue = val; });
  wireStarPicker('feedbackStarPicker', (val) => { feedbackStarValue = val; });

  function renderReviewCards(containerEl, reviews) {
    if (!reviews.length) { containerEl.innerHTML = `<p class="empty-note">${t('noReviewsYet')}</p>`; return; }
    containerEl.innerHTML = reviews.map((r) => `
      <div class="review-card">
        <span class="rname">${escapeHtml(r.customer_name || 'Customer')}</span><span class="rstars">${starsHtml(r.rating)}</span>
        ${r.comment ? `<div class="rcomment">${escapeHtml(r.comment)}</div>` : ''}
        <div class="rdate">${(r.created_at || '').toString().replace('T', ' ').slice(0, 16)}</div>
      </div>
    `).join('');
  }

  // ---- Product reviews overlay ----
  $('closeReviews').addEventListener('click', () => $('reviewsOverlay').style.display = 'none');
  $('reviewsOverlay').addEventListener('click', (e) => { if (e.target.id === 'reviewsOverlay') $('reviewsOverlay').style.display = 'none'; });

  async function openReviews(product) {
    currentReviewProductId = product.id;
    reviewStarValue = 0;
    $('reviewsTitle').textContent = product.name;
    document.querySelectorAll('#reviewStarPicker .star-pick').forEach((s) => s.classList.remove('filled'));
    $('reviewComment').value = '';
    $('reviewError').style.display = 'none';
    $('reviewsList').innerHTML = '<p class="info-note">Loading...</p>';
    $('reviewsOverlay').style.display = 'flex';
    const summary = reviewSummary[product.id];
    $('reviewsSummaryBox').innerHTML = summary
      ? `<span class="avg">${summary.avg_rating}</span><div><span class="stars">${starsHtml(summary.avg_rating)}</span><span class="count">${summary.count} review${summary.count === 1 ? '' : 's'}</span></div>`
      : '';
    try {
      const data = await fetch(`/api/reviews?product_id=${product.id}`).then((r) => r.json());
      renderReviewCards($('reviewsList'), data.reviews || []);
    } catch (e) {
      $('reviewsList').innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
    }
  }

  $('submitReviewBtn').addEventListener('click', async () => {
    const errEl = $('reviewError');
    errEl.style.display = 'none';
    if (!reviewStarValue) { errEl.textContent = t('pickARating'); errEl.style.display = 'block'; return; }
    const btn = $('submitReviewBtn');
    btn.disabled = true;
    try {
      await api('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({ target_type: 'product', product_id: currentReviewProductId, rating: reviewStarValue, comment: $('reviewComment').value.trim() }),
      });
      await loadReviewSummary();
      const product = products.find((p) => p.id === currentReviewProductId);
      if (product) await openReviews(product);
      renderProducts();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
    }
  });

  // ---- General feedback overlay (service / website) ----
  $('feedbackBtn').addEventListener('click', () => { closeSidebar(); openFeedback(); });
  $('closeFeedback').addEventListener('click', () => $('feedbackOverlay').style.display = 'none');
  $('feedbackOverlay').addEventListener('click', (e) => { if (e.target.id === 'feedbackOverlay') $('feedbackOverlay').style.display = 'none'; });

  async function openFeedback() {
    feedbackStarValue = 0;
    document.querySelectorAll('#feedbackStarPicker .star-pick').forEach((s) => s.classList.remove('filled'));
    $('feedbackComment').value = '';
    $('feedbackError').style.display = 'none';
    $('feedbackList').innerHTML = '<p class="info-note">Loading...</p>';
    $('feedbackOverlay').style.display = 'flex';
    try {
      const data = await fetch('/api/reviews?general=1').then((r) => r.json());
      renderReviewCards($('feedbackList'), data.reviews || []);
    } catch (e) {
      $('feedbackList').innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
    }
  }

  $('submitFeedbackBtn').addEventListener('click', async () => {
    const errEl = $('feedbackError');
    errEl.style.display = 'none';
    if (!feedbackStarValue) { errEl.textContent = t('pickARating'); errEl.style.display = 'block'; return; }
    const btn = $('submitFeedbackBtn');
    btn.disabled = true;
    try {
      await api('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({ target_type: 'general', rating: feedbackStarValue, comment: $('feedbackComment').value.trim() }),
      });
      await openFeedback();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
    }
  });

  // ---- Settings (change password) ----
  $('settingsBtn').addEventListener('click', () => {
    closeSidebar();
    $('st_current').value = '';
    $('st_new').value = '';
    $('st_confirm').value = '';
    $('settingsError').style.display = 'none';
    $('settingsMsg').style.display = 'none';
    $('settingsOverlay').style.display = 'flex';
  });
  $('closeSettings').addEventListener('click', () => $('settingsOverlay').style.display = 'none');
  $('settingsOverlay').addEventListener('click', (e) => { if (e.target.id === 'settingsOverlay') $('settingsOverlay').style.display = 'none'; });

  $('saveSettingsBtn').addEventListener('click', async () => {
    const errEl = $('settingsError');
    const msgEl = $('settingsMsg');
    errEl.style.display = 'none';
    msgEl.style.display = 'none';
    const current_password = $('st_current').value;
    const new_password = $('st_new').value;
    const confirm_password = $('st_confirm').value;
    if (!current_password) { errEl.textContent = 'Please enter your current password.'; errEl.style.display = 'block'; return; }
    if (!new_password || new_password.length < 6) { errEl.textContent = 'New password must be at least 6 characters.'; errEl.style.display = 'block'; return; }
    if (new_password !== confirm_password) { errEl.textContent = 'New passwords do not match.'; errEl.style.display = 'block'; return; }
    const btn = $('saveSettingsBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      await api('/api/customers/me/password', { method: 'PUT', body: JSON.stringify({ current_password, new_password }) });
      msgEl.style.display = 'block';
      $('st_current').value = '';
      $('st_new').value = '';
      $('st_confirm').value = '';
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Change password';
    }
  });

  // ---- Boot ----
  (async () => {
    applyI18n();
    await loadStoreInfo();
    if (token) {
      try {
        const data = await api('/api/customers/me');
        customer = data.customer;
        showShop();
        return;
      } catch (e) {
        token = '';
        localStorage.removeItem('customer_token');
      }
    }
    showAuthGate();
  })();
})();
