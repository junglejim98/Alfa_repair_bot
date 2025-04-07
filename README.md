Работа бота осуществляется через API написанные на **node.js** и клиентской части написанной на **JS** с подключенным **TG API**. Фактически я через файл `bot.js` обращаюсь к API описанным в файле `server.js`, а те, в свою очередь общаются с базой и возвращают результат в `bot.js`, после чего он выводит информацию в TG через **TG API**.

## <span style="color:rgb(41, 128, 185)">Чек-лист разработки</span> 

1. Необходимо написать подключение к базе данных на стороне `server.js`, для безопасности подключение производится через переменные окружения.
2. При выполнении команды `/start` в боте, должно выводиться сообщение с просьбой ввести пароль. Обработка пароля производится в методе `bot.on('message' async (msg) => { })`
3. Далее необходимо написать API для взаимодействия с ботом. 
	1. API вывода списка сотрудников из таблицы `tula_oit` `/api/employees'`
	2. API вывода списка оборудования из таблицы `equipment` `/api/equipment/show`
	3. API отправки оборудования в ремонт `/api/equipment`
	4. API возвращения оборудования из ремонта `/api/equipment/fromRepair`
	5. API формирования файла со списком оборудования `/api/equipment/createfile`
4. Написать обработчики команд бота и общение с серверной частью через `axios`
## <span style="color:rgb(41, 128, 185)">Используемые технологии</span>

1. Для работы с базой `PostgreSQL` используется пакет `pg`. В начале файла объявляется имя класса на основе которого создается экземпляр, который обрабатывает запросы и подключение к базе, в моем проекте используется класс `Client`, так как я работаю с 1-ой базой и с 1-м подключением, для работы с пулом подключений используется класс `Pool`.
2. Для создания сервера используется фреймворк `express`. В начале файла выполняется подключение фреймворка, затем создается переменная, обычно `app`, значением которой является функция `express()`. Далее можно подключить возможность обработки JSON файлов и выполнению API с методами `post и put`.
3. Для создания CSV файлов на основе объектов создается функция `createObjectCsvWriter` на основе пакета `csv-writer`.
4. Для уточнения кодировки используется пакет `fs`.
5. Для использования  TG API используется класс `TelegramBot` из пакета `node-telegram-bot-api`. Далее создается экземпляр класса, в моем случае с именем `bot`, все дальнейшее взаимодействие с TG API осуществляется через экземпляр класса.
6. Для передачи HTTP запросов между файлом бота и сервером используется функция `axios` из одноименного пакета. Выполнение функций всегда асинхронное.
7. Для работы с переменными окружения подключается пакет `dotenv`, далее через цепочку свойств можно вызвать то или иное значение из переменной, например: `process.env.BOT_PASSWORD` получит значение параметра BOW_PASSWORD из файла `.env`

## <span style="color:rgb(41, 128, 185)">Взаимодействие между ботом и сервером на примере API создания файла.</span> 

Обработка нажатия кнопки создания файла `📁 /file`:

Сначала создается функция для обращения к серверу через `axios`:
```js
const createFile = async () => {
try {
	await axios.post('http://localhost:6000/api/equipment/createfile');
	return true;
} catch (err) {
	console.error('Ошибка при формировании файла:', err);
	return false;
	}
};
```

Обработка нажатия кнопки:
```js

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
```

Обработка `axios` запроса на стороне сервера с помощью `express`

```js
app.post('/api/equipment/createfile', async (req, res) => {
try{
const result = await client.query(
`
SELECT e.*, s.fio AS sender_fio, r.fio AS reciver_fio
FROM equipment e
LEFT JOIN tula_oit s ON e.sender_id = s.id
LEFT JOIN tula_oit r ON e.reciver_id = r.id`
);

const csvWriter = createObjectCsvWriter({
path: './equipment_list.csv',
header: [
{ id: 'sn', title: 'Серийный номер' },
{ id: 'send_date', title: 'Дата отправки' },
{ id: 'sender_fio', title: 'Отправитель' },
{ id: 'recive_date', title: 'Дата приемки' },
{ id: 'reciver_fio', title: 'Принимающий' },
{ id: 'status', title: 'Статус' },
],

encoding: 'utf8',
})

const records = result.rows.map(row => ({
sn: row.sn,
send_date: row.send_date,
sender_fio: row.sender_fio || 'Не указан',
recive_date: row.recive_date || 'Не указан',
reciver_fio: row.reciver_fio || 'Не указан',
status: row.status,
}));

await csvWriter.writeRecords(records);
 

const data = fs.readFileSync('./equipment_list.csv', 'utf8');
fs.writeFileSync('./equipment_list.csv', '\uFEFF' + data, 'utf8');


console.log('CSV-файл успешно создан.');
res.status(200).send('Файл создан');
} catch (err){
console.error('Ошибка формирования файла', err);
res.status(500).send('Ошибка формирования файла');
}
});
```
