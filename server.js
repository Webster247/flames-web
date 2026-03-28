import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pdfParse from 'pdf-parse';
import Tesseract from 'tesseract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, '../frontend');

const app = express();
const PORT = process.env.PORT || 3000;
const uploadDir = path.join(__dirname, 'uploads');
const ordersFile = path.join(__dirname, 'orders.json');
const siteConfigFile = path.join(__dirname, 'site-config.json');
const ALLOWED_STATUSES = ['pending', 'preparing', 'completed', 'delivered', 'cancelled'];

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`)
});

const upload = multer({ storage });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(frontendDir));

function defaultSiteConfig() {
  return JSON.parse(fs.readFileSync(siteConfigFile, 'utf-8'));
}

function readSiteConfig() {
  if (!fs.existsSync(siteConfigFile)) {
    const fallback = { businessName: 'Flames Shawarma and Grill', branches: [], menuItems: [] };
    fs.writeFileSync(siteConfigFile, JSON.stringify(fallback, null, 2));
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(siteConfigFile, 'utf-8'));
  } catch {
    return { businessName: 'Flames Shawarma and Grill', branches: [], menuItems: [] };
  }
}

function writeSiteConfig(config) {
  fs.writeFileSync(siteConfigFile, JSON.stringify(config, null, 2));
}

function readOrders() {
  if (!fs.existsSync(ordersFile)) {
    return [];
  }

  try {
    return JSON.parse(fs.readFileSync(ordersFile, 'utf-8') || '[]');
  } catch {
    return [];
  }
}

function writeOrders(orders) {
  fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
}

function formatNaira(amount) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0
  }).format(Number(amount || 0));
}

function buildBranchStats(orders) {
  return {
    totalOrders: orders.length,
    pendingOrders: orders.filter(order => order.status === 'pending').length,
    preparingOrders: orders.filter(order => order.status === 'preparing').length,
    completedOrders: orders.filter(order => order.status === 'completed').length,
    deliveredOrders: orders.filter(order => order.status === 'delivered').length,
    cancelledOrders: orders.filter(order => order.status === 'cancelled').length,
    totalSales: orders
      .filter(order => order.status !== 'cancelled')
      .reduce((sum, order) => sum + Number(order.finalTotal || order.totalAmount || 0), 0)
  };
}

function buildOverallSummary(orders) {
  const branchMap = new Map();

  for (const order of orders) {
    const key = order.branchId || 'unknown';

    if (!branchMap.has(key)) {
      branchMap.set(key, {
        branchId: order.branchId || 'unknown',
        branchName: order.branchName || 'Unknown Branch',
        totalOrders: 0,
        pendingOrders: 0,
        preparingOrders: 0,
        completedOrders: 0,
        deliveredOrders: 0,
        cancelledOrders: 0,
        totalSales: 0
      });
    }

    const branch = branchMap.get(key);
    branch.totalOrders += 1;
    branch.totalSales += Number(order.status === 'cancelled' ? 0 : order.finalTotal || order.totalAmount || 0);

    if (order.status === 'pending') branch.pendingOrders += 1;
    if (order.status === 'preparing') branch.preparingOrders += 1;
    if (order.status === 'completed') branch.completedOrders += 1;
    if (order.status === 'delivered') branch.deliveredOrders += 1;
    if (order.status === 'cancelled') branch.cancelledOrders += 1;
  }

  return {
    businessName: readSiteConfig().businessName || 'Flames Shawarma and Grill',
    overall: buildBranchStats(orders),
    branches: Array.from(branchMap.values()).sort((a, b) => a.branchName.localeCompare(b.branchName))
  };
}

async function extractReceiptText(filePath, mimeType = '') {
  const extension = path.extname(filePath).toLowerCase();

  if (mimeType === 'application/pdf' || extension === '.pdf') {
    const buffer = fs.readFileSync(filePath);
    const parsed = await pdfParse(buffer);
    return parsed.text || '';
  }

  const result = await Tesseract.recognize(filePath, 'eng', {
    logger: () => {}
  });

  return result?.data?.text || '';
}

function parseAmountToken(token) {
  if (!token) return null;

  let cleaned = token
    .replace(/[₦NnGg]/g, '')
    .replace(/[Oo]/g, '0')
    .replace(/[^\d,\.]/g, '')
    .trim();

  if (!cleaned) return null;

  if (/^\d+\.\d{3}$/.test(cleaned)) {
    cleaned = cleaned.replace('.', '');
  } else {
    cleaned = cleaned.replace(/,/g, '');
  }

  const value = Number(cleaned);

  if (!Number.isFinite(value)) return null;
  if (value < 50 || value > 10000000) return null;

  return Math.round(value);
}

function extractRoundedAmounts(text) {
  if (!text) return [];

  const tokens = [];
  const patterns = [
    /(?:₦|NGN|N)\s*([\dOo,\.]+)/gi,
    /\b([\dOo]{1,3}(?:[,\.][\dOo]{3})+(?:\.\d{1,2})?)\b/g,
    /\b(\d+(?:\.\d{1,2})?)\b/g
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = parseAmountToken(match[1]);
      if (value !== null) tokens.push(value);
    }
  }

  return Array.from(new Set(tokens)).sort((a, b) => a - b);
}

function validateReceiptAmount(receiptText, expectedAmount) {
  const expectedRounded = Math.round(Number(expectedAmount || 0));
  const amounts = extractRoundedAmounts(receiptText);
  const matchedAmount = amounts.find(amount => amount === expectedRounded) || null;

  return {
    isValid: Boolean(matchedAmount),
    expectedAmount: expectedRounded,
    matchedAmount,
    foundAmounts: amounts.slice(0, 20)
  };
}


app.get('/', (_, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.post('/api/orders', upload.single('receipt'), async (req, res) => {
  try {
    const {
      customerName,
      customerPhone,
      customerAccountName,
      branchId,
      branchName,
      branchWhatsApp,
      orderType,
      paymentMethod,
      deliveryAddress,
      deliveryArea,
      orderNote,
      cart,
      totalAmount,
      deliveryFee,
      subtotal,
      finalTotal
    } = req.body;

    let parsedCart = [];

    try {
      parsedCart = JSON.parse(cart || '[]');
    } catch {
      return res.status(400).json({ message: 'Invalid cart data.' });
    }

    if (!customerName || !customerPhone || !branchId || !branchName || !orderType || !paymentMethod) {
      return res.status(400).json({ message: 'Missing required customer details.' });
    }

    if (!parsedCart.length) {
      return res.status(400).json({ message: 'Cart is empty.' });
    }

    if (orderType === 'delivery' && !deliveryAddress) {
      return res.status(400).json({ message: 'Delivery address is required for delivery orders.' });
    }

    if (paymentMethod === 'bank_transfer' && !req.file) {
      return res.status(400).json({ message: 'Payment receipt is required for bank transfer.' });
    }

    if (paymentMethod === 'bank_transfer' && !customerAccountName?.trim()) {
      return res.status(400).json({ message: 'Please enter the account name used for the transfer.' });
    }

    const computedFinalTotal = Number(finalTotal || totalAmount || 0);
    const receiptUrl = req.file
      ? `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`
      : null;

    let receiptCheck = {
      status: paymentMethod === 'bank_transfer' ? 'pending_validation' : 'not_required',
      message: paymentMethod === 'bank_transfer' ? 'Receipt validation pending.' : 'Receipt not required.',
      expectedAmount: computedFinalTotal,
      matchedAmount: null,
      foundAmounts: []
    };

    if (paymentMethod === 'bank_transfer' && req.file) {
      let receiptText = '';

      try {
        receiptText = await extractReceiptText(req.file.path, req.file.mimetype);
      } catch (error) {
        console.error('Receipt read error:', error);
        return res.status(400).json({
          message: 'Receipt is invalid because the amount could not be read clearly. Please upload a clearer receipt that shows the paid amount.'
        });
      }

      const validation = validateReceiptAmount(receiptText, computedFinalTotal);

      if (!validation.isValid) {
        return res.status(400).json({
          message: `Receipt is invalid due to the incorrect amount. The receipt must clearly show ${formatNaira(computedFinalTotal)}.`
        });
      }

      receiptCheck = {
        status: 'validated',
        message: `Receipt validated successfully for ${formatNaira(computedFinalTotal)}.`,
        expectedAmount: validation.expectedAmount,
        matchedAmount: validation.matchedAmount,
        foundAmounts: validation.foundAmounts
      };
    }

    const orderRecord = {
      id: Date.now(),
      businessName: readSiteConfig().businessName || 'Flames Shawarma and Grill',
      customerName,
      customerPhone,
      customerAccountName: customerAccountName || '',
      branchId,
      branchName,
      branchWhatsApp: branchWhatsApp || '',
      orderType,
      paymentMethod,
      deliveryAddress: deliveryAddress || '',
      deliveryArea: deliveryArea || '',
      orderNote: orderNote || '',
      cart: parsedCart,
      totalAmount: Number(totalAmount || 0),
      deliveryFee: Number(deliveryFee || 0),
      subtotal: Number(subtotal || 0),
      finalTotal: computedFinalTotal,
      receiptUrl,
      receiptCheck,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    const orders = readOrders();
    orders.push(orderRecord);
    writeOrders(orders);

    return res.json({
      message: `Order received successfully and sent to ${branchName} dashboard.`,
      order: orderRecord
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error while processing order.' });
  }
});

app.get('/api/site-config', (_, res) => {
  try {
    res.json(readSiteConfig());
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not fetch site config.' });
  }
});

app.post('/api/admin/upload-image', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image uploaded.' });
    }
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ imageUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not upload image.' });
  }
});

app.put('/api/admin/site-config/general', (req, res) => {
  try {
    const config = readSiteConfig();
    const allowed = ['businessName', 'tagline', 'heroTitle', 'heroSubtitle', 'businessPhone', 'businessAddress', 'openingHours', 'logoUrl', 'heroImage', 'heroBackgroundImage'];
    for (const key of allowed) {
      if (key in req.body) config[key] = req.body[key];
    }
    writeSiteConfig(config);
    res.json({ message: 'General website settings updated.', config });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not update general website settings.' });
  }
});

app.post('/api/admin/menu-items', (req, res) => {
  try {
    const config = readSiteConfig();
    const { name, category, price, image, description, popular } = req.body;
    if (!name || !category) return res.status(400).json({ message: 'Name and category are required.' });
    const item = { id: Date.now(), name, category, price: Number(price || 0), image: image || '', description: description || '', popular: Boolean(popular) };
    config.menuItems = config.menuItems || [];
    config.menuItems.push(item);
    writeSiteConfig(config);
    res.json({ message: 'Menu item added.', item, config });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not add menu item.' });
  }
});

app.patch('/api/admin/menu-items/:itemId', (req, res) => {
  try {
    const config = readSiteConfig();
    const idx = (config.menuItems || []).findIndex(item => String(item.id) === String(req.params.itemId));
    if (idx === -1) return res.status(404).json({ message: 'Menu item not found.' });
    const current = config.menuItems[idx];
    config.menuItems[idx] = { ...current, ...req.body, price: Number(req.body.price ?? current.price ?? 0), popular: req.body.popular ?? current.popular };
    writeSiteConfig(config);
    res.json({ message: 'Menu item updated.', item: config.menuItems[idx], config });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not update menu item.' });
  }
});

app.delete('/api/admin/menu-items/:itemId', (req, res) => {
  try {
    const config = readSiteConfig();
    const before = (config.menuItems || []).length;
    config.menuItems = (config.menuItems || []).filter(item => String(item.id) !== String(req.params.itemId));
    if (config.menuItems.length === before) return res.status(404).json({ message: 'Menu item not found.' });
    writeSiteConfig(config);
    res.json({ message: 'Menu item removed.', config });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not remove menu item.' });
  }
});

app.post('/api/admin/branches/:branchId/delivery-zones', (req, res) => {
  try {
    const config = readSiteConfig();
    const branch = (config.branches || []).find(b => String(b.id) === String(req.params.branchId));
    if (!branch) return res.status(404).json({ message: 'Branch not found.' });
    const { area, fee } = req.body;
    if (!area) return res.status(400).json({ message: 'Area name is required.' });
    branch.deliveryZones = branch.deliveryZones || [];
    branch.deliveryZones.push({ area, fee: Number(fee || 0) });
    writeSiteConfig(config);
    res.json({ message: 'Delivery area added.', config });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not add delivery area.' });
  }
});

app.patch('/api/admin/branches/:branchId/delivery-zones/:zoneIndex', (req, res) => {
  try {
    const config = readSiteConfig();
    const branch = (config.branches || []).find(b => String(b.id) === String(req.params.branchId));
    if (!branch) return res.status(404).json({ message: 'Branch not found.' });
    const index = Number(req.params.zoneIndex);
    if (!branch.deliveryZones || !branch.deliveryZones[index]) return res.status(404).json({ message: 'Delivery area not found.' });
    branch.deliveryZones[index] = { area: req.body.area ?? branch.deliveryZones[index].area, fee: Number(req.body.fee ?? branch.deliveryZones[index].fee ?? 0) };
    writeSiteConfig(config);
    res.json({ message: 'Delivery area updated.', config });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not update delivery area.' });
  }
});

app.delete('/api/admin/branches/:branchId/delivery-zones/:zoneIndex', (req, res) => {
  try {
    const config = readSiteConfig();
    const branch = (config.branches || []).find(b => String(b.id) === String(req.params.branchId));
    if (!branch) return res.status(404).json({ message: 'Branch not found.' });
    const index = Number(req.params.zoneIndex);
    if (!branch.deliveryZones || !branch.deliveryZones[index]) return res.status(404).json({ message: 'Delivery area not found.' });
    branch.deliveryZones.splice(index, 1);
    writeSiteConfig(config);
    res.json({ message: 'Delivery area removed.', config });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not remove delivery area.' });
  }
});

app.get('/api/admin/orders', (_, res) => {
  try {
    const orders = readOrders().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not fetch orders.' });
  }
});

app.get('/api/admin/summary', (_, res) => {
  try {
    const orders = readOrders();
    res.json(buildOverallSummary(orders));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not fetch summary.' });
  }
});

app.get('/api/branch/:branchId/orders', (req, res) => {
  try {
    const { branchId } = req.params;
    const orders = readOrders()
      .filter(order => String(order.branchId) === String(branchId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not fetch branch orders.' });
  }
});

app.get('/api/branch/:branchId/summary', (req, res) => {
  try {
    const { branchId } = req.params;
    const orders = readOrders().filter(order => String(order.branchId) === String(branchId));
    const branchName = orders[0]?.branchName || branchId;

    res.json({
      branchId,
      branchName,
      ...buildBranchStats(orders)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not fetch branch summary.' });
  }
});

app.patch('/api/orders/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Invalid status.' });
    }

    const orders = readOrders();
    const orderIndex = orders.findIndex(order => String(order.id) === String(id));

    if (orderIndex === -1) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    orders[orderIndex] = {
      ...orders[orderIndex],
      status,
      updatedAt: new Date().toISOString()
    };

    writeOrders(orders);

    res.json({
      message: 'Order status updated successfully.',
      order: orders[orderIndex]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not update order status.' });
  }
});

app.get('/api/health', (_, res) => {
  res.json({
    ok: true,
    businessName: readSiteConfig().businessName || 'Flames Shawarma and Grill',
    totalOrders: readOrders().length,
    time: new Date().toISOString(),
    currencyExample: formatNaira(1500)
  });
});

app.use('/api', (req, res) => {
  res.status(404).json({
    message: `API route not found: ${req.method} ${req.originalUrl}. Open the app through http://localhost:${PORT} and make sure the backend is running from the backend folder.`
  });
});

