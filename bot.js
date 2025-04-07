const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const PASSWORD = process.env.BOT_PASSWORD;
let pswd = '';

if (!PASSWORD) {
    console.error('Ошибка: Пароль не задан в переменных окружения.');
    process.exit(1);
}

const authorizedUsers = new Set();
let selectedSenderId = null;
let selectedReciverId = null;
let currentSn = null;

function cleanSN(str) {
    return !/[ `!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~]/.test(str);
  }

// Функции для получения данных

    const keyboard = {
        keyboard: [
            [{ text: '📤 /torepair' }],
            [{ text: '📥 /fromrepair' }],
            [{ text: '📋 /show' }],
            [{ text: '📁 /file' }],
        ],
        resize_keyboard: true,
        one_time_keyboard: true
    };

const getEmployees = async () => {
    try {
        const response = await axios.get('http://localhost:6000/api/employees');
        return response.data;
    } catch (err) {
        console.error('Ошибка при получении списка сотрудников:', err);
        return [];
    }
};

const getEquipmentToRepair = async () => {
    try {
        const response = await axios.get('http://localhost:6000/api/equipment/fromRepair');
        return response.data;
    } catch (err) {
        console.error('Ошибка при получении списка оборудования:', err);
        return [];
    }
};

const getEquipment = async () => {
    try {
        const response = await axios.get('http://localhost:6000/api/equipment/show');
        return response.data;
    } catch (err) {
        console.error('Ошибка при получении списка оборудования:', err);
        return [];
    }
};

const createFile = async () => {
    try {
        await axios.post('http://localhost:6000/api/equipment/createfile');
        return true;
    } catch (err) {
        console.error('Ошибка при формировании файла:', err);
        return false;
    }
};

// Функция для отправки списка оборудования
const sendEquipmentList = async (chatId, equipment, isFromRepair = false) => {
    if (equipment.length === 0) {
        return bot.sendMessage(chatId, 'Список оборудования пуст.');
    }

    for (const item of equipment) {
        const message = `
*SN:* \`${item.sn}\`
*Дата отправки в ремонт:* \`${item.send_date}\`
*Отправитель:* \`${item.sender_fio || 'Не указан'}\`
*Дата приема из ремонта:* \`${item.recive_date || 'Не указан'}\`
*Принимающий:* \`${item.reciver_fio || 'Не указан'}\`
*Статус:* \`${item.status}\`
        `;

        if (isFromRepair) {
            const keyboard = {
                inline_keyboard: [
                    [{ text: 'Принять из ремонта', callback_data: `return_${item.sn}` }]
                ]
            };
            bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
        } else {
            bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
        }
    }
};

// Обработчики команд
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (authorizedUsers.has(chatId)) {
        bot.sendMessage(chatId, 'Вы уже авторизованы');
        bot.sendMessage(chatId, 'Выберите действие на встроенной клавиатуре', {
            reply_markup: keyboard
        });
    } else{
    bot.sendMessage(chatId, 'Введите пароль для доступа:');
    }
});


bot.onText(/\/torepair/, async (msg) => {
    const chatId = msg.chat.id;

    if (!authorizedUsers.has(chatId)) {
        return bot.sendMessage(chatId, 'Доступ запрещён. Введите пароль с помощью команды /start.');
    }

    const employees = await getEmployees();

    if (employees.length === 0) {
        return bot.sendMessage(chatId, 'Список сотрудников пуст.');
    }

    const keyboard = employees.map(employee => [{ text: employee.fio, callback_data: `sender_${employee.id}` }]);

    bot.sendMessage(chatId, 'Выберите сотрудника, который отправляет оборудование в ремонт:', {
        reply_markup: {
            inline_keyboard: keyboard,
        },
    });
});

bot.onText(/\/fromrepair/, async (msg) => {
    const chatId = msg.chat.id;

    if (!authorizedUsers.has(chatId)) {
        return bot.sendMessage(chatId, 'Доступ запрещён. Введите пароль с помощью команды /start.');
    }

    const equipmentToRepair = await getEquipmentToRepair();
    await sendEquipmentList(chatId, equipmentToRepair, true);
});

