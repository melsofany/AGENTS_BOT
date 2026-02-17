// ==================== استيراد المكتبات ====================
const express = require('express');
const path = require('path');
const { Telegraf, Markup } = require('telegraf');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const axios = require('axios');
require('dotenv').config();

// ==================== إعداد المتغيرات ====================
const BOT_TOKEN = process.env.BOT_TOKEN;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const PORT = process.env.PORT || 5000;
const GOOGLE_SERVICE_ACCOUNT_BASE64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;

// التحقق من وجود المتغيرات الأساسية
if (!GOOGLE_SHEET_ID) {
  console.error('❌ خطأ: GOOGLE_SHEET_ID غير موجود في Secrets');
}

// تحميل ملف اعتماد Google Sheets
let CREDENTIALS = null;

// 1. محاولة التحميل من Base64 (الأولوية القصوى بناءً على طلب المستخدم)
if (GOOGLE_SERVICE_ACCOUNT_BASE64) {
  try {
    const decoded = Buffer.from(GOOGLE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
    CREDENTIALS = JSON.parse(decoded);
    console.log('✅ تم تحميل اعتمادات Google من المتغير البيئي Base64');
  } catch (e) {
    console.error('❌ خطأ في فك تشفير GOOGLE_SERVICE_ACCOUNT_BASE64:', e.message);
  }
}

// 2. محاولة التحميل من المتغيرات المنفصلة (إذا لم يتوفر Base64)
if (!CREDENTIALS) {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (email && privateKey) {
    try {
      let cleanedKey = privateKey
        .replace(/\\n/g, '\n')
        .replace(/\n/g, '\n')
        .replace(/"/g, '')
        .trim();

      if (!cleanedKey.includes('\n') && cleanedKey.length > 100) {
        const header = '-----BEGIN PRIVATE KEY-----';
        const footer = '-----END PRIVATE KEY-----';
        let body = cleanedKey.replace(header, '').replace(footer, '').replace(/\s/g, '');
        const lines = [];
        for (let i = 0; i < body.length; i += 64) {
          lines.push(body.substring(i, i + 64));
        }
        cleanedKey = `${header}\n${lines.join('\n')}\n${footer}`;
      } else {
        if (!cleanedKey.includes('-----BEGIN PRIVATE KEY-----')) {
          cleanedKey = `-----BEGIN PRIVATE KEY-----\n${cleanedKey}`;
        }
        if (!cleanedKey.includes('-----END PRIVATE KEY-----')) {
          cleanedKey = `${cleanedKey}\n-----END PRIVATE KEY-----`;
        }
      }

      CREDENTIALS = { client_email: email, private_key: cleanedKey };
      console.log('✅ تم تحميل اعتمادات Google من متغيرات البيئة المنفصلة');
    } catch (err) {
      console.error('❌ خطأ في معالجة المفتاح الخاص:', err.message);
    }
  }
}

// 3. محاولة التحميل من ملف credentials.json (كخيار أخير)
if (!CREDENTIALS) {
  try {
    CREDENTIALS = require('./credentials.json');
    console.log('✅ تم تحميل اعتمادات Google من ملف credentials.json');
  } catch (e) {
    console.warn('⚠️ لم يتم العثور على اعتمادات Google Sheets. يرجى إضافتها إلى Secrets.');
    CREDENTIALS = { client_email: 'test@test.com', private_key: 'test' };
  }
}

// أسماء الأوراق في الجدول
const SHEET_NAMES = {
  USERS: 'BOT_USERS',
  ITEMS: 'items',
  QUOTATIONS: 'QUOTATIONS',
};

// ==================== دوال مساعدة للتعامل مع Google Sheets ====================
async function getSheet(sheetTitle) {
  if (!GOOGLE_SHEET_ID) {
    throw new Error('❌ GOOGLE_SHEET_ID غير موجود في متغيرات البيئة (Secrets)');
  }
  if (!CREDENTIALS || !CREDENTIALS.client_email || CREDENTIALS.client_email === 'test@test.com') {
    throw new Error('❌ اعتمادات Google Sheets غير صالحة أو غير متوفرة');
  }
  const serviceAccountAuth = new JWT({
    email: CREDENTIALS.client_email,
    key: CREDENTIALS.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[sheetTitle];
  if (!sheet) throw new Error(`❌ الورقة "${sheetTitle}" غير موجودة`);
  return sheet;
}

// قراءة جميع الصفوف وتحويلها إلى كائنات (مع إضافة رقم الصف)
async function getRows(sheetTitle) {
  try {
    const sheet = await getSheet(sheetTitle);
    const rows = await sheet.getRows();
    return rows.map(row => {
      const data = row.toObject();
      // تأكد من أن جميع المفاتيح موجودة لتجنب أخطاء undefined لاحقاً
      return { ...data, _rowIndex: row.rowNumber - 2 }; // تصحيح rowIndex ليتوافق مع مصفوفة getRows()
    });
  } catch (err) {
    console.error(`Error fetching rows for ${sheetTitle}:`, err.message);
    return [];
  }
}

// إضافة صف جديد
async function addRow(sheetTitle, data) {
  const sheet = await getSheet(sheetTitle);
  return await sheet.addRow(data);
}

// تحديث صف موجود
async function updateRow(sheetTitle, rowIndex, data) {
  const sheet = await getSheet(sheetTitle);
  const rows = await sheet.getRows();
  // البحث عن الصف باستخدام rowIndex المخزن
  const row = rows.find(r => (r.rowNumber - 2) === rowIndex);
  if (!row) throw new Error(`الصف في الفهرس ${rowIndex} غير موجود`);
  Object.assign(row, data);
  await row.save();
}

// ==================== دوال DeepSeek API (توليد الصور) ====================
async function fetchItemImage(description) {
  if (!DEEPSEEK_API_KEY) {
    console.warn('⚠️ DeepSeek API key not configured');
    return null;
  }

  try {
    const response = await axios.post(
      'https://api.deepseek.com/v1/images/generations',
      {
        prompt: `صورة واقعية عالية الجودة لـ: ${description}`,
        n: 1,
        size: '512x512',
      },
      {
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    return response.data.data[0]?.url || null;
  } catch (error) {
    console.error('⚠️ DeepSeek API error:', error.message);
    return null;
  }
}

// ==================== دوال مساعدة عامة ====================
function generateQuoteId() {
  return `Q-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function isValidDate(dateStr) {
  const regex = /^\d{4}-\d{2}-\d{2}$/; // تنسيق YYYY-MM-DD
  return regex.test(dateStr);
}

// ==================== إعداد خادم Express ====================
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ==================== نقاط نهاية API (للتطبيق المصغر) ====================

/**
 * POST /api/login
 * يتلقى { username, password, telegramId }
 * يتحقق من بيانات المستخدم في Google Sheets
 */
app.post('/api/login', async (req, res) => {
  try {
    const { username, password, telegramId } = req.body;
    console.log(`Attempting login for username: ${username}`);
    
    const users = await getRows(SHEET_NAMES.USERS);
    console.log(`Fetched ${users.length} users from sheet.`);
    if (users.length > 0) {
      console.log('Sample User Data (First User Keys):', Object.keys(users[0]));
      console.log('Sample User Data (First User Values):', JSON.stringify(users[0]));
    }
    
    const user = users.find(u => {
      // استخراج القيم مع مراعاة مسميات الأعمدة الفعلية (USERNAME, PASSWORD_HASH, STATUS, EMPLOYEE_ID)
      const uName = String(u.USERNAME || u.username || u.Username || u['اسم المستخدم'] || '').trim();
      const uPass = String(u.PASSWORD_HASH || u.PASSWORD || u.password || u.Password || u['كلمة المرور'] || '').trim();
      const uStatus = String(u.STATUS || u.status || u.Status || u['الحالة'] || u['النشاط'] || '').trim().toLowerCase();
      
      const inputUsername = String(username).trim();
      const inputPassword = String(password).trim();

      const isNameMatch = uName === inputUsername;
      const isPassMatch = uPass === inputPassword;
      const isStatusActive = (uStatus === 'yes' || uStatus === 'نعم' || uStatus === 'true' || uStatus === 'undefined' || uStatus === '');

      if (isNameMatch) {
        console.log(`Checking user ${uName}: PassMatch: ${isPassMatch}, StatusActive: ${isStatusActive} (Value: "${uStatus}")`);
      }
      
      return isNameMatch && isPassMatch && isStatusActive;
    });

    if (!user) {
      console.log(`Login failed for ${username}: User not found or inactive.`);
      return res.status(401).json({ success: false, message: 'بيانات الدخول غير صحيحة أو الحساب غير مفعل' });
    }
    
    console.log(`User ${username} authenticated successfully.`);

    // تحديث telegram_id
    await updateRow(SHEET_NAMES.USERS, user._rowIndex, { telegram_id: telegramId });

    res.json({
      success: true,
      user: {
        employee_id: user.EMPLOYEE_ID || user.employee_id,
        full_name: user.FULL_NAME || user.full_name,
        role: user.ROLE || user.role || 'user',
      },
    });
  } catch (error) {
    console.error('❌ Login Error:', error);
    res.status(500).json({ success: false, message: `خطأ في الاتصال بالقاعدة: ${error.message}` });
  }
});

/**
 * GET /api/items?employeeId=xxx
 * يعيد قائمة البنود الخاصة بمندوب معين
 */
app.get('/api/items', async (req, res) => {
  try {
    const { employeeId } = req.query;
    if (!employeeId) return res.status(400).json({ success: false, message: 'employeeId مطلوب' });

    const items = await getRows(SHEET_NAMES.ITEMS);
    
    // دالة مساعدة لجلب القيمة بغض النظر عن حالة الأحرف
    const getVal = (obj, keyName) => {
      const foundKey = Object.keys(obj).find(k => k.toUpperCase().trim() === keyName.toUpperCase());
      return foundKey ? obj[foundKey] : '';
    };

    // البحث عن معرف المندوب في أي عمود يبدأ بـ EMPLOYEE_ID أو يحتوي على "مندوب"
    const myItems = items.filter(item => {
      return Object.keys(item).some(key => {
        const normalizedKey = key.toUpperCase().trim();
        return (normalizedKey.startsWith('EMPLOYEE_ID') || normalizedKey.includes('مندوب')) && 
               String(item[key]).trim() === String(employeeId).trim();
      });
    }).map(item => ({
      // توحيد المسميات للواجهة الأمامية
      rfq: getVal(item, 'RFQ'),
      line_item: getVal(item, 'LINE_ITEM'),
      description: getVal(item, 'DESCRIPTION'),
      qty: getVal(item, 'QTY'),
      price: getVal(item, 'PRICE')
    }));

    res.json({ success: true, items: myItems });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'خطأ في جلب البنود' });
  }
});

/**
 * GET /api/item-details?rfq=...&lineItem=...
 * يعيد تفاصيل بند معين مع صورة من DeepSeek
 */
app.get('/api/item-details', async (req, res) => {
  try {
    const { rfq, lineItem } = req.query;
    const items = await getRows(SHEET_NAMES.ITEMS);
    const item = items.find(i => {
      const iRFQ = String(i.RFQ || i.rfq || i['RFQ'] || '').trim();
      const iLine = String(i.LINE_ITEM || i.line_item || i['LINE_ITEM'] || '').trim();
      return iRFQ === String(rfq).trim() && iLine === String(lineItem).trim();
    });
    
    if (!item) return res.status(404).json({ success: false, message: 'البند غير موجود' });

    // جلب صورة من DeepSeek
    const desc = item.DESCRIPTION || item.description || item.LINE_ITEM || item.line_item || 'item';
    const imageUrl = await fetchItemImage(desc);

    // دالة مساعدة لجلب القيمة بغض النظر عن حالة الأحرف
    const getVal = (obj, keyName) => {
      const foundKey = Object.keys(obj).find(k => k.toUpperCase().trim() === keyName.toUpperCase());
      return foundKey ? obj[foundKey] : '';
    };

    res.json({
      success: true,
      item: {
        rfq: getVal(item, 'RFQ'),
        line_item: getVal(item, 'LINE_ITEM'),
        uom: getVal(item, 'UOM'),
        part_no: getVal(item, 'PART_NO'),
        description: getVal(item, 'DESCRIPTION'),
        date_rq: getVal(item, 'DATE_RQ') || getVal(item, 'DATE/RFQ'),
        res_date: getVal(item, 'RES_DATE') || getVal(item, 'RES. DATE'),
        qty: getVal(item, 'QTY'),
        price: getVal(item, 'PRICE'),
      },
      imageUrl,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'خطأ في جلب التفاصيل' });
  }
});

/**
 * POST /api/add-quote
 * يضيف عرض سعر جديد في جدول QUOTATIONS
 */
app.post('/api/add-quote', async (req, res) => {
  try {
    const {
      employeeId,
      rfq,
      lineItem,
      supplierName,
      price,
      taxIncluded,
      originalOrCopy,
      deliveryDays,
      startDate,
      endDate,
    } = req.body;

    // التحقق من صحة البيانات
    if (!employeeId || !rfq || !lineItem || !supplierName || !price || taxIncluded === undefined || !originalOrCopy || !deliveryDays || !startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'جميع الحقول مطلوب' });
    }

    // التحقق من تاريخ البدء: START_DATE - 1 >= اليوم
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(startDate);
    const oneDayBeforeStart = new Date(start);
    oneDayBeforeStart.setDate(start.getDate() - 1);

    if (oneDayBeforeStart < today) {
      return res.status(400).json({ success: false, message: 'يجب أن يكون تاريخ البدء بعد غد على الأقل' });
    }

    const quoteId = generateQuoteId();

    await addRow(SHEET_NAMES.QUOTATIONS, {
      QUOTE_ID: quoteId,
      RFQ: rfq,
      LINE_ITEM: lineItem,
      EMPLOYEE_ID: employeeId,
      SUPPLIER_NAME: supplierName,
      PRICE: parseFloat(price),
      TAX_INCLUDED: taxIncluded ? 'نعم' : 'لا',
      ORIGINAL_OR_COPY: originalOrCopy,
      DELIVERY_DAYS: parseInt(deliveryDays),
      START_DATE: startDate,
      END_DATE: endDate,
    });

    res.json({ success: true, message: 'تم إضافة عرض السعر بنجاح', quoteId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'خطأ في حفظ العرض' });
  }
});

// ==================== إعداد بوت تيليجرام ====================
if (BOT_TOKEN) {
  const bot = new Telegraf(BOT_TOKEN);

  // أمر /start – يرسل زراً لفتح التطبيق المصغر
  bot.start((ctx) => {
    let webAppUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    if (!webAppUrl.startsWith('http')) {
      webAppUrl = `https://${webAppUrl}`;
    }
    if (webAppUrl.endsWith('/')) {
      webAppUrl = webAppUrl.slice(0, -1);
    }

    ctx.reply(
      '👋 مرحباً بك في نظام المندوبين!\nاضغط على الزر أدناه لفتح التطبيق.',
      Markup.inlineKeyboard([
        Markup.button.webApp('🚀 فتح التطبيق', webAppUrl),
      ])
    );
  });

  // أمر /login (احتياطي للدخول السريع)
  bot.command('login', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 3) {
      return ctx.reply('❌ استخدم: /login username password');
    }
    const username = args[1];
    const password = args[2];
    const telegramId = ctx.from.id.toString();

    try {
      const users = await getRows(SHEET_NAMES.USERS);
      const user = users.find(u => u.username === username && u.status?.toLowerCase() === 'yes');

      if (!user || user.password !== password) {
        return ctx.reply('❌ اسم مستخدم أو كلمة مرور غير صحيحة');
      }

      await updateRow(SHEET_NAMES.USERS, user._rowIndex, { telegram_id: telegramId });

      ctx.reply(`✅ مرحباً ${user.full_name}!\nيمكنك الآن فتح التطبيق من القائمة.`);
    } catch (err) {
      console.error(err);
      ctx.reply('⚠️ حدث خطأ');
    }
  });

  bot.launch().then(() => {
    console.log('🤖 البوت يعمل...');
    console.log(`📱 رابط التطبيق: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}`);
  }).catch(err => {
    console.error('❌ فشل تشغيل البوت:', err.message);
  });

  // إيقاف البوت عند إنهاء التطبيق
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
} else {
  console.warn('⚠️ BOT_TOKEN غير موجود، سيتم تشغيل خادم الويب فقط.');
}

// ==================== تشغيل الخادم ====================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 خادم الويب يعمل على المنفذ ${PORT}`);
});
