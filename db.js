const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Read .env file without requiring external dependency
function loadEnv() {
    try {
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            content.split(/\r?\n/).forEach(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                    const idx = trimmed.indexOf('=');
                    const key = trimmed.substring(0, idx).trim();
                    const val = trimmed.substring(idx + 1).trim();
                    if (!process.env[key]) {
                        process.env[key] = val;
                    }
                }
            });
        }
    } catch (e) {
        console.error('Warning: could not read .env file', e.message);
    }
}

loadEnv();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '961876@Gc',
    database: process.env.DB_NAME || 'bus_db',
    waitForConnections: true,
    connectionLimit: 15,
    maxIdle: 10,
    idleTimeout: 60000,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
};

let pool = null;

async function getPool() {
    if (!pool) {
        pool = mysql.createPool(dbConfig);
    }
    return pool;
}

async function initDatabase() {
    console.log('[DB] Connecting to MySQL Server at ' + dbConfig.host + ':' + dbConfig.port + '...');
    
    // Connect to server to ensure database exists
    const serverConn = await mysql.createConnection({
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.user,
        password: dbConfig.password
    });

    await serverConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`[DB] Database '${dbConfig.database}' is ready.`);
    await serverConn.end();

    // Use connection pool with the database
    const dbPool = await getPool();

    // Create table: busregistrtion (as explicitly requested)
    const createTableSQL = `
        CREATE TABLE IF NOT EXISTS busregistrtion (
            id INT AUTO_INCREMENT PRIMARY KEY,
            bus_number VARCHAR(50) NOT NULL UNIQUE,
            bus_name VARCHAR(100) NOT NULL,
            bus_type VARCHAR(50) NOT NULL,
            operator_name VARCHAR(100) NOT NULL DEFAULT 'Omni Transit Co.',
            total_seats INT NOT NULL DEFAULT 40,
            source VARCHAR(100) NOT NULL,
            destination VARCHAR(100) NOT NULL,
            departure_time VARCHAR(20) DEFAULT '08:00 AM',
            arrival_time VARCHAR(20) DEFAULT '04:00 PM',
            driver_name VARCHAR(100) NOT NULL,
            driver_contact VARCHAR(25) NOT NULL,
            ticket_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
            status ENUM('Active', 'On Route', 'Maintenance', 'Inactive') NOT NULL DEFAULT 'Active',
            manufacturing_year INT DEFAULT 2024,
            registration_date DATE DEFAULT (CURRENT_DATE),
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_bus_number (bus_number),
            INDEX idx_status (status),
            INDEX idx_source_dest (source, destination)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    await dbPool.query(createTableSQL);
    console.log('[DB] Table `busregistrtion` verified and ready.');

    // Seed realistic sample buses if table is empty
    const [countRows] = await dbPool.query('SELECT COUNT(*) AS total FROM busregistrtion');
    if (countRows[0].total === 0) {
        console.log('[DB] Seeding initial fleet into `busregistrtion` table...');
        const initialFleet = [
            [
                'DL-01-AX-1011',
                'Volvo 9600 Multi-Axle',
                'AC Sleeper (2+1)',
                'Royal Express Travels',
                36,
                'New Delhi',
                'Manali',
                '07:30 PM',
                '08:00 AM',
                'Rajesh Sharma',
                '+91 98112 34567',
                1850.00,
                'Active',
                2024,
                '2024-03-15',
                'Equipped with Wi-Fi, USB charging, emergency panic button and GPS tracking.'
            ],
            [
                'KA-05-MB-2022',
                'Scania Metrolink HD',
                'AC Semi-Sleeper (2+2)',
                'Kaveri Fleet Lines',
                44,
                'Bengaluru',
                'Hyderabad',
                '10:15 PM',
                '06:45 AM',
                'Kiran Reddy',
                '+91 98450 77889',
                1100.00,
                'On Route',
                2023,
                '2023-08-20',
                'On schedule. Live GPS tracking active on National Highway 44.'
            ],
            [
                'MH-12-TR-3033',
                'BharatBenz Gliderz',
                'AC Sleeper (2+1)',
                'Sahyadri Superfast',
                34,
                'Mumbai',
                'Goa',
                '08:45 PM',
                '07:15 AM',
                'Vikram Shinde',
                '+91 99220 11223',
                1600.00,
                'Active',
                2024,
                '2024-01-10',
                'Dual climate control, reading lights and individual entertainment screens.'
            ],
            [
                'TN-09-EV-4044',
                'Ashok Leyland Oyster EV',
                'Electric AC Coach',
                'GreenWay Eco Transit',
                42,
                'Chennai',
                'Bengaluru',
                '06:00 AM',
                '11:30 AM',
                'M. Anbarasan',
                '+91 94440 55667',
                750.00,
                'On Route',
                2025,
                '2025-02-01',
                'Zero emissions 100% electric intercity coach with regenerative braking.'
            ],
            [
                'TS-08-CT-5055',
                'Tata Starbus Ultra',
                'Non-AC Seater (2+2)',
                'CityConnect Shuttle',
                52,
                'Hyderabad',
                'Warangal',
                '07:00 AM',
                '10:30 AM',
                'Srinivas Rao',
                '+91 98660 33445',
                320.00,
                'Active',
                2022,
                '2022-11-05',
                'Daily commuter express service with luggage rack.'
            ],
            [
                'GJ-01-MZ-6066',
                'Mercedes-Benz SuperHigh',
                'Ultra Luxury AC Sleeper',
                'Apex Platinum Wings',
                32,
                'Ahmedabad',
                'Udaipur',
                '11:00 PM',
                '05:30 AM',
                'Mahesh Dave',
                '+91 98250 88990',
                1400.00,
                'Maintenance',
                2023,
                '2023-06-12',
                'Routine 50,000 km brake pad inspection and AC filter servicing.'
            ]
        ];

        const insertQuery = `
            INSERT INTO busregistrtion 
            (bus_number, bus_name, bus_type, operator_name, total_seats, source, destination, departure_time, arrival_time, driver_name, driver_contact, ticket_price, status, manufacturing_year, registration_date, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        for (const bus of initialFleet) {
            await dbPool.query(insertQuery, bus);
        }
        console.log(`[DB] Successfully seeded ${initialFleet.length} buses into \`busregistrtion\`.`);
    }

    const [rows] = await dbPool.query('SELECT COUNT(*) AS total FROM busregistrtion');
    console.log(`[DB] Total registered buses currently in database: ${rows[0].total}`);
}

module.exports = {
    getPool,
    initDatabase,
    dbConfig
};

