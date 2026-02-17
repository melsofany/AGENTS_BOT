// الحصول على بيانات مستخدم تيليجرام
const tg = window.Telegram.WebApp;
tg.expand(); // توسيع التطبيق لملء الشاشة

// متغيرات عامة
let currentUser = null;
let baseUrl = ''; // سيتم ضبطها تلقائياً

// تحديد الصفحة الحالية
if (window.location.pathname.includes('item.html')) {
    // صفحة تفاصيل البند
    const urlParams = new URLSearchParams(window.location.search);
    const rfq = urlParams.get('rfq');
    const lineItem = urlParams.get('lineItem');
    if (rfq && lineItem) {
        loadItemDetails(rfq, lineItem);
    } else {
        window.location.href = '/';
    }
} else {
    // الصفحة الرئيسية
    checkLogin();
}

// دوال الصفحة الرئيسية
function checkLogin() {
    const savedUser = localStorage.getItem('tg_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showItemsScreen();
        loadItems();
    } else {
        document.getElementById('login-screen').style.display = 'block';
    }
}

async function login() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    const errorDiv = document.getElementById('login-error');

    if (!username || !password) {
        errorDiv.textContent = 'الرجاء إدخال اسم المستخدم وكلمة المرور';
        return;
    }

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                password,
                telegramId: tg.initDataUnsafe?.user?.id?.toString() || 'test',
            }),
        });

        const data = await response.json();
        if (data.success) {
            currentUser = data.user;
            localStorage.setItem('tg_user', JSON.stringify(currentUser));
            showItemsScreen();
            loadItems();
        } else {
            errorDiv.textContent = data.message;
        }
    } catch (err) {
        errorDiv.textContent = 'فشل الاتصال بالخادم';
    }
}

function showItemsScreen() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('items-screen').style.display = 'block';
}

async function loadItems() {
    const itemsDiv = document.getElementById('items-list');
    itemsDiv.innerHTML = '<p>جاري التحميل...</p>';

    try {
        const response = await fetch(`/api/items?employeeId=${currentUser.employee_id}`);
        const data = await response.json();
        if (data.success) {
            if (data.items.length === 0) {
                itemsDiv.innerHTML = '<p>لا توجد بنود مخصصة لك.</p>';
                return;
            }
            itemsDiv.innerHTML = '';
            data.items.forEach(item => {
                const card = document.createElement('div');
                card.className = 'item-card';
                card.innerHTML = `
                    <h4>${item.rfq} - ${item.line_item}</h4>
                    <p>📄 ${item.description || 'لا يوجد وصف'}</p>
                    <p>🔢 الكمية: ${item.qty || 0}</p>
                    <p>💰 السعر المرجعي: ${item.price || 'غير محدد'}</p>
                    <button onclick="viewItem('${item.rfq}', '${item.line_item}')">🔍 عرض التفاصيل</button>
                `;
                itemsDiv.appendChild(card);
            });
        } else {
            itemsDiv.innerHTML = `<p class="error">${data.message}</p>`;
        }
    } catch (err) {
        itemsDiv.innerHTML = '<p class="error">فشل التحميل</p>';
    }
}

function viewItem(rfq, lineItem) {
    window.location.href = `/item.html?rfq=${rfq}&lineItem=${lineItem}`;
}

function logout() {
    localStorage.removeItem('tg_user');
    window.location.href = '/';
}

// دوال صفحة تفاصيل البند
async function loadItemDetails(rfq, lineItem) {
    const detailDiv = document.getElementById('item-detail');
    const imageDiv = document.getElementById('item-image');
    detailDiv.innerHTML = '<p>جاري التحميل...</p>';

    try {
        const response = await fetch(`/api/item-details?rfq=${rfq}&lineItem=${lineItem}`);
        const data = await response.json();
        if (data.success) {
            const item = data.item;
            detailDiv.innerHTML = `
                <p><strong>RFQ:</strong> ${item.rfq}</p>
                <p><strong>البند:</strong> ${item.line_item}</p>
                <p><strong>الوصف:</strong> ${item.description || 'لا يوجد'}</p>
                <p><strong>الكمية:</strong> ${item.qty || 0}</p>
                <p><strong>السعر المرجعي:</strong> ${item.price || 'غير متوفر'}</p>
                <p><strong>تاريخ الطلب:</strong> ${item.date_rq || 'غير محدد'}</p>
                <p><strong>تاريخ التسليم:</strong> ${item.res_date || 'غير محدد'}</p>
            `;
            if (data.imageUrl) {
                imageDiv.innerHTML = `<img src="${data.imageUrl}" alt="صورة البند">`;
            }
        } else {
            detailDiv.innerHTML = `<p class="error">${data.message}</p>`;
        }
    } catch (err) {
        detailDiv.innerHTML = '<p class="error">فشل تحميل التفاصيل</p>';
    }
}

// إضافة عرض سعر
document.getElementById('quote-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const urlParams = new URLSearchParams(window.location.search);
    const rfq = urlParams.get('rfq');
    const lineItem = urlParams.get('lineItem');
    const employeeId = currentUser?.employee_id || JSON.parse(localStorage.getItem('tg_user')).employee_id;

    const formData = {
        employeeId,
        rfq,
        lineItem,
        supplierName: document.getElementById('supplier').value,
        price: document.getElementById('price').value,
        taxIncluded: document.getElementById('taxIncluded').checked,
        originalOrCopy: document.getElementById('originalOrCopy').value,
        deliveryDays: document.getElementById('deliveryDays').value,
        startDate: document.getElementById('startDate').value,
        endDate: document.getElementById('endDate').value,
    };

    const msgDiv = document.getElementById('form-message');

    try {
        const response = await fetch('/api/add-quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData),
        });

        const data = await response.json();
        if (data.success) {
            msgDiv.className = 'success';
            msgDiv.textContent = '✅ تم حفظ العرض بنجاح';
            document.getElementById('quote-form').reset();
        } else {
            msgDiv.className = 'error';
            msgDiv.textContent = data.message;
        }
    } catch (err) {
        msgDiv.className = 'error';
        msgDiv.textContent = 'فشل الاتصال بالخادم';
    }
});

function goBack() {
    window.location.href = '/';
}