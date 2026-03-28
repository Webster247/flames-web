let APP = window.APP_CONFIG || {};
let menuItems = APP.menuItems || [];
let branches = APP.branches || [];
let categories = ['All'];

const API_BASE_CANDIDATES = [
  ...(window.location.protocol !== 'file:' && window.location.origin ? [window.location.origin] : []),
  'http://localhost:3000',
  'http://127.0.0.1:3000'
].filter((value, index, array) => array.indexOf(value) === index);

let ACTIVE_API_BASE_URL = API_BASE_CANDIDATES[0] || 'http://localhost:3000';

function apiUrl(path, baseUrl = ACTIVE_API_BASE_URL) {
  return `${baseUrl}${path}`;
}

async function detectWorkingApiBase() {
  for (const baseUrl of API_BASE_CANDIDATES) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { cache: 'no-store' });
      if (response.ok) {
        ACTIVE_API_BASE_URL = baseUrl;
        return baseUrl;
      }
    } catch (error) {
      console.log(`API probe failed for ${baseUrl}`, error);
    }
  }

  ACTIVE_API_BASE_URL = API_BASE_CANDIDATES[0] || 'http://localhost:3000';
  return ACTIVE_API_BASE_URL;
}

function normalizeAssetUrl(value) {
  if (!value) return '';
  if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value;
  const base = ACTIVE_API_BASE_URL || window.location.origin || 'http://localhost:3000';
  return `${base}${value.startsWith('/') ? value : `/${value}`}`;
}

async function parseApiResponse(response, fallbackMessage) {
  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new Error(text || fallbackMessage);
      }
      throw new Error(fallbackMessage || 'Invalid server response.');
    }
  }

  if (!response.ok) {
    throw new Error(data?.message || text || fallbackMessage);
  }

  return data || {};
}

let selectedCategory = 'All';
let searchText = '';
let cart = [];

const categoryRow = document.getElementById('categoryRow');
const menuGrid = document.getElementById('menuGrid');
const searchInput = document.getElementById('searchInput');
const cartCount = document.getElementById('cartCount');
const cartItems = document.getElementById('cartItems');
const cartTotal = document.getElementById('cartTotal');
const cartPanel = document.getElementById('cartPanel');
const cartBackdrop = document.getElementById('cartBackdrop');
const openCartBtn = document.getElementById('openCartBtn');
const closeCartBtn = document.getElementById('closeCartBtn');
const checkoutBtn = document.getElementById('checkoutBtn');
const checkoutModal = document.getElementById('checkoutModal');
const closeCheckoutBtn = document.getElementById('closeCheckoutBtn');
const checkoutForm = document.getElementById('checkoutForm');
const branchSelectEl = document.getElementById('branchSelect');
const orderTypeEl = document.getElementById('orderType');
const paymentMethodEl = document.getElementById('paymentMethod');
const addressField = document.getElementById('addressField');
const deliveryAddress = document.getElementById('deliveryAddress');
const receiptInput = document.getElementById('receipt');
const formMessage = document.getElementById('formMessage');
const bankBox = document.getElementById('bankBox');
const deliveryAreaField = document.getElementById('deliveryAreaField');
const deliveryAreaEl = document.getElementById('deliveryArea');
const subtotalAmountEl = document.getElementById('subtotalAmount');
const deliveryFeeAmountEl = document.getElementById('deliveryFeeAmount');
const finalTotalAmountEl = document.getElementById('finalTotalAmount');
const submitOrderBtn = document.getElementById('submitOrderBtn');
const customerAccountNameField = document.getElementById('customerAccountNameField');
const customerAccountNameInput = document.getElementById('customerAccountName');

function formatNaira(amount) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0
  }).format(Number(amount || 0));
}

function refreshDerivedData() {
  menuItems = APP.menuItems || [];
  branches = APP.branches || [];
  categories = ['All', ...new Set(menuItems.map(item => item.category))];
}