const frontendPageMap = {
  '/': 'index.html',
  '/index': 'index.html',
  '/index.html': 'index.html',
  '/admin': 'admin.html',
  '/admin.html': 'admin.html',
  '/branch-awoyaya': 'branch-awoyaya.html',
  '/branch-awoyaya.html': 'branch-awoyaya.html',
  '/branch-ajah': 'branch-ajah.html',
  '/branch-ajah.html': 'branch-ajah.html',
  '/frontend/': 'index.html',
  '/frontend/index.html': 'index.html',
  '/frontend/admin.html': 'admin.html',
  '/frontend/branch-awoyaya.html': 'branch-awoyaya.html',
  '/frontend/branch-ajah.html': 'branch-ajah.html'
};

for (const [routePath, fileName] of Object.entries(frontendPageMap)) {
  app.get(routePath, (_, res) => {
    res.sendFile(path.join(frontendDir, fileName));
  });
}

app.use((req, res, next) => {
  if (!req.path.endsWith('.html')) return next();
  const filename = path.basename(req.path);
  const candidate = path.join(frontendDir, filename);
  if (fs.existsSync(candidate)) {
    return res.sendFile(candidate);
  }
  return res.status(404).send(`Page not found: ${req.path}. Try /, /admin.html, /branch-awoyaya.html, or /branch-ajah.html`);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Customer site: http://localhost:${PORT}/`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin.html`);
});
