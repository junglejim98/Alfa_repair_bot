require('dotenv').config();
const express = require('express');
const fs = require('fs');
const { Client } = require('pg');
const { createObjectCsvWriter } = require('csv-writer');

const app = express();
const PORT = process.env.API_PORT || 6000;

// Подключение к БД
const client = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: +process.env.DB_PORT
});
client.connect()
  .then(() => console.log('✅ Connected to PostgreSQL'))
  .catch(err => console.error('❌ DB Connection Error:', err));

app.use(express.json());

/** Унифицированный SELECT с JOIN для оборудования */
const equipmentSelect = `
  SELECT
    e.*,
    s.fio    AS sender_fio,
    r.fio    AS reciver_fio,
    sc.sc_name      AS service_company,
    eq.equipment_name AS equipment_type
  FROM equipment e
  LEFT JOIN tula_oit s ON e.sender_id    = s.id
  LEFT JOIN tula_oit r ON e.reciver_id   = r.id
  LEFT JOIN service_company sc ON e.sc_id = sc.id
  LEFT JOIN equipment_type    eq ON e.equip_type_id = eq.id
`;

// --- Справочники ---
app.get('/api/employees', async (req, res) => {
  try {
    const { rows } = await client.query('SELECT id, fio FROM tula_oit');
    res.json(rows);
  } catch (e) {
    console.error('employees:', e);
    res.status(500).json({ message: 'Ошибка получения сотрудников' });
  }
});

app.get('/api/service_company', async (req, res) => {
  try {
    const { rows } = await client.query('SELECT id, sc_name FROM service_company');
    res.json(rows);
  } catch (e) {
    console.error('service_company:', e);
    res.status(500).json({ message: 'Ошибка получения компаний' });
  }
});

app.get('/api/equipment_type', async (req, res) => {
  try {
    const { rows } = await client.query('SELECT id, equipment_name FROM equipment_type');
    res.json(rows);
  } catch (e) {
    console.error('equipment_type:', e);
    res.status(500).json({ message: 'Ошибка получения типов' });
  }
});

// --- CRUD оборудование ---
app.post('/api/equipment', async (req, res) => {
  const { sn, send_date, status, sender_id, sc_id, equipment_type_id } = req.body;
  if (!sn || !send_date || !status || !sender_id || !sc_id || !equipment_type_id) {
    return res.status(400).json({ message: 'Не все поля переданы' });
  }
  try {
    const check = await client.query(`SELECT sn FROM equipment WHERE status = 'В ремонте' and sn = $1 LIMIT 1`, [sn]);
    if(check.rowCount){
        return res
        .status(409)
        .json({ message: `Оборудование с SN ${sn} уже отправлено в ремонт` });
    }
    const { rows } = await client.query(
      `INSERT INTO equipment
        (sn, send_date, status, sender_id, sc_id, equip_type_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [sn, send_date, status, sender_id, sc_id, equipment_type_id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('insert equipment:', e);
    if (e.code === '23505') {
      return res.status(409).json({ message: 'SN уже существует' });
    }
    res.status(500).json({ message: 'Ошибка при добавлении' });
  }
});

app.get('/api/equipment/fromRepair', async (req, res) => {
  try {
    const { rows } = await client.query(`${equipmentSelect} WHERE status = 'В ремонте'`);
    res.json(rows);
  } catch (e) {
    console.error('equipment/fromRepair:', e);
    res.status(500).json({ message: 'Ошибка получения списка' });
  }
});

app.get('/api/equipment/show', async (req, res) => {
  try {
    const { rows } = await client.query(equipmentSelect);
    res.json(rows);
  } catch (e) {
    console.error('equipment/show:', e);
    res.status(500).json({ message: 'Ошибка получения списка' });
  }
});

app.put('/api/equipment/:sn', async (req, res) => {
  const { sn } = req.params;
  const { recive_date, reciver_id, status } = req.body;
  try {
    const { rows, rowCount } = await client.query(
      `UPDATE equipment
         SET recive_date = $1,
             reciver_id = $2,
             status      = $3
       WHERE sn = $4
       RETURNING *`,
      [recive_date, reciver_id, status, sn]
    );
    if (!rowCount) return res.status(404).json({ message: 'SN не найден' });
    res.json(rows[0]);
  } catch (e) {
    console.error('update equipment:', e);
    res.status(500).json({ message: 'Ошибка обновления' });
  }
});

// --- Генерация CSV ---
app.post('/api/equipment/createfile', async (req, res) => {
  try {
    const { rows } = await client.query(equipmentSelect);
    const writer = createObjectCsvWriter({
      path: './equipment_list.csv',
      header: [
        { id: 'sn', title: 'SN' },
        { id: 'equipment_type', title: 'Тип' },
        { id: 'send_date', title: 'Отправка' },
        { id: 'sender_fio', title: 'Отправитель' },
        { id: 'recive_date', title: 'Приём' },
        { id: 'reciver_fio', title: 'Принимающий' },
        { id: 'service_company', title: 'Сервис' },
        { id: 'status', title: 'Статус' },
      ],
      encoding: 'utf8'
    });
    await writer.writeRecords(rows);
    // BOM для Excel
    const data = fs.readFileSync('./equipment_list.csv', 'utf8');
    fs.writeFileSync('./equipment_list.csv', '\uFEFF' + data, 'utf8');
    res.sendStatus(200);
  } catch (e) {
    console.error('createfile:', e);
    res.status(500).send('Ошибка формирования CSV');
  }
});

app.listen(PORT, () => console.log(`API на порту ${PORT}`));
