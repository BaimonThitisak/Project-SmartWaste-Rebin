const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const { error } = require('console');
const { text } = require('stream/consumers');

const app = express();


const LINE_ACCESS_TOKEN = '7oiJ3rpc4E8yE0d84XtYzruPViZ9VoNv8JzxROujGapYKuDjr1HOaFfWovPr4DcS58QHogyQgJ5xxaRlJxaLksshiaZKQ3isf/T5cGECQ32s4LhwJXCQMmHtYt1A+jaxBA4zQOkcxv5XrgErdaIajgdB04t89/1O/w1cDnyilFU=';

app.use(cors());
app.use(express.json());

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const db = mysql.createConnection({
  host: '127.0.0.1',
  user: 'root',
  password: '', 
  database: 'smart_waste' 
});

db.connect((err) => {
  if (err) console.error('เชื่อมต่อ Database ล้มเหลว:', err);
  else console.log('เชื่อมต่อ Database เรียบร้อย');
});

app.post('/api/register', (req, res) => {
  const { name, username, email, password } = req.body;
  const role = 'user';
  const sql = 'INSERT INTO users (name, username, email, password, role) VALUES (?, ?, ?, ?, ?)';
  
  db.query(sql, [name, username, email, password, role], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'สมัครสมาชิกเรียบร้อย!' });
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const sql = 'SELECT * FROM users WHERE username = ? AND password = ?';
  
  db.query(sql, [username, password], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length > 0) {
      res.json({ message: 'เข้าสู่ระบบสำเร็จ', user: results[0] });
    } else {
      res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
  });
});

app.get('/api/prices', (req, res) => {
  const sql = 'SELECT * FROM waste_types';
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.get('/api/user/:id', (req, res) => {
    const userId = req.params.id;
    const sql = 'SELECT * FROM users WHERE id = ?';

    db.query(sql, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json(results[0]);
    });
});


app.get('/api/users', (req, res) => {
  const sql = 'SELECT id, name, username, email FROM users ORDER BY id ASC';
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.get('/api/bookdetail', (req, res) => {
  const sql = 'SELECT * FROM bookings ORDER BY id ASC';
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: err.message});
    res.json(results);
  });
});


app.post('/api/cfBooking', (req, res) => {
  const { userId, lineUserId, date, time, latitude, longitude, bookname, booktel} = req.body;
  const status = 'pending';

  const sql = `INSERT INTO bookings (user_id, bookname, booking_date, booking_time, status, latitude, longitude, booking_at, booktel) 
               VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)`;

  db.query(sql, [userId, bookname, date, time, status, latitude, longitude , booktel], async (err, result) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    

    if (lineUserId) {
        try {
            await fetch('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
                },
                body: JSON.stringify({
                    to: lineUserId,
                    messages: [
                        {
                            type: 'text',
                            text: `✅ ยืนยันการนัดหมายเรียบร้อย!\n\nชื่อผู้นัดหมาย: ${bookname}\nเบอร์โทร: ${booktel}\nวันที่นัดหมาย: ${date}\nเวลา: ${time}\nสถานะ: ${status}\n\nระบบได้รับข้อมูลนัดหมายของคุณเข้าสู่ระบบแล้วครับ`
                        },
                        {
                            type: 'location',
                            title: 'พิกัดสถานที่นัดหมาย',
                            address: 'ตำแหน่งที่เลือก',
                            latitude: parseFloat(latitude),
                            longitude: parseFloat(longitude)
                        }
                    ]
                })
            });
            console.log('ส่งการแจ้งเตือน LINE สำเร็จ');
        } catch (lineErr) {
            console.error('เกิดข้อผิดพลาดในการส่งข้อความ LINE:', lineErr);
        }
    }

    res.json({ message: 'ยืนยันการนัดหมายเรียบร้อยแล้ว!' });
  });

  

});

