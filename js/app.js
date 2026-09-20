import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, deleteDoc, doc, query, where, onSnapshot, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// Firebase Console > Project settings > Your apps alanından doldurun.
const firebaseConfig = { apiKey: 'AIzaSyC7yEPjVSwKXim4J5Zvh2YRiYd1Cs-WkdU', authDomain: 'dashboard-2a01a.firebaseapp.com', projectId: 'dashboard-2a01a', storageBucket: 'dashboard-2a01a.firebasestorage.app', messagingSenderId: '155398059475', appId: '1:155398059475:web:5f0c9179217bc79b9fab26' };
const demoMode = firebaseConfig.apiKey === 'YOUR_API_KEY' || firebaseConfig.projectId === 'YOUR_PROJECT_ID';
let auth, db, currentUser = { uid: 'demo-user', displayName: "Jason's Store", email: 'Demo workspace', photoURL: '' };
let transactions = demoMode ? [
  { id:'1', type:'income', paymentMethod:'card', amount:12540, category:'Satış', date:new Date('2025-06-18T10:00:00'), description:'Gün içi kartlı satışlar' },
  { id:'2', type:'income', paymentMethod:'cash', amount:8640, category:'Satış', date:new Date('2025-06-18T09:00:00'), description:'Sabah satışları' },
  { id:'3', type:'expense', paymentMethod:'cash', amount:4280, category:'Mal alımı', date:new Date('2025-06-17T14:00:00'), description:'Haftalık ürün tedariki' },
  { id:'4', type:'expense', paymentMethod:'cash', amount:1850, category:'Fatura', date:new Date('2025-06-16T12:00:00'), description:'Elektrik faturası' },
  { id:'5', type:'income', paymentMethod:'card', amount:9320, category:'Satış', date:new Date('2025-06-15T16:00:00'), description:'Hafta sonu satışları' }
] : [];
let salesChart, expenseChart, chartDays = 7, chartRange = '7', expensePeriod = 'monthly', filterStart = null, filterEnd = null, dateMode = 'month', editingTransactionId = null, summaryPeriod = 'daily';
const $ = (selector) => document.querySelector(selector);
const money = (value) => { const formatted = new Intl.NumberFormat('tr-TR', { style:'currency', currency:'TRY', maximumFractionDigits:2 }).format(value); return formatted.startsWith('-₺') ? formatted.replace('-₺', '₺-') : formatted; };
const shortMoney = (value) => new Intl.NumberFormat('tr-TR', { style:'currency', currency:'TRY', maximumFractionDigits:0 }).format(value);
const numberAnimationFrames = new WeakMap();
function animateNumbers(root = document) { root.querySelectorAll('.kpi-card h2,.summary-card strong,.analysis-kpi strong,.analysis-stat-row b,.category-analysis-item b,.balance-item b').forEach((element) => { const original = element.textContent.trim(); const match = original.match(/-?[\d.,]+/); if (!match || element.dataset.numberAnimated === original) return; if (numberAnimationFrames.has(element)) cancelAnimationFrame(numberAnimationFrames.get(element)); const raw = match[0]; const target = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '')); if (!Number.isFinite(target)) return; const prefix = original.slice(0, match.index); const suffix = original.slice(match.index + raw.length); const currency = prefix.includes('₺'); const percent = suffix.includes('%'); const outputPrefix = currency ? '' : prefix; element.dataset.numberAnimated = original; const formatter = (value) => currency ? money(value) : `${value.toLocaleString('tr-TR', { maximumFractionDigits: raw.includes(',') ? 2 : 0 })}${percent ? '%' : suffix}`; if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { element.textContent = `${outputPrefix}${formatter(target)}`; return; } const start = performance.now(); const duration = 720; const tick = (now) => { const progress = Math.min(1, (now - start) / duration); const eased = 1 - Math.pow(1 - progress, 3); element.textContent = `${outputPrefix}${formatter(target * eased)}`; if (progress < 1) numberAnimationFrames.set(element, requestAnimationFrame(tick)); else { element.textContent = `${outputPrefix}${formatter(target)}`; numberAnimationFrames.delete(element); } }; element.textContent = `${outputPrefix}${formatter(0)}`; numberAnimationFrames.set(element, requestAnimationFrame(tick)); }); }
const dateText = (date) => new Intl.DateTimeFormat('tr-TR', { day:'2-digit', month:'short', year:'numeric' }).format(date);
const dateInputValue = (date) => { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, '0'); const day = String(date.getDate()).padStart(2, '0'); return `${year}-${month}-${day}`; };
const kpiPeriods = { daily:dateInputValue(new Date()), monthly:`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`, yearly:String(new Date().getFullYear()) };
const sameDay = (first, second) => first.toDateString() === second.toDateString();
const isInFilter = (item) => (!filterStart || item.date >= filterStart) && (!filterEnd || item.date <= filterEnd);
const storageKey = () => `ledgerly_transactions_${currentUser.uid}`;
const deletedStorageKey = () => `ledgerly_deleted_transactions_${currentUser.uid}`;
function loadDeletedTransactionIds() { try { return new Set(JSON.parse(localStorage.getItem(deletedStorageKey()) || '[]')); } catch (error) { console.error('Silinen kayıtlar okunamadı:', error); return new Set(); } }
function saveDeletedTransactionIds(ids) { localStorage.setItem(deletedStorageKey(), JSON.stringify([...ids])); }
function setupTransactionControls() { const panel = $('#transactions'); const filters = document.createElement('div'); filters.className = 'transaction-filters'; filters.innerHTML = '<label><span>Tür</span><select id="filterType"><option value="all">Tümü</option><option value="income">Gelir</option><option value="expense">Gider</option></select></label><label><span>Kategori</span><select id="filterCategory"><option value="all">Tüm kategoriler</option></select></label><label><span>Ödeme</span><select id="filterPayment"><option value="all">Tümü</option><option value="cash">Nakit</option><option value="card">Kart</option></select></label><button class="filter-clear" id="clearFilters"><i data-lucide="list-filter"></i> Filtreleri temizle</button>'; panel.querySelector('.table-scroll').before(filters); ['filterType','filterCategory','filterPayment'].forEach((id) => $(`#${id}`).addEventListener('change', renderTable)); $('#clearFilters').addEventListener('click', () => { $('#filterType').value = 'all'; $('#filterCategory').value = 'all'; $('#filterPayment').value = 'all'; renderTable(); }); const categoryField = document.querySelector('#transactionForm [name="category"]'); const customCategory = document.createElement('input'); customCategory.name = 'customCategory'; customCategory.placeholder = 'İstersen kendi kategorini yaz'; customCategory.className = 'custom-category'; categoryField.closest('.field').append(customCategory); customCategory.addEventListener('input', () => { const value = customCategory.value.trim(); let option = [...categoryField.options].find((item) => item.dataset.custom === 'true'); if (value) { if (!option) { option = new Option('', value); option.dataset.custom = 'true'; categoryField.add(option); } option.value = value; option.textContent = value; categoryField.value = value; } else if (option) { option.remove(); categoryField.value = categoryField.options[0].value; } }); }
function loadStoredTransactions() { try { return JSON.parse(localStorage.getItem(storageKey()) || '[]').map((item) => ({ ...item, date:new Date(item.date) })); } catch (error) { console.error('Yerel kayıtlar okunamadı:', error); return []; } }
function saveStoredTransactions() { localStorage.setItem(storageKey(), JSON.stringify(transactions)); }
function renderDateLabels() { const today = new Date(); $('#currentDate').textContent = new Intl.DateTimeFormat('tr-TR', { day:'numeric', month:'long', year:'numeric', weekday:'long' }).format(today); $('#transactionForm [name="date"]').value = dateInputValue(today); }
function setAuthScreen(user) { $('#loginScreen').hidden = Boolean(user); $('#appShell').hidden = !user; }

