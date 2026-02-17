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
const PORT = process.env.PORT || 3000;

// تحميل ملف اعتماد Google Sheets
let CREDENTIALS;
try {
  CREDENTIALS = require('./credentials.json');
} catch (e) {
  console.error('❌ لم يتم العثور على ملف credentials.json. يرجى وضعه في المجلد الرئيسي.');
  process.exit(1);
}

// أسماء الأوراق في الجدول
const SHEET_NAMES = {
  USERS: 'BOT_USERS',
  ITEMS: 'items',
  QUOTATIONS: 'QUOTATIONS',
};

// ==================== دوال مساعدة للتعامل مع Google Sheets ====================
async function getSheet(sheetTitle) {
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
  const sheet = await getSheet(sheetTitle);
  const rows = await sheet.getRows();
  return rows.map(row => ({ ...row.toObject(), _rowIndex: row.rowNumber - 1 }));
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
  const row = rows[rowIndex];
  if (!row) throw new Error('الصف غير موجود');
  Object.assign(row, data);
  await row.save();
}

// ==================== دوال DeepSeek API (توليد الصور) ====================
async function fetchItemImage(description) {
  try {
    // هذه واجهة افتراضية – راجع توثيق DeepSeek الفعلي
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
      }
    );
    return response.data.data[0].url; // عدل حسب استجابة API الفعلية
  } catch (error) {
    console.error('❌ DeepSeek API error:', error.message);
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
app.use(express.static(path.join(__dirname, 'public'))); // خدمة الملفات الثابتة

// ==================== نقاط نهاية API (للتطبيق المصغر) ====================

/**
 * POST /api/login
 * يتلقى { username, password, telegramId }
 * يتحقق من بيانات المستخدم في Google Sheets
 */
app.post('/api/login', async (req, res) => {
  try {
    const { username, password, telegramId } = req.body;
    const users = await getRows(SHEET_NAMES.USERS);
    const user = users.find(u => u.username === username && u.status?.toLowerCase() === 'yes');

    if (!user || user.password_hash !== password) {
      return res.status(401).json({ success: false, message: 'بيانات الدخول غير صحيحة' });
    }

    // تحديث telegram_id
    await updateRow(SHEET_NAMES.USERS, user._rowIndex, { telegram_id: telegramId });

    res.json({
      success: true,
      user: {
        employee_id: user.employee_id,
        full_name: user.full_name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'خطأ داخلي في الخادم' });
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
    const myItems = items.filter(item => item.employee_id === employeeId);
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
    const item = items.find(i => i.rfq === rfq && i.line_item === lineItem);
    if (!item) return res.status(404).json({ success: false, message: 'البند غير موجود' });

    // جلب صورة من DeepSeek
    const imageUrl = await fetchItemImage(item.description || item.line_item);

    res.json({
      success: true,
      item: {
        rfq: item.rfq,
        line_item: item.line_item,
        uom: item.uom,
        part_no: item.part_no,
        description: item.description,
        date_rq: item.date_rq,
        res_date: item.res_date,
        qty: item.qty,
        price: item.price,
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
      return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
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
      quote_id: quoteId,
      rfq,
      line_item: lineItem,
      employee_id: employeeId,
      supplier_name: supplierName,
      price: parseFloat(price),
      tax_included: taxIncluded ? 'نعم' : 'لا',
      original_or_copy: originalOrCopy,
      delivery_days: parseInt(deliveryDays),
      start_date: startDate,
      end_date: endDate,
    });

    res.json({ success: true, message: 'تم إضافة عرض السعر بنجاح', quoteId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'خطأ في حفظ العرض' });
  }
});

// ==================== إعداد بوت تيليجرام ====================
const bot = new Telegraf(BOT_TOKEN);

// أمر /start – يرسل زراً لفتح التطبيق المصغر
bot.start((ctx) => {
  // استخدام RENDER_EXTERNAL_URL إذا كان موجوداً (يحتوي على https://) وإلا استخدم localhost
  const webAppUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  // تأكد من أن الرابط لا يحتوي على بروتوكول مكرر
  const finalUrl = webAppUrl.startsWith('http') ? webAppUrl : `https://${webAppUrl}`;
  
  ctx.reply(
    '👋 مرحباً بك في نظام المندوبين!\nاضغط على الزر أدناه لفتح التطبيق.',
    Markup.inlineKeyboard([
      Markup.button.webApp('🚀 فتح التطبيق', finalUrl),
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

    if (!user || user.password_hash !== password) {
      return ctx.reply('❌ اسم مستخدم أو كلمة مرور غير صحيحة');
    }

    await updateRow(SHEET_NAMES.USERS, user._rowIndex, { telegram_id: telegramId });

    ctx.reply(`✅ مرحباً ${user.full_name}!\nيمكنك الآن فتح التطبيق من القائمة.`);
  } catch (err) {
    console.error(err);
    ctx.reply('⚠️ حدث خطأ');
  }
});

bot.launch().then(() => console.log('🤖 البوت يعمل...'));

// ==================== تشغيل الخادم ====================
app.listen(PORT, () => {
  console.log(`🌐 خادم الويب يعمل على المنفذ ${PORT}`);
});

// إيقاف البوت عند إنهاء التطبيق
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
