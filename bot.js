require('dotenv').config();
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const PASSWORD = process.env.BOT_PASSWORD;
if (!PASSWORD) {
  console.error('ERROR: BOT_PASSWORD is not set');
  process.exit(1);
}

const authorizedUsers = new Set();
let state = {
  senderId: null,
  serviceCompanyId: null,
  equipmentTypeId: null,
  receiverId: null,
  currentSn: null
};

/** Простая утилита для генерации inline-клавиатур */
function makeInlineKeyboard(items, prefix) {
  return {
    inline_keyboard: items.map(({ id, label }) => [{
      text: label,
      callback_data: `${prefix}_${id}${prefix === 'receiver' ? `_${state.currentSn}` : ''}`
    }])
  };
}

/** Унифицированная обработка ошибок API / логирование */
async function handleError(chatId, err, context = '') {
  console.error(`Error in ${context}:`, err);
  const msg = err.response?.data?.message || err.response?.data?.error || 'Что-то пошло не так, повторите позже.';
  await bot.sendMessage(chatId, `❌ ${msg}`);
}

// --- API layer ---
const api = {
  base: axios.create({ baseURL: 'http://localhost:6000/api' }),

  getEmployees: () => api.base.get('/employees').then(r => r.data),
  getServiceCompanies: () => api.base.get('/service_company').then(r => r.data),
  getEquipmentTypes: () => api.base.get('/equipment_type').then(r => r.data),
  getEquipment: (path) => api.base.get(`/equipment${path || ''}`).then(r => r.data),
  createCsv: () => api.base.post('/equipment/createfile'),
  sendToRepair: (payload) => api.base.post('/equipment', payload),
  returnFromRepair: (sn, payload) => api.base.put(`/equipment/${sn}`, payload)
};

// --- Основная клавиатура ---
const mainKeyboard = {
  resize_keyboard: true,
  one_time_keyboard: true,
  keyboard: [
    [{ text: '📤 /torepair' }],
    [{ text: '📥 /fromrepair' }],
    [{ text: '📋 /show' }],
    [{ text: '📁 /file' }]
  ]
};

// --- Хэндлеры команд ---
bot.onText(/\/start/, msg => {
  const chatId = msg.chat.id;
  if (authorizedUsers.has(chatId)) {
    return bot.sendMessage(chatId, 'Вы уже авторизованы.', { reply_markup: mainKeyboard });
  }
  bot.sendMessage(chatId, 'Введите пароль для доступа:');
});

bot.onText(/\/torepair/, async msg => {
  const chatId = msg.chat.id;
  if (!authorizedUsers.has(chatId)) return bot.sendMessage(chatId, 'Доступ запрещён. /start для входа.');
  try {
    const list = await api.getEmployees();
    if (!list.length) return bot.sendMessage(chatId, 'Нет сотрудников в базе.');
    const keyboard = makeInlineKeyboard(
      list.map(e => ({ id: e.id, label: e.fio })),
      'sender'
    );
    await bot.sendMessage(chatId, 'Кто отправляет в ремонт?', { reply_markup: keyboard });
  } catch (e) {
    await handleError(chatId, e, 'getEmployees');
  }
});

bot.onText(/\/fromrepair/, async msg => {
  const chatId = msg.chat.id;
  if (!authorizedUsers.has(chatId)) return bot.sendMessage(chatId, 'Доступ запрещён. /start для входа.');
  try {
    const items = await api.getEquipment('/fromRepair');
    await sendList(chatId, items, true);
  } catch (e) {
    await handleError(chatId, e, 'getEquipment/fromRepair');
  }
});

bot.onText(/\/show/, async msg => {
  const chatId = msg.chat.id;
  if (!authorizedUsers.has(chatId)) return bot.sendMessage(chatId, 'Доступ запрещён. /start для входа.');
  try {
    const items = await api.getEquipment('/show');
    await sendList(chatId, items);
  } catch (e) {
    await handleError(chatId, e, 'getEquipment/show');
  }
});

bot.onText(/\/file/, async msg => {
  const chatId = msg.chat.id;
  if (!authorizedUsers.has(chatId)) return bot.sendMessage(chatId, 'Доступ запрещён. /start для входа.');
  const path = './equipment_list.csv';
  try {
    await api.createCsv();
    if (!fs.existsSync(path)) throw new Error('Файл не найден');
    await bot.sendDocument(chatId, path);
    fs.unlinkSync(path);
  } catch (e) {
    await handleError(chatId, e, 'createCsv or sendDocument');
  }
});

