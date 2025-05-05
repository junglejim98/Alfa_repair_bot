const express = require('express');
const { Client } = require('pg');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');
require('dotenv').config();

const app = express();
const apiPort = 6000
const dbConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    
};
const client = new Client(dbConfig);
client.connect()
    .then(() => console.log('Подключение к базе успешно.'))
    .catch(err => console.error('Ошибка подключения к базе', err));

app.use(express.json());

app.get('/api/employees', async (req, res) => {
    try{
        const result = await client.query('SELECT id, fio FROM tula_oit');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Ошибка при получении списка сотрудников:', err);
        res.status(500).json({error: 'Ошибка при получинии списка сотрудников'});
    }
});

app.get('/api/service_company', async (req, res) => {
    try{
        const result = await client.query('SELECT id, sc_name from service_company');
        res.status(200).json(result.rows);
    } catch (err){
        console.error('Ошибка при получении списка сервисных компаний:', err);
        res.status(500).json({error: 'Ошибка при получении списка сервисных компаний'});
    }
});

app.post('/api/equipment', async (req, res) => {
    const { sn, send_date, status, sender_id, sc_id } = req.body;

    try {
        const result = await client.query(
            'INSERT INTO equipment (sn, send_date, status, sender_id, sc_id) values($1, $2, $3, $4, $5) RETURNING *',
            [sn, send_date, status, sender_id, sc_id]
        );
        res.status(201).json(result.rows[0]);
    } catch (err){
        console.error('Ошибка при добавлении оборудования:', err);
        res.status(500).json({error: 'Ошибка при добавлении оборудования'});
    }
});

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

app.get('/api/equipment/fromRepair', async (req, res) => {
    try{
        const result = await client.query(
            `SELECT e.*, s.fio AS sender_fio, r.fio AS reciver_fio FROM equipment e LEFT JOIN tula_oit s ON e.sender_id = s.id LEFT JOIN tula_oit r ON e.reciver_id = r.id WHERE e.status = 'В ремонте'`
        );
        res.status(200).json(result.rows);
    } catch (err){
        console.error('Ошибка при выводе списка оборудования:', err);
        res.status(500).json({error: 'Ошибка при получении оборудования'});
    }
});

app.get('/api/equipment/show', async (req, res) => {
    try{
        const result = await client.query(
            `SELECT e.*, s.fio AS sender_fio, r.fio AS reciver_fio, sc.sc_name AS service_company FROM equipment e 
            LEFT JOIN tula_oit s ON e.sender_id = s.id 
            LEFT JOIN tula_oit r ON e.reciver_id = r.id 
            LEFT JOIN service_company sc  on e.sc_id=sc.id 
            WHERE e.status = 'В ремонте'`
        );
        res.status(200).json(result.rows);
    } catch (err){
        console.error('Ошибка при выводе списка оборудования:', err);
        res.status(500).json({error: 'Ошибка при получении оборудования'});
    }
});



app.put('/api/equipment/:sn', async (req, res) => {
    const { sn } = req.params;
    const { recive_date, reciver_id, status } = req.body;

    try{
        const result = await client.query(
            'UPDATE equipment SET (recive_date, reciver_id, status) = ($1, $2, $3) WHERE sn = $4 RETURNING *',
            [recive_date, reciver_id, status, sn]
        );

        if(result.rowCount === 0) {
            return res.status(404).json({error: 'Оборудование с таким SN не найдено'});
        }

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Ошибка при обновлении данных:', err);
        res.status(500).json({error: 'Ошибка при обновлении даных'});
    }
});

app.listen(apiPort,   () => {
    console.log(`Сервер запущен на http://localhost:${apiPort}`);
})