Работа бота осуществляется через API, написанные на **Node.js** (Express) и развёрнутые локально на порту 6000. Бот (`bot.js`) взаимодействует с сервером через **axios** и выводит информацию в Telegram через **node-telegram-bot-api**.

## <span style="color:rgb(41, 128, 185)">Чек-лист разработки</span>

1. **Настройка окружения**

   * Загрузить переменные из `.env`: `BOT_TOKEN`, `BOT_PASSWORD`, `DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `DB_PORT`, `API_PORT`.
2. **API сервер (`server.js`)**

   * Подключение к PostgreSQL через `pg.Client`.
   * Реализованы эндпоинты:

     * `GET /api/employees` — список сотрудников (таблица `tula_oit`).
     * `GET /api/service_company` — список сервисных компаний.
     * `GET /api/equipment_type` — список типов оборудования.
     * `GET /api/equipment/show` — полный список оборудования с JOIN.
     * `GET /api/equipment/fromRepair` — список оборудования в статусе «В ремонте».
     * `POST /api/equipment` — отправка оборудования в ремонт.
     * `PUT /api/equipment/:sn` — приём оборудования из ремонта.
     * `POST /api/equipment/createfile` — генерация CSV-файла (`equipment_list.csv`).
3. **Telegram-бот (`bot.js`)**

   * Подключение к боту через `node-telegram-bot-api` с `polling`.
   * Авторизация пользователей через пароль (`BOT_PASSWORD`).
   * Команды:

     * `/start` — запрос пароля и вывод меню.
     * `/torepair` — начать процесс отправки: выбор сотрудника → сервисной компании → типа оборудования → ввод SN.
     * `/fromrepair` — вывод списка оборудования в ремонте с кнопкой «Принять из ремонта».
     * `/show` — вывод полного списка оборудования.
     * `/file` — запрос на генерацию CSV и отправка файла.
   * Обработка `callback_query` для inline-клавиатур.
   * Валидация SN (минимум 3 символа, без пробелов и спецсимволов).
4. **CSV-файл**

   * Используется `createObjectCsvWriter` из `csv-writer`.
   * Добавляется BOM (`\uFEFF`) для корректного открытия в Excel.
   * После отправки ботом файл удаляется: `fs.unlinkSync`.

## <span style="color:rgb(41, 128, 185)">Используемые технологии</span>

* **Node.js** / **npm**
* **Express** (REST API)
* **PostgreSQL** + **pg**
* **csv-writer** (формирование CSV)
* **axios** (HTTP-клиент)
* **node-telegram-bot-api** (Telegram Bot API)
* **dotenv** (переменные окружения)
* **fs** (чтение/запись файлов)

## <span style="color:rgb(41, 128, 185)">Установка и запуск</span>

1. Клонировать репозиторий и перейти в папку проекта.
2. Создать файл `.env` в корне:

   ```
   BOT_TOKEN=ваш_токен_бота
   BOT_PASSWORD=ваш_пароль
   DB_USER=...
   DB_HOST=...
   DB_NAME=...
   DB_PASSWORD=...
   DB_PORT=...
   API_PORT=6000
   ```
3. Установить зависимости:

   ```bash
   npm install
   ```
4. Запустить сервер API:

   ```bash
   node server.js
   ```
5. В отдельной консоли запустить бота:

   ```bash
   node bot.js
   ```

> Готово! Бот и сервер запущены, можно тестировать команды в Telegram.

## <span style="color:rgb(41, 128, 185)">Примеры кода</span>

### Отправка оборудования в ремонт (сервер)

```js
app.post('/api/equipment', async (req, res) => {
  const { sn, send_date, status, sender_id, sc_id, equipment_type_id } = req.body;
  // Проверка обязательных полей
  if (!sn || !send_date || !status || !sender_id || !sc_id || !equipment_type_id) {
    return res.status(400).json({ message: 'Не все поля переданы' });
  }
  // Проверка дубликата в статусе "В ремонте"
  const exists = await client.query(
    `SELECT 1 FROM equipment WHERE sn = $1 AND status = 'В ремонте' LIMIT 1`,
    [sn]
  );
  if (exists.rowCount) {
    return res.status(409).json({ message: `Оборудование с SN ${sn} уже отправлено в ремонт` });
  }
  // Вставка записи
  const { rows } = await client.query(
    `INSERT INTO equipment (sn, send_date, status, sender_id, sc_id, equip_type_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [sn, send_date, status, sender_id, sc_id, equipment_type_id]
  );
  res.status(201).json(rows[0]);
});
```

### Обработка команды `/torepair` (бот)

```js
bot.onText(/\/torepair/, async msg => {
  const chatId = msg.chat.id;
  // Получаем список сотрудников
  const list = await api.getEmployees();
  const keyboard = makeInlineKeyboard(
    list.map(e => ({ id: e.id, label: e.fio })),
    'sender'
  );
  await bot.sendMessage(chatId, 'Кто отправляет в ремонт?', { reply_markup: keyboard });
});
```