function setupFirebase() {
  if (demoMode) { setAuthScreen(null); return; }
  try {
    const app = initializeApp(firebaseConfig); auth = getAuth(app); db = getFirestore(app);
    onAuthStateChanged(auth, (user) => { setAuthScreen(user); if (user) { currentUser = user; transactions = loadStoredTransactions(); updateProfile(); render(); listenToTransactions(); } else { transactions = []; render(); } });
  } catch (error) {
    console.error('Firebase başlatılamadı:', error);
    showToast('Firebase bağlantısı kurulamadı. Config bilgilerini kontrol edin.');
  }
}
function updateProfile() { const name = currentUser.displayName || 'İşletmem'; const email = currentUser.email || 'Çalışma alanı'; const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); $('#userName').textContent = name; $('#userEmail').textContent = email; $('#profilePopoverName').textContent = name; $('#profilePopoverEmail').textContent = email; $('#welcomeTitle').textContent = `Merhaba, ${name}`; $('#userAvatar').textContent = initials || 'L'; if (currentUser.photoURL) $('#userAvatar').innerHTML = `<img src="${currentUser.photoURL}" alt="Profil fotoğrafı">`; }
function listenToTransactions() {
  if (demoMode) return;
  const transactionQuery = query(collection(db, 'transactions'), where('userId', '==', currentUser.uid));
  onSnapshot(transactionQuery, (snapshot) => { const deletedIds = loadDeletedTransactionIds(); const cloudTransactions = snapshot.docs.map((item) => ({ id:item.id, ...item.data(), date:item.data().date?.toDate?.() || new Date() })).filter((item) => !deletedIds.has(item.id)); const cloudIds = new Set(snapshot.docs.map((item) => item.id)); const localOnly = loadStoredTransactions().filter((item) => !cloudIds.has(item.id) && !deletedIds.has(item.id)); transactions = [...cloudTransactions, ...localOnly]; saveStoredTransactions(); render(); if (localOnly.length) { Promise.all(localOnly.map((item) => setDoc(doc(db, 'transactions', item.id), { ...item, userId:currentUser.uid }))).then(() => showToast(`${localOnly.length} yerel kayıt Firebase’e aktarıldı.`)).catch((error) => { console.error('Yerel kayıtlar Firebase’e aktarılamadı:', error); showToast('Yerel kayıtlar cihazda tutuluyor; Firestore kurallarını kontrol edin.'); }); } }, (error) => { console.error('İşlemler okunamadı:', error); showToast('İşlemler yüklenemedi. Firestore kurallarını kontrol edin.'); });
}
function totals() {
  const now = new Date(); const month = now.getMonth(); const year = now.getFullYear();
  const scopedTransactions = transactions.filter(isInFilter); const monthly = dateMode === 'month' ? scopedTransactions.filter((item) => item.date.getMonth() === month && item.date.getFullYear() === year) : scopedTransactions;
  const selectedDailyDate = new Date(`${kpiPeriods.daily}T12:00:00`);
  const selectedMonthParts = kpiPeriods.monthly.split('-').map(Number);
  const selectedMonthDate = new Date(selectedMonthParts[0], selectedMonthParts[1] - 1, 1);
  const selectedYear = Number(kpiPeriods.yearly);
  const daily = transactions.filter((item) => sameDay(item.date, selectedDailyDate));
  const yesterday = new Date(year, month, now.getDate() - 1);
  const annual = transactions.filter((item) => item.date.getFullYear() === selectedYear);
  const calendarMonth = transactions.filter((item) => item.date.getMonth() === selectedMonthDate.getMonth() && item.date.getFullYear() === selectedMonthDate.getFullYear());
  const previousMonth = transactions.filter((item) => item.date.getMonth() === (selectedMonthDate.getMonth() + 11) % 12 && item.date.getFullYear() === (selectedMonthDate.getMonth() === 0 ? selectedMonthDate.getFullYear() - 1 : selectedMonthDate.getFullYear()));
  const revenue = monthly.filter((item) => item.type === 'income').reduce((sum, item) => sum + Number(item.amount), 0);
  const expense = monthly.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount), 0);
  const dailyExpense = daily.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount), 0);
  const annualRevenue = annual.filter((item) => item.type === 'income').reduce((sum, item) => sum + Number(item.amount), 0);
  const annualExpense = annual.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount), 0);
  const calendarMonthRevenue = calendarMonth.filter((item) => item.type === 'income').reduce((sum, item) => sum + Number(item.amount), 0);
  const calendarMonthExpense = calendarMonth.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount), 0);
  const monthlyCash = calendarMonth.filter((item) => item.type === 'income' && item.paymentMethod === 'cash').reduce((sum, item) => sum + Number(item.amount), 0);
  const monthlyCard = calendarMonth.filter((item) => item.type === 'income' && item.paymentMethod === 'card').reduce((sum, item) => sum + Number(item.amount), 0);
  const annualCash = annual.filter((item) => item.type === 'income' && item.paymentMethod === 'cash').reduce((sum, item) => sum + Number(item.amount), 0);
  const annualCard = annual.filter((item) => item.type === 'income' && item.paymentMethod === 'card').reduce((sum, item) => sum + Number(item.amount), 0);
  const cash = daily.filter((item) => item.type === 'income' && item.paymentMethod === 'cash').reduce((sum, item) => sum + Number(item.amount), 0);
  const card = daily.filter((item) => item.type === 'income' && item.paymentMethod === 'card').reduce((sum, item) => sum + Number(item.amount), 0);
  const dailyRevenue = daily.filter((item) => item.type === 'income').reduce((sum, item) => sum + Number(item.amount), 0);
  const yesterdayRevenue = transactions.filter((item) => item.type === 'income' && sameDay(item.date, yesterday)).reduce((sum, item) => sum + Number(item.amount), 0);
  const previousMonthRevenue = previousMonth.filter((item) => item.type === 'income').reduce((sum, item) => sum + Number(item.amount), 0);
  const previousMonthExpense = previousMonth.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount), 0);
  const allTimeRevenue = transactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + Number(item.amount), 0);
  const allTimeExpense = transactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount), 0);
  const allTimeIncomeCount = transactions.filter((item) => item.type === 'income').length;
  const annualAverageMonthlyRevenue = annualRevenue / 12;
  const allTimeCash = transactions.filter((item) => item.type === 'income' && item.paymentMethod === 'cash').reduce((sum, item) => sum + Number(item.amount), 0);
  const allTimeCard = transactions.filter((item) => item.type === 'income' && item.paymentMethod === 'card').reduce((sum, item) => sum + Number(item.amount), 0);
  return { revenue, expense, dailyExpense, annualRevenue, annualExpense, calendarMonthRevenue, calendarMonthExpense, monthlyCash, monthlyCard, annualCash, annualCard, allTimeCash, allTimeCard, cash, card, dailyRevenue, yesterdayRevenue, previousMonthRevenue, previousMonthExpense, annualAverageMonthlyRevenue, allTimeRevenue, allTimeExpense, allTimeAverage:allTimeIncomeCount ? allTimeRevenue / allTimeIncomeCount : 0, profit:revenue-expense };
}
function periodSummary(period) { const today = new Date(); const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()); if (period === 'weekly') start.setDate(start.getDate() - 6); if (period === 'monthly') start.setDate(1); if (period === 'yearly') start.setMonth(0, 1); const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59); const scoped = transactions.filter((item) => item.date >= start && item.date <= end); const income = scoped.filter((item) => item.type === 'income'); const expenses = scoped.filter((item) => item.type === 'expense'); const revenue = income.reduce((sum, item) => sum + Number(item.amount), 0); const expense = expenses.reduce((sum, item) => sum + Number(item.amount), 0); return { revenue, expense, profit:revenue - expense, count:scoped.length, cash:income.filter((item) => item.paymentMethod === 'cash').reduce((sum, item) => sum + Number(item.amount), 0), card:income.filter((item) => item.paymentMethod === 'card').reduce((sum, item) => sum + Number(item.amount), 0), average:income.length ? revenue / income.length : 0 }; }
function renderAnalysis(period = 'yearly') { const data = periodSummary(period); const labels = { daily:'Bugün', weekly:'Son 7 gün', monthly:'Bu ay', yearly:'Bu yıl' }; const margin = data.revenue ? Math.round(data.profit / data.revenue * 100) : 0; const categories = [...new Set(transactions.filter((item) => item.type === 'expense').map((item) => item.category).filter(Boolean))].map((category) => ({ category, total:transactions.filter((item) => item.type === 'expense' && item.category === category).reduce((sum, item) => sum + Number(item.amount), 0) })).sort((a,b) => b.total - a.total); $('#analysisPeriodLabel').textContent = labels[period]; $('#analysisKpis').innerHTML = [{ icon:'wallet-cards', color:'cyan', label:'Toplam satış geliri', value:money(data.revenue), note:labels[period] }, { icon:'arrow-down-to-line', color:'orange', label:'Toplam gider', value:money(data.expense), note:'Aynı dönem' }, { icon:'circle-dollar-sign', color:'green', label:'Net sonuç', value:money(data.profit), note:`Kâr marjı %${margin}` }, { icon:'receipt-text', color:'violet', label:'İşlem yoğunluğu', value:data.count.toLocaleString('tr-TR'), note:'Toplam kayıt' }].map((card) => `<article class="analysis-kpi"><span class="summary-icon ${card.color}"><i data-lucide="${card.icon}"></i></span><p>${card.label}</p><strong>${card.value}</strong><small>${card.note}</small></article>`).join(''); const max = Math.max(data.revenue, data.expense, 1); $('#analysisBalance').innerHTML = `<div class="balance-item"><div><span>Gelir</span><b>${money(data.revenue)}</b></div><span class="balance-track"><i class="income-bar" style="width:${data.revenue / max * 100}%"></i></span></div><div class="balance-item"><div><span>Gider</span><b>${money(data.expense)}</b></div><span class="balance-track"><i class="expense-bar" style="width:${data.expense / max * 100}%"></i></span></div>`; $('#analysisStats').innerHTML = `<span><b>${data.cash ? Math.round(data.cash / Math.max(data.revenue, 1) * 100) : 0}%</b> nakit satış</span><span><b>${data.card ? Math.round(data.card / Math.max(data.revenue, 1) * 100) : 0}%</b> kartlı satış</span><span><b>${data.average ? money(data.average) : money(0)}</b> ortalama satış</span>`; $('#analysisCategories').innerHTML = categories.length ? categories.map((item) => `<div class="category-analysis-item"><span><i></i>${item.category}</span><b>${money(item.total)}</b><em><small style="width:${data.expense ? item.total / data.expense * 100 : 0}%"></small></em></div>`).join('') : '<p class="muted">Henüz gider kategorisi bulunmuyor.</p>'; const recommendations = []; if (!data.revenue) recommendations.push(['circle-alert','Veri yetersiz','Bu dönemde satış kaydı bulunmadığı için performans önerisi üretilemedi.']); else if (margin < 15) recommendations.push(['trending-down','Kâr marjını izle','Giderler gelire yakın. Özellikle en yüksek gider kategorisini aylık olarak takip et.']); else recommendations.push(['trending-up','Sağlıklı marj','Kârlılık dengesi olumlu görünüyor. Bu performansı korumak için gider oranını izlemeye devam et.']); if (data.expense > data.revenue * .4) recommendations.push(['wallet-cards','Gider oranı yüksek','Giderler satış gelirinin %40 üzerinde. Tedarikçi ve sabit giderleri yeniden değerlendir.']); else recommendations.push(['target','Büyüme fırsatı','Gider oranı kontrol altında. Satış hacmini artıracak kampanyalar için alan bulunuyor.']); if (categories[0]) recommendations.push(['list-filter','Öncelikli kategori',`${categories[0].category} toplam giderlerin en büyük kalemi. Bu kalem için alternatif tedarikçi veya fiyat karşılaştırması yap.`]); $('#recommendationList').innerHTML = recommendations.map((item) => `<div class="recommendation-item"><span class="recommendation-icon"><i data-lucide="${item[0]}"></i></span><div><strong>${item[1]}</strong><p>${item[2]}</p></div></div>`).join(''); document.querySelectorAll('#analysisTabs button').forEach((button) => button.classList.toggle('selected', button.dataset.analysisPeriod === period)); lucide.createIcons(); }
function renderAdditionalAnalysis(period) { let container = $('#analysisExtra'); if (!container) { $('#analysisKpis').insertAdjacentHTML('afterend', '<div class="analysis-extra" id="analysisExtra"></div>'); container = $('#analysisExtra'); } const today = new Date(); const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()); if (period === 'weekly') start.setDate(start.getDate() - 6); if (period === 'monthly') start.setDate(1); if (period === 'yearly') start.setMonth(0, 1); const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59); const scoped = transactions.filter((item) => item.date >= start && item.date <= end); const income = scoped.filter((item) => item.type === 'income'); const expenseItems = scoped.filter((item) => item.type === 'expense'); const revenue = income.reduce((sum, item) => sum + Number(item.amount), 0); const expense = expenseItems.reduce((sum, item) => sum + Number(item.amount), 0); const days = Math.max(1, Math.ceil((end - start) / 86400000) + 1); const dailyAverage = revenue / days; const categoryTotals = expenseItems.reduce((totals, item) => { totals[item.category] = (totals[item.category] || 0) + Number(item.amount); return totals; }, {}); const topCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0]; const dailySales = income.reduce((daysByDate, item) => { const key = item.date.toISOString().slice(0, 10); daysByDate[key] = (daysByDate[key] || 0) + Number(item.amount); return daysByDate; }, {}); const bestDay = Object.entries(dailySales).sort((a, b) => b[1] - a[1])[0]; const bestDayLabel = bestDay ? dateText(new Date(`${bestDay[0]}T12:00:00`)) : 'Veri yok'; container.innerHTML = [{ icon:'calendar-clock', color:'cyan', label:'Günlük ortalama ciro', value:money(dailyAverage), note:'Seçilen dönem ortalaması' }, { icon:'arrow-up-wide-narrow', color:'green', label:'En güçlü satış günü', value:bestDay ? money(bestDay[1]) : 'Veri yok', note:bestDay ? bestDayLabel : 'Henüz satış kaydı yok' }, { icon:'layers-3', color:'orange', label:'En yüksek gider kalemi', value:topCategory ? money(topCategory[1]) : 'Veri yok', note:topCategory ? topCategory[0] : 'Henüz gider kaydı yok' }, { icon:'percent', color:'violet', label:'Gider / ciro oranı', value:revenue ? `%${Math.round(expense / revenue * 100)}` : 'Veri yok', note:'Giderlerin satışlara oranı' }].map((card) => `<article class="analysis-kpi analysis-extra-kpi"><span class="summary-icon ${card.color}"><i data-lucide="${card.icon}"></i></span><p>${card.label}</p><strong>${card.value}</strong><small>${card.note}</small></article>`).join(''); lucide.createIcons(); }
function ensureKpiLayout() { if ($('#monthlyProfit')) return; $('.kpi-grid').innerHTML = [['wallet-cards','cyan','Aylık','Aylık satış geliri','monthlyRevenue','Bu takvim ayındaki gelir'],['arrow-down-to-line','orange','Aylık','Aylık toplam gider','monthlyExpense','Bu takvim ayındaki gider'],['circle-dollar-sign','green','Aylık','Aylık net sonuç','monthlyProfit','Aylık gelir eksi gider'],['credit-card','violet','Aylık','Kartlı satış','monthlyCard','Bu ay kartla yapılan satışlar'],['banknote','cyan','Aylık','Nakit satış','monthlyCash','Bu ay nakit yapılan satışlar'],['calendar-range','cyan','Yıllık','Yıllık satış geliri','annualRevenue','Bu yılın toplam geliri'],['calendar-minus','orange','Yıllık','Yıllık toplam gider','annualExpense','Bu yılın toplam gideri'],['circle-dollar-sign','green','Yıllık','Yıllık net sonuç','annualProfit','Yıllık gelir eksi gider'],['credit-card','violet','Yıllık','Kartlı satış','annualCard','Bu yıl kartla yapılan satışlar'],['banknote','cyan','Yıllık','Nakit satış','annualCash','Bu yıl nakit yapılan satışlar'],['wallet-cards','cyan','Tüm zamanlar','Toplam satış geliri','allTimeRevenue','Tüm kayıtların geliri'],['arrow-down-to-line','orange','Tüm zamanlar','Toplam gider','allTimeExpense','Tüm kayıtların gideri'],['circle-dollar-sign','green','Tüm zamanlar','Toplam net sonuç','allTimeProfit','Tüm zamanlar gelir eksi gider'],['credit-card','violet','Tüm zamanlar','Kartlı satış','allTimeCard','Tüm kartlı satışlar'],['banknote','cyan','Tüm zamanlar','Nakit satış','allTimeCash','Tüm nakit satışlar']].map(([icon,color,badge,label,id,note]) => `<article class="kpi-card"><div class="card-heading"><span class="kpi-icon ${color}"><i data-lucide="${icon}"></i></span><span class="status">${badge}</span></div><p class="muted">${label}</p><h2 id="${id}">₺0,00</h2><div class="expense-line"><span></span></div><small>${note}</small></article>`).join(''); }
function renderSummaryCards() { const labels = { daily:'Bugünkü hareketler', weekly:'Son 7 günün hareketleri', monthly:'Bu ayın hareketleri', yearly:'Bu yılın hareketleri' }; const data = periodSummary(summaryPeriod); const cards = [{ icon:'wallet-cards', color:'cyan', label:'Satış geliri', value:money(data.revenue), note:'Toplam gelir' }, { icon:'arrow-down-to-line', color:'orange', label:'Gider toplamı', value:money(data.expense), note:'Toplam harcama' }, { icon:'circle-dollar-sign', color:'green', label:'Net sonuç', value:money(data.profit), note:'Gelir eksi gider' }, { icon:'banknote', color:'cyan', label:'Nakit satış', value:money(data.cash), note:'Nakit tahsilat' }, { icon:'credit-card', color:'violet', label:'Kartlı satış', value:money(data.card), note:'Kart tahsilatı' }]; $('#summaryPeriodLabel').textContent = labels[summaryPeriod]; $('#summaryCards').innerHTML = cards.map((card) => `<article class="summary-card"><span class="summary-icon ${card.color}"><i data-lucide="${card.icon}"></i></span><p>${card.label}</p><strong>${card.value}</strong><small>${card.note}</small></article>`).join(''); $('#summaryCards').classList.toggle('daily-summary', summaryPeriod === 'daily'); document.querySelectorAll('#summaryPeriodTabs button').forEach((button) => button.classList.toggle('selected', button.dataset.summaryPeriod === summaryPeriod)); lucide.createIcons(); }
function updateSummaryScrollControls() { const cards = $('#summaryCards'); const previous = $('#summaryScrollPrevious'); const next = $('#summaryScrollNext'); if (!cards || !previous || !next) return; const maxScroll = cards.scrollWidth - cards.clientWidth; previous.disabled = cards.scrollLeft <= 2; next.disabled = cards.scrollLeft >= maxScroll - 2; }
function normalizeLegacyKpis() { if ($('#dailyRevenueTrend')) $('.kpi-grid').innerHTML = ''; }
function ensureDailyKpis() { if ($('#dailyProfit')) return; $('.kpi-grid').insertAdjacentHTML('afterbegin', [['wallet-cards','cyan','Günlük','Günlük satış geliri','dailyRevenue','Bugünkü toplam gelir'],['arrow-down-to-line','orange','Günlük','Günlük toplam gider','dailyExpense','Bugünkü toplam gider'],['circle-dollar-sign','green','Günlük','Günlük net sonuç','dailyProfit','Günlük gelir eksi gider'],['credit-card','violet','Günlük','Kartlı satış','dailyCard','Bugünkü kartlı satışlar'],['banknote','cyan','Günlük','Nakit satış','dailyCash','Bugünkü nakit satışlar']].map(([icon,color,badge,label,id,note]) => `<article class="kpi-card"><div class="card-heading"><span class="kpi-icon ${color}"><i data-lucide="${icon}"></i></span><span class="status">${badge}</span></div><p class="muted">${label}</p><h2 id="${id}">₺0,00</h2><div class="expense-line"><span></span></div><small>${note}</small></article>`).join('')); }
function updateKpiPeriodLabels() { const today = new Date(); const dailyLabel = `${new Intl.DateTimeFormat('tr-TR', { day:'numeric', month:'long', weekday:'long' }).format(today)} günü`; const monthName = new Intl.DateTimeFormat('tr-TR', { month:'long' }).format(today); const periodLabels = [`${dailyLabel}`, `${dailyLabel}`, `${dailyLabel}`, `${dailyLabel}`, `${dailyLabel}`, `${monthName[0].toLocaleUpperCase('tr-TR')}${monthName.slice(1)} ayı`, `${monthName[0].toLocaleUpperCase('tr-TR')}${monthName.slice(1)} ayı`, `${monthName[0].toLocaleUpperCase('tr-TR')}${monthName.slice(1)} ayı`, `${monthName[0].toLocaleUpperCase('tr-TR')}${monthName.slice(1)} ayı`, `${monthName[0].toLocaleUpperCase('tr-TR')}${monthName.slice(1)} ayı`, `${today.getFullYear()} yılı`, `${today.getFullYear()} yılı`, `${today.getFullYear()} yılı`, `${today.getFullYear()} yılı`, `${today.getFullYear()} yılı`]; document.querySelectorAll('.kpi-grid .status').forEach((status, index) => { status.textContent = periodLabels[index] || 'Tüm zamanlar'; }); }
function placeChartsAfterDailyRow() { const grid = $('.kpi-grid'); const charts = $('.charts-grid'); const dailyCard = $('#dailyCash')?.closest('.kpi-card'); if (grid && charts && dailyCard && charts.parentElement !== grid) dailyCard.after(charts); }
function updateProfitCardStates(values) { [['dailyProfit', values.dailyProfit], ['monthlyProfit', values.monthlyProfit], ['annualProfit', values.annualProfit], ['allTimeProfit', values.allTimeProfit]].forEach(([id, value]) => { const card = $(`#${id}`)?.closest('.kpi-card'); if (!card) return; card.classList.toggle('profit-positive', value > 0); card.classList.toggle('profit-negative', value < 0); card.classList.toggle('profit-neutral', value === 0); const icon = card.querySelector('.kpi-icon'); if (icon) { icon.innerHTML = `<i data-lucide="${value > 0 ? 'arrow-up' : value < 0 ? 'arrow-down' : 'circle-dollar-sign'}"></i>`; } }); lucide.createIcons(); }
function updateKpiRowLabels() { const grid = $('.kpi-grid'); if (!grid) return; grid.querySelectorAll('.kpi-row-label').forEach((label) => label.remove()); const today = new Date(); const dailyLabel = `${new Intl.DateTimeFormat('tr-TR', { day:'numeric', month:'long', weekday:'long' }).format(new Date(`${kpiPeriods.daily}T12:00:00`))} günü`; const monthDate = new Date(`${kpiPeriods.monthly}-01T12:00:00`); const monthName = new Intl.DateTimeFormat('tr-TR', { month:'long' }).format(monthDate); const labels = [dailyLabel, `${monthName[0].toLocaleUpperCase('tr-TR')}${monthName.slice(1)} ayı`, `${kpiPeriods.yearly} yılı`, 'Tüm zamanlar']; const cards = [...grid.querySelectorAll('.kpi-card')]; [15, 10, 5, 0].forEach((index) => { if (!cards[index]) return; const label = document.createElement('div'); label.className = `kpi-row-label row-${index / 5}`; const title = document.createElement('span'); title.textContent = labels[index / 5]; label.append(title); if (index < 15) { const input = document.createElement('input'); input.type = index === 0 ? 'date' : index === 5 ? 'month' : 'number'; input.className = 'kpi-period-picker'; if (index === 0) input.value = kpiPeriods.daily; if (index === 5) input.value = kpiPeriods.monthly; if (index === 10) { input.min = '2000'; input.max = String(new Date().getFullYear() + 1); input.value = kpiPeriods.yearly; input.step = '1'; } input.setAttribute('aria-label', `${labels[index / 5]} seç`); input.addEventListener('change', () => { if (index === 0) kpiPeriods.daily = input.value; if (index === 5) kpiPeriods.monthly = input.value; if (index === 10) kpiPeriods.yearly = input.value; render(); }); label.append(input); } cards[index].before(label); }); }
function render() { normalizeLegacyKpis(); ensureKpiLayout(); ensureDailyKpis(); updateKpiPeriodLabels(); updateKpiRowLabels(); placeChartsAfterDailyRow(); renderKpis(); updateExtendedKpis(); updateProfitCardStates({ dailyProfit:totals().dailyRevenue - totals().dailyExpense, monthlyProfit:totals().calendarMonthRevenue - totals().calendarMonthExpense, annualProfit:totals().annualRevenue - totals().annualExpense, allTimeProfit:totals().allTimeRevenue - totals().allTimeExpense }); renderTable(); renderCharts(); renderExpenseChart(); }
function setTrend(selector, current, previous, higherIsBetter = true) { const element = $(selector); if (!element) return; if (!previous) { element.className = `trend ${current ? 'positive' : 'negative'}`; element.innerHTML = `${current ? 'Yeni' : '0.00%'} <i data-lucide="${current ? 'arrow-up-right' : 'minus'}"></i>`; lucide.createIcons(); return; } const change = (current - previous) / previous * 100; const direction = change >= 0 ? 'arrow-up-right' : 'arrow-down-right'; const favorable = higherIsBetter ? change >= 0 : change <= 0; element.className = `trend ${favorable ? 'positive' : 'negative'}`; element.innerHTML = `${change >= 0 ? '+' : ''}${change.toFixed(2)}% <i data-lucide="${direction}"></i>`; lucide.createIcons(); }
function updateExtendedKpis() { const data = totals(); const values = { dailyRevenue:data.dailyRevenue, dailyExpense:data.dailyExpense, dailyProfit:data.dailyRevenue - data.dailyExpense, dailyCard:data.card, dailyCash:data.cash, monthlyRevenue:data.calendarMonthRevenue, monthlyExpense:data.calendarMonthExpense, monthlyProfit:data.calendarMonthRevenue - data.calendarMonthExpense, monthlyCard:data.monthlyCard, monthlyCash:data.monthlyCash, annualRevenue:data.annualRevenue, annualExpense:data.annualExpense, annualProfit:data.annualRevenue - data.annualExpense, annualCard:data.annualCard, annualCash:data.annualCash, allTimeRevenue:data.allTimeRevenue, allTimeExpense:data.allTimeExpense, allTimeProfit:data.allTimeRevenue - data.allTimeExpense, allTimeCard:data.allTimeCard, allTimeCash:data.allTimeCash }; Object.entries(values).forEach(([id, value]) => { const element = $(`#${id}`); if (element) element.textContent = money(value); }); const progressValues = { annualExpenseProgress:data.annualRevenue ? data.annualExpense / data.annualRevenue * 100 : 0 }; Object.entries(progressValues).forEach(([id, value]) => { const element = $(`#${id}`); if (element) element.style.width = `${Math.min(100, value)}%`; }); setTrend('#monthlyRevenueTrend', data.calendarMonthRevenue, data.previousMonthRevenue); setTrend('#monthlyExpenseTrend', data.calendarMonthExpense, data.previousMonthExpense, false); }
function renderKpis() { const data = totals(); $('#donutTotal').textContent = shortMoney(data.calendarMonthExpense); }
function renderTableOld() { const term = $('#searchInput').value.toLocaleLowerCase('tr'); const rows = [...transactions].filter(isInFilter).filter((item) => `${item.description} ${item.category}`.toLocaleLowerCase('tr').includes(term)).sort((a,b) => b.date - a.date); $('#emptyState').hidden = rows.length > 0; $('#transactionRows').innerHTML = rows.map((item) => `<tr><td><div class="transaction-name"><span class="transaction-icon ${item.type === 'income' ? 'income-icon' : 'expense-icon'}"><i data-lucide="${item.type === 'income' ? 'arrow-up-right' : 'arrow-down-right'}"></i></span>${item.description || (item.type === 'income' ? 'Satış' : 'Gider')}</div></td><td><span class="badge">${item.category}</span></td><td>${dateText(item.date)}</td><td>${item.paymentMethod === 'card' ? 'Kart' : 'Nakit'}</td><td class="align-right ${item.type === 'income' ? 'amount-income' : 'amount-expense'}">${item.type === 'income' ? '+' : '-'}${money(item.amount)}</td><td class="align-right"><button class="delete-button" data-id="${item.id}" aria-label="İşlemi sil"><i data-lucide="trash-2"></i></button></td></tr>`).join(''); lucide.createIcons(); document.querySelectorAll('.delete-button').forEach((button) => button.addEventListener('click', () => removeTransaction(button.dataset.id))); }