bot.onText(/\/show/, async (msg) => {
    const chatId = msg.chat.id;

    if (!authorizedUsers.has(chatId)) {
        return bot.sendMessage(chatId, 'Доступ запрещён. Введите пароль с помощью команды /start.');
    }

    const equipment = await getEquipment();
    await sendEquipmentList(chatId, equipment);
});

bot.onText(/\/file/, async (msg) => {
    const chatId = msg.chat.id;

    if (!authorizedUsers.has(chatId)) {
        return bot.sendMessage(chatId, 'Доступ запрещён. Введите пароль с помощью команды /start.');
    }

    const filePath = './equipment_list.csv';

    const fileCreated = await createFile();
    if (!fileCreated) {
        return bot.sendMessage(chatId, 'Ошибка при создании файла.');
    }

    if (!fs.existsSync(filePath)) {
        return bot.sendMessage(chatId, 'Файл не найден.');
    }

    bot.sendDocument(chatId, filePath)
        .then(() => {
            console.log('Файл успешно отправлен.');
            fs.unlinkSync(filePath);
        })
        .catch(err => {
            console.error('Ошибка при отправке файла:', err);
            bot.sendMessage(chatId, 'Ошибка при отправке файла.');
        });
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data.startsWith('sender_')) {
        selectedSenderId = data.split('_')[1];
        bot.sendMessage(chatId, 'Введите серийный номер оборудования:');
    } else if (data.startsWith('receiver_')) {
        const [employeeId, sn] = data.split('_').slice(1);
        selectedReciverId = employeeId;
        currentSn = sn;

        try {
            await axios.put(`http://localhost:6000/api/equipment/${currentSn}`, {
                recive_date: new Date().toLocaleDateString(),
                reciver_id: selectedReciverId,
                status: 'Вернулся из ремонта',
            });

            bot.sendMessage(chatId, `Оборудование с SN ${currentSn} вернулось из ремонта.`);

            selectedReciverId = null;
            currentSn = null;
        } catch (err) {
            console.error('Ошибка при обновлении статуса:', err);
            bot.sendMessage(chatId, 'Ошибка при обновлении статуса.');
        }
    } else if (data.startsWith('return_')) {
        const sn = data.split('_')[1];

        const employees = await getEmployees();

        if (employees.length === 0) {
            return bot.sendMessage(chatId, 'Список сотрудников пуст.');
        }

        const keyboard = employees.map(employee => [{ text: employee.fio, callback_data: `receiver_${employee.id}_${sn}` }]);

        bot.sendMessage(chatId, 'Выберите сотрудника, который принимает оборудование:', {
            reply_markup: {
                inline_keyboard: keyboard,
            },
        });
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (text.startsWith('/')) {
        return;
    }

    if (text === PASSWORD) {
        pswd = text;
        authorizedUsers.add(chatId);
        bot.sendMessage(chatId, 'Пароль верный. Доступ разрешён.');
        bot.sendMessage(chatId, 'Выберите действие на встроенной клавиатуре', {
            reply_markup: keyboard
        });
    } else if (selectedSenderId !== null) {
        const sn = text.trim();
        
        if (!sn || sn.length < 3 || !cleanSN(sn)) {
            return bot.sendMessage(chatId, '❌ Ошибка: SN не может быть пустым, содержать пробелы и спецсимволы или слишком коротким!');
        }

        const send_date = new Date().toLocaleDateString();

        try {
            const response = await axios.post('http://localhost:6000/api/equipment', {
                sn,
                send_date,
                status: 'В ремонте',
                sender_id: selectedSenderId,
            });

            selectedSenderId = null;

            bot.sendMessage(chatId, `Оборудование с SN ${sn} отправлено в ремонт ${send_date}.`);
        } catch (err) {
            console.error('Ошибка при добавлении оборудования:', err);
            bot.sendMessage(chatId, 'Ошибка при добавлении оборудования.');
        }
    } else if(pswd !== PASSWORD){
        bot.sendMessage(chatId, 'Неверный пароль. Доступ запрещён.');
    }
});