function setBrandContent() {
  document.getElementById('heroTag').textContent = APP.tagline;
  document.getElementById('heroTitle').innerHTML = APP.heroTitle;
  document.getElementById('heroSubtitle').textContent = APP.heroSubtitle;
  document.getElementById('heroImage').src = normalizeAssetUrl(APP.heroImage);
  document.getElementById('brandLogo').src = normalizeAssetUrl(APP.logoUrl || APP.heroImage);
  document.getElementById('brandLogo').style.display = APP.logoUrl || APP.heroImage ? 'block' : 'none';
  document.querySelector('.hero').style.background = `radial-gradient(circle at 15% 20%, rgba(250,204,21,.18), transparent 16%), radial-gradient(circle at 82% 18%, rgba(249,115,22,.18), transparent 18%), linear-gradient(rgba(0,0,0,.62),rgba(0,0,0,.72)), url('${normalizeAssetUrl(APP.heroBackgroundImage || APP.heroImage)}') center/cover no-repeat`;
  document.getElementById('businessNameCard').textContent = APP.businessName;
  document.getElementById('businessAddressCard').textContent = APP.businessAddress;
  document.getElementById('brandNameStrip').textContent = APP.businessName;
  document.getElementById('openingHoursStrip').textContent = APP.openingHours;
  document.getElementById('phoneStrip').textContent = `Phone: ${APP.businessPhone}`;
}

function renderBranches() {
  branchSelectEl.innerHTML = ['<option value="">Select branch</option>', ...branches.map(branch => `<option value="${branch.id}">${branch.name}</option>`)].join('');
  if (branches[0]) {
    branchSelectEl.value = branches[0].id;
  }
  updateBankDetails();
  renderDeliveryAreas();
}

function renderCategories() {
  categoryRow.innerHTML = categories.map(category => `
    <button class="category-chip ${category === selectedCategory ? 'active' : ''}" data-category="${category}">${category}</button>
  `).join('');

  document.querySelectorAll('.category-chip').forEach(button => {
    button.addEventListener('click', () => {
      selectedCategory = button.dataset.category;
      renderCategories();
      renderMenu();
    });
  });
}

function renderMenu() {
  const filteredItems = menuItems.filter(item => {
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    const matchesSearch = item.name.toLowerCase().includes(searchText.toLowerCase()) || item.description.toLowerCase().includes(searchText.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  if (!filteredItems.length) {
    menuGrid.innerHTML = '<div class="empty-cart">No meals match your search.</div>';
    return;
  }

  menuGrid.innerHTML = filteredItems.map(item => `
    <article class="menu-card">
      <img src="${normalizeAssetUrl(item.image)}" alt="${item.name}" />
      <div class="menu-content">
        <div class="menu-top-row">
          <h3>${item.name}</h3>
          <span class="price-tag">${formatNaira(item.price)}</span>
        </div>
        <p>${item.description}</p>
        <div class="menu-meta">
          <span>${item.category}</span>
          ${item.popular ? '<span class="popular-badge">Popular</span>' : ''}
        </div>
        <button class="add-btn" data-id="${item.id}">Add to cart</button>
      </div>
    </article>
  `).join('');

  document.querySelectorAll('.add-btn').forEach(button => {
    button.addEventListener('click', () => addToCart(Number(button.dataset.id)));
  });
}

function addToCart(itemId) {
  const item = menuItems.find(entry => entry.id === itemId);
  if (!item) return;

  const existing = cart.find(entry => entry.id === itemId);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ ...item, quantity: 1 });
  }

  renderCart();
}

function updateQuantity(itemId, type) {
  cart = cart.map(item => {
    if (item.id !== itemId) return item;
    const quantity = type === 'inc' ? item.quantity + 1 : item.quantity - 1;
    return { ...item, quantity };
  }).filter(item => item.quantity > 0);

  renderCart();
}