app.post('/api/process-waste', async (req, res) => {
    const { booking_id, items } = req.body;

    if (!booking_id || !items || items.length === 0) {
        return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
    }

    // เรียกใช้ฟีเจอร์ Promise ของ mysql2 เพื่อให้ใช้ async/await ได้ง่ายๆ
    const promiseDb = db.promise(); 

    try {
        await promiseDb.query('BEGIN'); // เริ่ม Transaction เผื่อมีข้อผิดพลาดจะได้ยกเลิกทัน
        let totalPrice = 0;
        let summaryText = '♻️ สรุปรายการรับซื้อขยะ Project Rebin\n\n'; 

        for (let item of items) {
            // 1. ดึงราคาล่าสุดของขยะแต่ละประเภท
            const [rows] = await promiseDb.query('SELECT price_per_kg FROM waste_types WHERE waste_name = ?', [item.waste_name]);
            
            if (rows.length === 0) {
                throw new Error(`ไม่พบประเภทขยะ: ${item.waste_name}`);
            }
            
            const price_per_kg = rows[0].price_per_kg;
            const total_price = price_per_kg * item.weight;
            totalPrice += total_price;

            summaryText += `- ${item.waste_name}: ${item.weight} กก. (${total_price.toFixed(2)} บาท)\n`;

            // 2. บันทึกลงตาราง booking_details (คุณสามารถปรับชื่อคอลัมน์ให้ตรงกับฐานข้อมูลจริงได้)
            await promiseDb.query(
                'INSERT INTO booking_details (booking_id, waste_name, weight, price_per_kg, total_price) VALUES (?, ?, ?, ?, ?)',
                [booking_id, item.waste_name, item.weight, price_per_kg, total_price]
            );
        }
        summaryText += `\n💰 ราคารวมทั้งหมด: ${totalPrice.toFixed(2)} บาท\n📌 สถานะ: ทำรายการเสร็จสิ้น (Complete)`;

        // 3. อัปเดตสถานะการจองในตาราง bookings ว่าจัดการเสร็จแล้ว
        await promiseDb.query('UPDATE bookings SET status = ? WHERE id = ?', ['complete', booking_id]);

        const [userRows] = await promiseDb.query(`
            SELECT u.id AS user_id, u.line_id
            FROM bookings b 
            JOIN users u ON b.user_id = u.id 
            WHERE b.id = ?
        `, [booking_id]);

        if (userRows.length > 0) {
            const userId = userRows[0].user_id;

            // 5. อัปเดตยอดเงินเข้า Wallet ของลูกค้านี้ (เอาของเดิม + ยอดใหม่)
            await promiseDb.query(
                'UPDATE users SET wallet_balance = IFNULL(wallet_balance, 0) + ? WHERE id = ?',
                [totalPrice, userId]
            );
        }

        

        await promiseDb.query('COMMIT');

        if (userRows.length > 0 && userRows[0].line_id) {
            const lineUserId = userRows[0].line_id;

            try {
                await fetch('https://api.line.me/v2/bot/message/push', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
                    },
                    body: JSON.stringify({
                        to: lineUserId,
                        messages: [
                            {
                                type: 'text',
                                text: summaryText
                            },
                            {
                                
                                type: 'text',
                                text: `💸 ยอดเงินจำนวน ${totalPrice.toFixed(2)} บาท ถูกเพิ่มเข้า Wallet ของคุณเรียบร้อยแล้ว\n สามารถเช็คยอดเงินได้ที่เมนู Wallet ครับ!`
                            }
                        ]
                    })
                });
                console.log('ส่งใบเสร็จแจ้งเตือน LINE สำเร็จ');
            } catch (lineErr) {
                console.error('เกิดข้อผิดพลาดในการส่งข้อความ LINE:', lineErr);
            }
        }

        res.json({ message: 'บันทึกสำเร็จ', total_price: totalPrice.toFixed(2) });

    } catch (err) {
        await promiseDb.query('ROLLBACK'); // หากมี Error ให้ยกเลิกสิ่งที่ทำมาทั้งหมด
        console.error('Error in process-waste:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/update-line-id', (req, res) => {
    const { userId, lineUserId } = req.body;

    if (!userId || !lineUserId) {
        return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
    }

    const sql = 'UPDATE users SET line_id = ? WHERE id = ?';
    db.query(sql, [lineUserId, userId], (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: 'บันทึก LINE ID สำเร็จ' });
    });
});

app.post('/api/send-alert', async (req, res) => {
    const { booking_id, type } = req.body;
    
    let messageText = '';

    // เช็กเคสว่าส่งมาจากปุ่มไหน
    switch (type) {
        case 'coming':
            messageText = '🚗 เจ้าหน้าที่กำลังเดินทางไปหา! \n โปรดเตรียมขยะรอไว้ให้เรียบร้อย';
            break;

    }

    try {
        const promiseDb = db.promise();
        
        // 1. ค้นหา line_id ของลูกค้าจาก booking_id ที่ส่งมา
        const [userRows] = await promiseDb.query(`
            SELECT u.line_id 
            FROM bookings b 
            JOIN users u ON b.user_id = u.id 
            WHERE b.id = ?
        `, [booking_id]);

        // ตรวจสอบว่ามี line_id ในฐานข้อมูลหรือไม่
        if (userRows.length === 0 || !userRows[0].line_id) {
            return res.status(404).json({ error: 'ไม่พบข้อมูล LINE ID ของลูกค้ารายนี้' });
        }

        const lineUserId = userRows[0].line_id;

        // 2. ส่งข้อความผ่าน LINE API
        await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
            },
            body: JSON.stringify({
                to: lineUserId,
                messages: [
                    { 
                        type: 'text', 
                        text: `🔔 มีการแจ้งเตือน 🔔\n\n${messageText}` 
                    }
                ]
            })
        });

        

        res.json({ message: 'ส่งการแจ้งเตือนตามเคสสำเร็จ' });
    } catch (err) {
        console.error('Error sending alert:', err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});

