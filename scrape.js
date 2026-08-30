const axios = require('axios');
const cheerio = require('cheerio');
const mysql = require('mysql2/promise');

// API Key ของ ScrapingBee 
const SCRAPINGBEE_API_KEY = 'BOA0ZNL9RKX05XCVQIBFY9127O4G81YTQA13D8P5214Z59GLB20V9EUUZCT4O0YEZI3T83TNPQQLKOHN';

// เชื่อมต่อ MySQL (Port 3306)
const dbConfig = {
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '', 
    database: 'smart_waste'
};

async function fetchAndUpdatePrices() {
    try {
        console.log('กำลังยิง Request ไปที่ ScrapingBee...');

        //ดึง HTML จาก ScrapingBee (ใช้ encodeURI ครอบ URL ภาษาไทย)
        const targetUrl = encodeURI('https://www.ทําลายเอกสารฟรี.com/price');
        
        const response = await axios.get('https://app.scrapingbee.com/api/v1', {
            headers: {
                'Authorization': `Bearer ${SCRAPINGBEE_API_KEY}`
            },
            params: {
                'url': 'https://www.ทําลายเอกสารฟรี.com/price',
                'country_code': 'th',
                'render_js': 'true'
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);

        console.log('ดึงข้อมูลสำเร็จ! กำลังแกะราคากลางขยะ...');

        // 2. แกะข้อมูลด้วย Cheerio
        
        const targetWasteTypes = ['พลาสติกรวม', 'แก้วขาว','แก้วแดง','แก้วรวม', 'กระดาษลัง', 'อลูมิเนียมกระป๋อง', 'ท่อ PVC ฟ้า', 'ลวด', 'เหล็กรวม', 'เหล็กหนา', 'เหล็กบาง', 'อลูมิเนียมเพลท', 'สแตนเลส', 'ตะกั่ว'];

        const scrapedMap = new Map();
        
        $('tbody tr').each((index, element) => {
            const rawName = $(element).find('td[data-label="ประเภท"]').text().trim();
            const rawPrice = $(element).find('td[data-label="ราคารับซื้อ"]').text().trim();

            // คลีนข้อความราคาให้เหลือเฉพาะตัวเลขและจุดทศนิยม
            const cleanPrice = rawPrice.replace(/[^0-9.]/g, '');
            const price = parseFloat(cleanPrice);

            // ค้นหาคำที่ตรงกับ Whitelist
            const matchedTarget = targetWasteTypes.find(target => rawName.includes(target));

            if (matchedTarget && !isNaN(price)) {
                scrapedMap.set(matchedTarget, { 
                    name: matchedTarget, 
                    price: price 
                });
            }
            
        });
        const scrapedItems = Array.from(scrapedMap.values());

        console.log('รายการที่แกะได้:', scrapedItems);

        // เซฟ waste_types ใน MySQL
        if (scrapedItems.length > 0) {
            const connection = await mysql.createConnection(dbConfig);
            
            for (const item of scrapedItems) {
                const sql = `
                    UPDATE waste_types 
                    SET price_per_kg = ?, update_at = NOW() 
                    WHERE waste_name LIKE ?
                `;
                await connection.query(sql, [item.price, `%${item.name}%`]);
            }

            await connection.end();
            console.log('อัปเดตราคากลางเข้า Database เรียบร้อยแล้ว!');
        } else {
            console.log('ไม่พบข้อมูลราคา กรุณาตรวจสอบ CSS Selector');
        }

    } catch (error) {
        console.error('เกิดข้อผิดพลาด:', error.response ? error.response.data : error.message);
    }
}

fetchAndUpdatePrices();