function renderCart() {
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  cartCount.textContent = itemCount;

  if (!cart.length) {
    cartItems.innerHTML = '<div class="empty-cart">Your cart is empty. Add some meals to continue.</div>';
    updateTotals();
    return;
  }

  cartItems.innerHTML = cart.map(item => `
    <div class="cart-item">
      <img src="${normalizeAssetUrl(item.image)}" alt="${item.name}">
      <div>
        <h4>${item.name}</h4>
        <div class="item-price">${formatNaira(item.price)}</div>
        <div class="qty-row">
          <button class="qty-btn" data-id="${item.id}" data-type="dec">-</button>
          <span>${item.quantity}</span>
          <button class="qty-btn" data-id="${item.id}" data-type="inc">+</button>
        </div>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.qty-btn').forEach(button => {
    button.addEventListener('click', () => updateQuantity(Number(button.dataset.id), button.dataset.type));
  });

  updateTotals();
}

function openCart() {
  cartPanel.classList.add('open');
  cartBackdrop.classList.add('show');
}

function closeCart() {
  cartPanel.classList.remove('open');
  cartBackdrop.classList.remove('show');
}

function openCheckout() {
  if (!cart.length) {
    formMessage.textContent = 'Add items to cart before checkout.';
    formMessage.style.color = '#b91c1c';
    return;
  }

  formMessage.textContent = '';
  checkoutModal.classList.add('show');
  updateTotals();
}

function closeCheckout() {
  checkoutModal.classList.remove('show');
}

function getSelectedBranch() {
  return branches.find(branch => branch.id === branchSelectEl.value) || null;
}

function updateBankDetails() {
  const branch = getSelectedBranch();
  document.getElementById('selectedBranchNameText').textContent = branch?.name || '-';
  document.getElementById('bankNameText').textContent = branch?.bankName || '-';
  document.getElementById('bankAccountNameText').textContent = branch?.accountName || '-';
  document.getElementById('bankAccountNumberText').textContent = branch?.accountNumber || '-';
}

function renderDeliveryAreas() {
  const branch = getSelectedBranch();

  if (!branch || !branch.deliveryZones) {
    deliveryAreaEl.innerHTML = '<option value="">Select delivery area</option>';
    return;
  }

  deliveryAreaEl.innerHTML = [
    '<option value="">Select delivery area</option>',
    ...branch.deliveryZones.map(zone => `
      <option value="${zone.area}" data-fee="${zone.fee}">${zone.area} - ${formatNaira(zone.fee)}</option>
    `)
  ].join('');
}

function getDeliveryFee() {
  if (orderTypeEl.value !== 'delivery') return 0;
  const selectedOption = deliveryAreaEl.options[deliveryAreaEl.selectedIndex];
  if (!selectedOption || !selectedOption.dataset.fee) return 0;
  return Number(selectedOption.dataset.fee);
}

function calculateSubtotal() {
  return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function updateTotals() {
  const subtotal = calculateSubtotal();
  const deliveryFee = getDeliveryFee();
  const finalTotal = subtotal + deliveryFee;

  subtotalAmountEl.textContent = formatNaira(subtotal);
  deliveryFeeAmountEl.textContent = formatNaira(deliveryFee);
  finalTotalAmountEl.textContent = formatNaira(finalTotal);
  cartTotal.textContent = formatNaira(finalTotal);
}

function toggleConditionalFields() {
  const isDelivery = orderTypeEl.value === 'delivery';
  const isTransfer = paymentMethodEl.value === 'bank_transfer';

  addressField.classList.toggle('hidden', !isDelivery);
  deliveryAreaField.classList.toggle('hidden', !isDelivery);
  bankBox.classList.toggle('hidden', !isTransfer);
  customerAccountNameField.classList.toggle('hidden', !isTransfer);

  deliveryAddress.required = isDelivery;
  deliveryAreaEl.required = isDelivery;
  receiptInput.required = isTransfer;
  customerAccountNameInput.required = isTransfer;

  if (!isDelivery) {
    deliveryAddress.value = '';
    deliveryAreaEl.value = '';
  }

  if (!isTransfer) {
    receiptInput.value = '';
    customerAccountNameInput.value = '';
  }

  updateBankDetails();
  renderDeliveryAreas();
  updateTotals();
}

async function submitOrder(event) {
  event.preventDefault();

  if (!cart.length) {
    formMessage.textContent = 'Your cart is empty.';
    formMessage.style.color = '#b91c1c';
    return;
  }

  const branch = getSelectedBranch();
  if (!branch) {
    formMessage.textContent = 'Please select a branch.';
    formMessage.style.color = '#b91c1c';
    return;
  }

  if (orderTypeEl.value === 'delivery' && !deliveryAreaEl.value) {
    formMessage.textContent = 'Please select delivery area.';
    formMessage.style.color = '#b91c1c';
    return;
  }

  if (paymentMethodEl.value === 'bank_transfer' && !customerAccountNameInput.value.trim()) {
    formMessage.textContent = 'Please enter the account name used for the transfer.';
    formMessage.style.color = '#b91c1c';
    return;
  }

  const deliveryFee = getDeliveryFee();
  const subtotal = calculateSubtotal();
  const finalTotal = subtotal + deliveryFee;

  const formData = new FormData(checkoutForm);
  formData.append('cart', JSON.stringify(cart));
  formData.append('totalAmount', String(subtotal));
  formData.append('deliveryFee', String(deliveryFee));
  formData.append('subtotal', String(subtotal));
  formData.append('finalTotal', String(finalTotal));
  formData.append('deliveryArea', deliveryAreaEl.value || '');
  formData.append('branchId', branch.id);
  formData.append('branchName', branch.name);
  formData.append('branchWhatsApp', branch.whatsapp);

  submitOrderBtn.disabled = true;
  submitOrderBtn.textContent = 'Submitting...';
  formMessage.textContent = 'Submitting your order...';
  formMessage.style.color = '#c2410c';

  try {
    await detectWorkingApiBase();

    let response;
    let lastError = null;

    for (const baseUrl of [ACTIVE_API_BASE_URL, ...API_BASE_CANDIDATES.filter(url => url !== ACTIVE_API_BASE_URL)]) {
      try {
        response = await fetch(apiUrl('/api/orders', baseUrl), {
          method: 'POST',
          body: formData
        });
        ACTIVE_API_BASE_URL = baseUrl;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!response) {
      throw new Error(lastError?.message || 'Could not reach the backend server. Start the backend and open the site through http://localhost:3000');
    }

    const data = await parseApiResponse(response, 'Could not submit order.');

    formMessage.textContent = data.message || 'Order submitted successfully.';
    formMessage.style.color = '#166534';
    cart = [];
    renderCart();
    checkoutForm.reset();
    renderBranches();
    toggleConditionalFields();
    updateTotals();

    setTimeout(() => {
      closeCheckout();
      alert('Order placed successfully. The selected branch dashboard has received it.');
    }, 800);
  } catch (error) {
    formMessage.textContent = error.message || 'Could not submit order. Start the backend and open the site through http://localhost:3000';
    formMessage.style.color = '#b91c1c';
  } finally {
    submitOrderBtn.disabled = false;
    submitOrderBtn.textContent = 'Submit Order';
  }
}

searchInput.addEventListener('input', event => {
  searchText = event.target.value;
  renderMenu();
});

openCartBtn.addEventListener('click', openCart);
closeCartBtn.addEventListener('click', closeCart);
cartBackdrop.addEventListener('click', closeCart);
checkoutBtn.addEventListener('click', openCheckout);
closeCheckoutBtn.addEventListener('click', closeCheckout);
checkoutModal.addEventListener('click', event => {
  if (event.target === checkoutModal) closeCheckout();
});
branchSelectEl.addEventListener('change', () => {
  updateBankDetails();
  renderDeliveryAreas();
  updateTotals();
});
orderTypeEl.addEventListener('change', toggleConditionalFields);
deliveryAreaEl.addEventListener('change', updateTotals);
paymentMethodEl.addEventListener('change', toggleConditionalFields);
checkoutForm.addEventListener('submit', submitOrder);

async function initApp() {
  try {
    await detectWorkingApiBase();
    const response = await fetch(apiUrl('/api/site-config'), { cache: 'no-store' });
    if (response.ok) {
      APP = await parseApiResponse(response, 'Could not load site settings.');
    }
  } catch (error) {
    console.log('Using fallback config', error);
  }
  refreshDerivedData();
  setBrandContent();
  renderBranches();
  renderCategories();
  renderMenu();
  renderCart();
}

initApp();
renderDeliveryAreas();
updateBankDetails();
updateTotals();
toggleConditionalFields();