/** Отправляет список оборудования в чат */
async function sendList(chatId, equipment, isFromRepair = false) {
  if (!equipment.length) return bot.sendMessage(chatId, 'Список пуст.');
  for (const item of equipment) {
    const txt = `
*SN*: \`${item.sn}\`
*Тип*: \`${item.equipment_type || '—'}\`
*Статус*: \`${item.status}\`
*Отправлен*: \`${item.send_date}\`
*Получил*: \`${item.reciver_fio || '—'}\`
`;
    const opts = { parse_mode: 'MarkdownV2' };
    if (isFromRepair) {
      state.currentSn = item.sn;
      Object.assign(opts, {
        reply_markup: makeInlineKeyboard(
          [{ id: item.sn, label: 'Принять из ремонта' }],
          'return'
        )
      });
    }
    await bot.sendMessage(chatId, txt, opts);
  }
}

// --- Обработчик callback_query ---
bot.on('callback_query', async query => {
  const chatId = query.message.chat.id;
  const [action, id, sn] = query.data.split('_');

  try {
    switch (action) {
      case 'sender':
        state.senderId = id;
        {
          const list = await api.getServiceCompanies();
          const keyboard = makeInlineKeyboard(
            list.map(s => ({ id: s.id, label: s.sc_name })),
            'sc'
          );
          await bot.sendMessage(chatId, 'Выберите сервисную компанию:', { reply_markup: keyboard });
        }
        break;

      case 'sc':
        state.serviceCompanyId = id;
        {
          const list = await api.getEquipmentTypes();
          const keyboard = makeInlineKeyboard(
            list.map(e => ({ id: e.id, label: e.equipment_name })),
            'et'
          );
          await bot.sendMessage(chatId, 'Выберите тип оборудования:', { reply_markup: keyboard });
        }
        break;

      case 'et':
        state.equipmentTypeId = id;
        await bot.sendMessage(chatId, 'Введите SN (без спецсимволов):');
        break;

      case 'return':
        state.currentSn = id;
        {
          const list = await api.getEmployees();
          const keyboard = makeInlineKeyboard(
            list.map(e => ({ id: e.id, label: e.fio })),
            'receiver'
          );
          await bot.sendMessage(chatId, 'Кто принимает из ремонта?', { reply_markup: keyboard });
        }
        break;

      case 'receiver':
        state.receiverId = id;
        await api.returnFromRepair(sn, {
          recive_date: new Date().toISOString().split('T')[0],
          reciver_id: state.receiverId,
          status: 'Вернулся из ремонта'
        });
        await bot.sendMessage(chatId, `✔ Оборудование ${sn} принято.`);
        // Сброс состояния
        state.receiverId = state.currentSn = null;
        break;
    }
  } catch (e) {
    await handleError(chatId, e, `callback_${action}`);
  }
});

// --- Обработка обычных сообщений (пароль и SN) ---
bot.on('message', async msg => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (!text || text.startsWith('/')) return;

  if (text === PASSWORD && !authorizedUsers.has(chatId)) {
    authorizedUsers.add(chatId);
    return bot.sendMessage(chatId, 'Доступ разрешён.', { reply_markup: mainKeyboard });
  }

  if (state.senderId) {
    // Приём SN
    if (text.length < 3 || /\s|[^\w-]/.test(text)) {
      return bot.sendMessage(chatId, '❌ Некорректный SN. Минимум 3 символа, без пробелов и спецсимволов.');
    }
    try {
      await api.sendToRepair({
        sn: text,
        send_date: new Date().toISOString().split('T')[0],
        status: 'В ремонте',
        sender_id: state.senderId,
        sc_id: state.serviceCompanyId,
        equipment_type_id: state.equipmentTypeId
      });
      await bot.sendMessage(chatId, `✔ SN ${text} отправлен в ремонт.`);
    } catch (e) {
      const serverMsg =
      e.response?.data?.message ||
      e.response?.data?.error ||
      e.response?.data?.detail ||
      'Неизвестная ошибка';
      await bot.sendMessage(chatId, `❌ ${serverMsg}`);
    } finally {
      state.senderId = null;
      state.serviceCompanyId = null;
      state.equipmentTypeId = null;
    }
  } else if (!authorizedUsers.has(chatId)) {
    bot.sendMessage(chatId, 'Неверный пароль. Доступ запрещён.');
  }
});