function getExportRangeTransactions(range = 'all') {
  const exported = [...transactions].filter((item) => item && item.date instanceof Date && !Number.isNaN(item.date.getTime()));
  if (range === 'month') {
    const end = new Date();
    const start = new Date(end.getFullYear(), end.getMonth() - 1, end.getDate(), 0, 0, 0);
    return exported.filter((item) => item.date >= start && item.date <= end).sort((a, b) => a.date - b.date);
  }
  if (range === 'custom') {
    if (!filterStart || !filterEnd) {
      showToast('Önce özel tarih aralığı seçin.');
      return null;
    }
    return exported.filter((item) => item.date >= filterStart && item.date <= filterEnd).sort((a, b) => a.date - b.date);
  }
  if (range === 'current') {
    return exported.filter(isInFilter).sort((a, b) => a.date - b.date);
  }
  return exported.sort((a, b) => a.date - b.date);
}

let pdfFontPromise;
function loadPdfFont() {
  if (!pdfFontPromise) {
    pdfFontPromise = fetch('https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans%5Bwdth,wght%5D.ttf').then((response) => {
      if (!response.ok) throw new Error('PDF font yüklenemedi.');
      return response.arrayBuffer();
    }).then((buffer) => {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
      return btoa(binary);
    });
  }
  return pdfFontPromise;
}

async function exportTransactionsPdf(range = 'all') {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast('PDF kütüphanesi yüklenemedi.');
    return;
  }

  const rows = getExportRangeTransactions(range);
  if (!rows || rows.length === 0) {
    showToast('PDF için uygun işlem bulunamadı.');
    return;
  }

  const { jsPDF } = window.jspdf;
  let fontData;
  try {
    fontData = await loadPdfFont();
  } catch (error) {
    showToast('PDF fontu yüklenemedi. İnternet bağlantınızı kontrol edin.');
    return;
  }
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.addFileToVFS('NotoSans.ttf', fontData);
  doc.addFont('NotoSans.ttf', 'NotoSans', 'normal');
  doc.setFont('NotoSans', 'normal');
  const pageWidth = doc.internal.pageSize.getWidth();
  const rangeLabelMap = { all: 'Tüm zamanlar', month: 'Son 1 ay', custom: 'İstediğim tarih aralığı', current: 'Geçerli filtre' };
  const typeLabelMap = { income: 'Gelir', expense: 'Gider' };

  doc.setFillColor(16, 17, 25);
  doc.rect(0, 0, pageWidth, 60, 'F');
  doc.setTextColor(244, 245, 247);
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(18);
  doc.text('Ledgerly - İşlem Raporu', 40, 32);
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(186, 191, 204);
  doc.text(`Dönem: ${rangeLabelMap[range] || 'Tüm zamanlar'}`, 40, 48);
  doc.text(`Toplam kayıt: ${rows.length}`, 420, 48);

  const tableRows = rows.map((item, index) => [
    index + 1,
    typeLabelMap[item.type] || 'İşlem',
    item.description || 'Açıklama yok',
    item.category || '-',
    new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(item.date),
    item.paymentMethod === 'card' ? 'Kart' : 'Nakit',
    `${item.type === 'income' ? '+' : '-'}${money(item.amount)}`
  ]);

  doc.setTextColor(24, 24, 32);
  doc.autoTable({
    head: [['No', 'Tür', 'Açıklama', 'Kategori', 'Tarih', 'Ödeme', 'Tutar']],
    body: tableRows,
    startY: 76,
    theme: 'grid',
    styles: {
      font: 'NotoSans',
      fontStyle: 'normal',
      fontSize: 8,
      textColor: [30, 30, 30],
      lineColor: [220, 224, 232],
      lineWidth: 0.3,
      overflow: 'linebreak',
      cellPadding: 5,
      valign: 'middle'
    },
    headStyles: {
      fillColor: [89, 216, 255],
      textColor: [12, 14, 20],
      font: 'NotoSans',
      fontStyle: 'normal'
    },
    bodyStyles: {
      fillColor: [255, 255, 255],
      font: 'NotoSans'
    },
    alternateRowStyles: {
      fillColor: [246, 248, 251],
      font: 'NotoSans'
    },
    columnStyles: {
      0: { cellWidth: 28, halign: 'center' },
      1: { cellWidth: 48 },
      2: { cellWidth: 150 },
      3: { cellWidth: 78 },
      4: { cellWidth: 66 },
      5: { cellWidth: 52 },
      6: { cellWidth: 78, halign: 'right' }
    },
    margin: { left: 40, right: 40 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 1) {
        const value = data.cell.raw;
        data.cell.styles.textColor = value === 'Gelir' ? [15, 166, 100] : [255, 113, 128];
        data.cell.styles.fontStyle = 'bold';
      }
    }
  });

  const totalIncome = rows.filter((item) => item.type === 'income').reduce((sum, item) => sum + Number(item.amount), 0);
  const totalExpense = rows.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount), 0);
  const net = totalIncome - totalExpense;
  const summaryY = doc.lastAutoTable.finalY + 18;

  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(11);
  doc.text('Özet', 40, summaryY);
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(10);
  doc.text(`Toplam gelir: ${money(totalIncome)}`, 40, summaryY + 18);
  doc.text(`Toplam gider: ${money(totalExpense)}`, 40, summaryY + 32);
  doc.text(`Net sonuç: ${money(net)}`, 40, summaryY + 46);

  const fileName = `ledgerly-islemler-${range}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
  showToast('PDF hazırlandı ve indirildi.');
}

function renderExpenseChart(period = expensePeriod) { const today = new Date(); const starts = { daily:new Date(today.getFullYear(), today.getMonth(), today.getDate()), weekly:new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6), monthly:new Date(today.getFullYear(), today.getMonth(), 1), yearly:new Date(today.getFullYear(), 0, 1) }; const ends = { daily:new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1), weekly:new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1), monthly:new Date(today.getFullYear(), today.getMonth() + 1, 1), yearly:new Date(today.getFullYear() + 1, 0, 1) }; const scoped = transactions.filter((item) => item.type === 'expense' && item.date >= starts[period] && item.date < ends[period]); const categoryTotals = scoped.reduce((totals, item) => { const category = item.category || 'Diğer'; totals[category] = (totals[category] || 0) + Number(item.amount); return totals; }, {}); const categories = Object.entries(categoryTotals).sort((first, second) => second[1] - first[1]).map(([category]) => category); const categoryValues = categories.map((category) => categoryTotals[category]); const colors = ['#a58bff','#ffae61','#59d8ff','#57dda5','#ff7180','#f2d06b','#e889d5']; const chartCategories = categories.length ? categories : ['Gider yok']; const chartValues = categories.length ? categoryValues : [1]; if (expenseChart) expenseChart.destroy(); expenseChart = new Chart($('#expenseChart'), { type:'doughnut', data:{ labels:chartCategories, datasets:[{ data:chartValues, backgroundColor:categories.length ? categories.map((_, index) => colors[index % colors.length]) : ['rgba(255,255,255,.12)'], borderWidth:0, hoverOffset:4 }] }, options:{ responsive:true, maintainAspectRatio:false, cutout:'76%', plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:(context) => categories.length ? ` ${money(context.raw)}` : ' Gider kaydı yok' } } } } }); const labels = { daily:'Bugünün kategorileri', weekly:'Son 7 günün kategorileri', monthly:'Bu ayın kategorileri', yearly:'Bu yılın kategorileri' }; $('#expensePeriodLabel').textContent = labels[period]; $('#donutTotal').textContent = shortMoney(scoped.reduce((sum, item) => sum + Number(item.amount), 0)); $('#categoryList').innerHTML = categories.length ? categories.map((category,index) => `<div class="category-item"><i style="background:${colors[index % colors.length]}"></i>${category}<b>${shortMoney(categoryValues[index])}</b></div>`).join('') : '<div class="category-empty">Bu dönemde gider kaydı yok.</div>'; }
function renderCharts() { const today = new Date(); const chartDates = Array.from({ length:chartDays }, (_, index) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - chartDays + 1 + index)); const labels = chartDates.map((date) => new Intl.DateTimeFormat('tr-TR', { day:'numeric', month:'short' }).format(date)); const values = chartDates.map((date) => transactions.filter((item) => item.type === 'income' && sameDay(item.date, date)).reduce((sum, item) => sum + Number(item.amount), 0)); if (salesChart) salesChart.destroy(); salesChart = new Chart($('#salesChart'), { type:'line', data:{ labels, datasets:[{ data:values, borderColor:'#59d8ff', backgroundColor:'rgba(89,216,255,.12)', fill:true, tension:.42, pointRadius:3, pointBackgroundColor:'#59d8ff', borderWidth:2 }] }, options: chartOptions('₺') }); $('#salesPeriod').textContent = `Son ${chartDays} günün performansı`; }
function chartOptions(prefix) { return { responsive:true, maintainAspectRatio:false, scales:{ x:{ grid:{ display:false }, ticks:{ color:'#696f83', font:{size:10} } }, y:{ grid:{ color:'rgba(255,255,255,.06)' }, ticks:{ color:'#696f83', font:{size:10}, callback:(value) => `${prefix}${value/1000}k` } } }, plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(context) => ` ${money(context.raw)}` }, displayColors:false } } }; }
function openEditModal(id) { const item = transactions.find((transaction) => transaction.id === id); if (!item) return; editingTransactionId = id; const form = $('#transactionForm'); form.elements.type.value = item.type; form.elements.amount.value = item.amount; form.elements.paymentMethod.value = item.paymentMethod; form.elements.description.value = item.description || ''; form.elements.date.value = dateInputValue(item.date); const categoryOption = [...form.elements.category.options].find((option) => option.value === item.category); const customCategory = form.elements.customCategory; if (categoryOption) { form.elements.category.value = item.category; if (customCategory) customCategory.value = ''; } else if (customCategory) { customCategory.value = item.category || ''; customCategory.dispatchEvent(new Event('input')); } $('#modalTitle').textContent = 'İşlemi düzenle'; $('#transactionSubmit').innerHTML = '<i data-lucide="check"></i> Değişiklikleri kaydet'; $('#modalBackdrop').hidden = false; lucide.createIcons(); }
async function addTransaction(event) { event.preventDefault(); const form = new FormData(event.target); const wasEditing = Boolean(editingTransactionId); const item = { type:form.get('type'), paymentMethod:form.get('paymentMethod'), amount:Number(form.get('amount')), category:form.get('category'), date:new Date(`${form.get('date')}T12:00:00`), description:form.get('description') || (form.get('type') === 'income' ? 'Yeni satış' : 'Yeni gider') }; const id = editingTransactionId || crypto.randomUUID(); if (wasEditing) transactions = transactions.map((transaction) => transaction.id === editingTransactionId ? { ...item, id } : transaction); else transactions.unshift({ ...item, id }); saveStoredTransactions(); closeModal(); editingTransactionId = null; event.target.reset(); renderDateLabels(); render(); try { if (db && auth?.currentUser) await setDoc(doc(db, 'transactions', id), { ...item, userId:auth.currentUser.uid }); showToast(wasEditing ? 'İşlem güncellendi.' : 'İşlem kaydedildi.'); } catch (error) { console.error('İşlem buluta kaydedilemedi:', error); showToast('İşlem cihazınıza kaydedildi; Firestore ayarlarını kontrol edin.'); } }
async function removeTransaction(id) { if (!confirm('Bu işlemi silmek istediğinize emin misiniz?')) return; const deletedTransaction = transactions.find((item) => item.id === id); const deletedIds = loadDeletedTransactionIds(); deletedIds.add(id); saveDeletedTransactionIds(deletedIds); transactions = transactions.filter((item) => item.id !== id); saveStoredTransactions(); render(); try { if (db && auth?.currentUser) await deleteDoc(doc(db, 'transactions', id)); showToast('İşlem silindi.'); } catch (error) { deletedIds.delete(id); saveDeletedTransactionIds(deletedIds); if (deletedTransaction) { transactions.push(deletedTransaction); saveStoredTransactions(); render(); } console.error('İşlem silinemedi:', error); showToast('İşlem silinemedi. Firestore kurallarını kontrol edin.'); } }
function closeModal() { $('#modalBackdrop').hidden = true; }
function showToast(message) { $('#toast span').textContent = message; $('#toast').classList.add('show'); setTimeout(() => $('#toast').classList.remove('show'), 2400); }
$('#openModal').addEventListener('click', () => { editingTransactionId = null; $('#transactionForm').reset(); $('#modalTitle').textContent = 'İşlem ekle'; $('#transactionSubmit').innerHTML = '<i data-lucide="check"></i> İşlemi kaydet'; renderDateLabels(); $('#modalBackdrop').hidden = false; lucide.createIcons(); }); $('#closeModal').addEventListener('click', closeModal); $('#modalBackdrop').addEventListener('click', (event) => { if (event.target === $('#modalBackdrop')) closeModal(); }); $('#transactionForm').addEventListener('submit', addTransaction); $('#searchInput').addEventListener('input', renderTable); $('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open')); document.addEventListener('click', (event) => { if (!$('#sidebar').contains(event.target) && event.target !== $('#menuToggle') && !$('#menuToggle').contains(event.target)) $('#sidebar').classList.remove('open'); }); $('#logoutButton').addEventListener('click', async () => { try { if (auth) await signOut(auth); } catch (error) { console.error('Oturum kapatılamadı:', error); showToast('Oturum kapatılamadı.'); } });
$('#profileMenu').addEventListener('click', () => { $('#profilePopover').hidden = !$('#profilePopover').hidden; }); $('#profileLogout').addEventListener('click', () => $('#logoutButton').click());
$('#notificationButton').addEventListener('click', () => showToast('Yeni bildiriminiz bulunmuyor.'));
$('#datePicker')?.addEventListener('click', () => { $('#dateMenu').hidden = !$('#dateMenu').hidden; }); document.querySelectorAll('#dateMenu button[data-period]').forEach((button) => button.addEventListener('click', () => { const period = button.dataset.period; const today = new Date(); const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59); dateMode = period; filterEnd = period === 'all' ? null : endOfToday; if (period === 'month') filterStart = new Date(today.getFullYear(), today.getMonth(), 1); else if (period === 'year') filterStart = new Date(today.getFullYear(), 0, 1); else if (period === 'last-year') filterStart = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()); else if (period === 'all') filterStart = null; else filterStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - Number(period) + 1); $('#dateRange').textContent = button.textContent; $('#dateMenu').hidden = true; if (['7','30','90'].includes(period)) { chartDays = Number(period); $('#chart7').classList.toggle('selected', chartDays === 7); $('#chart30').classList.toggle('selected', chartDays === 30); } else { chartDays = period === 'last-year' || period === 'all' || period === 'year' ? 30 : 7; $('#chart7').classList.toggle('selected', chartDays === 7); $('#chart30').classList.toggle('selected', chartDays === 30); } render(); showToast(`Aktif dönem: ${button.textContent}`); })); $('#applyDateFilter')?.addEventListener('click', () => { const start = $('#filterStart').value; const end = $('#filterEnd').value; if (!start || !end || start > end) { showToast('Başlangıç ve bitiş tarihlerini kontrol edin.'); return; } dateMode = 'custom'; filterStart = new Date(`${start}T00:00:00`); filterEnd = new Date(`${end}T23:59:59`); $('#dateRange').textContent = `${dateText(filterStart)} - ${dateText(filterEnd)}`; $('#dateMenu').hidden = true; render(); showToast('Özel tarih aralığı uygulandı.'); });
$('#chart7')?.addEventListener('click', () => { chartDays = 7; $('#chart7').classList.add('selected'); $('#chart30').classList.remove('selected'); renderCharts(); }); $('#chart30')?.addEventListener('click', () => { chartDays = 30; $('#chart30').classList.add('selected'); $('#chart7').classList.remove('selected'); renderCharts(); });
$('#expenseDetails')?.addEventListener('click', (event) => { event.stopPropagation(); $('#expensePeriodMenu').hidden = !$('#expensePeriodMenu').hidden; }); document.querySelectorAll('#expensePeriodMenu button[data-expense-period]').forEach((button) => button.addEventListener('click', () => { expensePeriod = button.dataset.expensePeriod; $('#expensePeriodMenu').hidden = true; renderExpenseChart(expensePeriod); })); document.addEventListener('click', (event) => { if (!event.target.closest('.expense-period-wrap')) $('#expensePeriodMenu')?.setAttribute('hidden', ''); }); $('#showAllTransactions').addEventListener('click', () => { $('#searchInput').value = ''; renderTable(); $('#transactions').scrollIntoView({ behavior:'smooth', block:'start' }); });
$('#pdfExportButton').addEventListener('click', (event) => { event.stopPropagation(); $('#pdfExportMenu').hidden = !$('#pdfExportMenu').hidden; });
document.addEventListener('click', (event) => { if (!event.target.closest('.pdf-export-wrap')) $('#pdfExportMenu').hidden = true; });
document.querySelectorAll('#pdfExportMenu button[data-export-range]').forEach((button) => button.addEventListener('click', () => {
  const range = button.dataset.exportRange;
  $('#pdfExportMenu').hidden = true;
  exportTransactionsPdf(range);
}));
document.querySelectorAll('.nav-item[data-target]').forEach((item) => item.addEventListener('click', (event) => { const target = item.dataset.target; if (target === 'settings') { event.preventDefault(); showToast('Ayarlar bölümü yakında aktif olacak.'); return; } if (target === 'analysis') return; document.querySelectorAll('.nav-item[data-target]').forEach((navItem) => navItem.classList.remove('active')); item.classList.add('active'); $('#sidebar').classList.remove('open'); }));
$('#loginButton').addEventListener('click', async () => {
  try {
    if (demoMode || !auth) throw new Error('Firebase Auth henüz başlatılamadı.');
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (error) {
    console.error('Google giriş hatası:', error);
    const messages = { 'auth/operation-not-allowed':'Firebase Console’da Google sağlayıcısını etkinleştirin.', 'auth/unauthorized-domain':'Firebase Console’da localhost alan adını ekleyin.', 'auth/popup-blocked':'Tarayıcı popup penceresini engelledi; popup iznini açın.', 'auth/popup-closed-by-user':'Google giriş penceresi kapatıldı.' };
    showToast(messages[error.code] || 'Google girişi başarısız oldu. Firebase ayarlarını kontrol edin.');
  }
});
document.querySelectorAll('#chartRangeSelector button[data-chart-range]').forEach((button) => button.addEventListener('click', () => { chartRange = button.dataset.chartRange; const today = new Date(); if (chartRange === '7' || chartRange === '30') chartDays = Number(chartRange); else if (chartRange === '3m') chartDays = 90; else if (chartRange === '6m') chartDays = 180; else if (chartRange === '1y') chartDays = 365; else { const firstIncome = transactions.filter((item) => item.type === 'income').sort((a, b) => a.date - b.date)[0]; chartDays = firstIncome ? Math.max(1, Math.ceil((today - firstIncome.date) / 86400000) + 1) : 365; } document.querySelectorAll('#chartRangeSelector button').forEach((item) => item.classList.toggle('selected', item === button)); $('#salesPeriod').textContent = chartRange === 'all' ? 'Tüm satış geçmişi' : `${button.textContent} satış performansı`; renderCharts(); }));
setupFirebase(); updateProfile(); renderDateLabels(); render(); lucide.createIcons();
setupTransactionControls(); renderTable(); lucide.createIcons();
const todayDateOption = document.querySelector('#dateMenu button[data-period="today"]');
if (todayDateOption) { todayDateOption.addEventListener('click', () => { const today = new Date(); dateMode = 'today'; filterStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()); filterEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59); $('#dateRange').textContent = 'Bugün'; $('#dateMenu').hidden = true; render(); showToast('Aktif dönem: Bugün'); }); }

function renderTable() { const term = $('#searchInput').value.toLocaleLowerCase('tr'); const type = $('#filterType')?.value || 'all'; const category = $('#filterCategory')?.value || 'all'; const payment = $('#filterPayment')?.value || 'all'; const categories = [...new Set(transactions.map((item) => item.category).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'tr')); if ($('#filterCategory')) { $('#filterCategory').innerHTML = '<option value="all">Tüm kategoriler</option>' + categories.map((item) => `<option value="${item}">${item}</option>`).join(''); $('#filterCategory').value = category; } const rows = [...transactions].filter(isInFilter).filter((item) => (type === 'all' || item.type === type) && (category === 'all' || item.category === category) && (payment === 'all' || item.paymentMethod === payment)).filter((item) => `${item.description} ${item.category}`.toLocaleLowerCase('tr').includes(term)).sort((a,b) => b.date - a.date); $('#transactionCount').textContent = rows.length.toLocaleString('tr-TR'); $('#emptyState').hidden = rows.length > 0; $('#transactionRows').innerHTML = rows.map((item, index) => `<tr><td>${rows.length - index}</td><td><div class="transaction-name"><span class="transaction-icon ${item.type === 'income' ? 'income-icon' : 'expense-icon'}"><i data-lucide="${item.type === 'income' ? 'arrow-up-right' : 'arrow-down-right'}"></i></span>${item.description || (item.type === 'income' ? 'Satış' : 'Gider')}</div></td><td><span class="badge">${item.category}</span></td><td>${dateText(item.date)}</td><td>${item.paymentMethod === 'card' ? 'Kart' : 'Nakit'}</td><td class="align-right ${item.type === 'income' ? 'amount-income' : 'amount-expense'}">${item.type === 'income' ? '+' : '-'}${money(item.amount)}</td><td class="align-right"><button class="edit-button" data-id="${item.id}" aria-label="İşlemi düzenle"><i data-lucide="pencil"></i></button><button class="delete-button" data-id="${item.id}" aria-label="İşlemi sil"><i data-lucide="trash-2"></i></button></td></tr>`).join(''); lucide.createIcons(); document.querySelectorAll('.edit-button').forEach((button) => button.addEventListener('click', () => openEditModal(button.dataset.id))); document.querySelectorAll('.delete-button').forEach((button) => button.addEventListener('click', () => removeTransaction(button.dataset.id))); }
