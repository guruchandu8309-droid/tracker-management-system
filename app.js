const express = require('express');
const path = require('path');
const { getPool, initDatabase, dbConfig } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// High performance middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cache-control and security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true
}));

// Helper to provide both camelCase (e.g. bus.busNumber, bus.busName) and snake_case properties
function formatBus(row) {
    if (!row) return null;
    return {
        ...row,
        // CamelCase properties (bus.busNumber, bus.busName, etc.)
        busNumber: row.bus_number,
        busName: row.bus_name,
        busType: row.bus_type,
        operatorName: row.operator_name,
        totalSeats: row.total_seats,
        departureTime: row.departure_time,
        arrivalTime: row.arrival_time,
        driverName: row.driver_name,
        driverContact: row.driver_contact,
        ticketPrice: row.ticket_price,
        manufacturingYear: row.manufacturing_year,
        registrationDate: row.registration_date,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

// ==========================================
// BUS REGISTRATION REST API (table: busregistrtion)
// ==========================================

// Health Check API
app.get('/api/health', async (req, res) => {
    const startTime = Date.now();
    try {
        const pool = await getPool();
        const [result] = await pool.query('SELECT 1 + 1 AS health, COUNT(*) AS count FROM busregistrtion');
        const latency = Date.now() - startTime;
        res.json({
            status: 'ONLINE',
            serverTime: new Date().toISOString(),
            database: {
                connected: true,
                host: dbConfig.host,
                database: dbConfig.database,
                table: 'busregistrtion',
                recordCount: result[0].count,
                latencyMs: latency
            }
        });
    } catch (err) {
        res.status(500).json({
            status: 'DEGRADED',
            serverTime: new Date().toISOString(),
            database: {
                connected: false,
                error: err.message
            }
        });
    }
});

// Aggregate Statistics & Fleet KPI
app.get('/api/stats', async (req, res) => {
    try {
        const pool = await getPool();
        const [statsRows] = await pool.query(`
            SELECT 
                COUNT(*) AS total_buses,
                SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) AS active_buses,
                SUM(CASE WHEN status = 'On Route' THEN 1 ELSE 0 END) AS on_route_buses,
                SUM(CASE WHEN status = 'Maintenance' THEN 1 ELSE 0 END) AS maintenance_buses,
                SUM(CASE WHEN status = 'Inactive' THEN 1 ELSE 0 END) AS inactive_buses,
                COALESCE(SUM(total_seats), 0) AS total_capacity,
                COALESCE(ROUND(AVG(ticket_price), 2), 0) AS avg_fare,
                COUNT(DISTINCT operator_name) AS total_operators,
                COUNT(DISTINCT CONCAT(source, '-', destination)) AS total_routes
            FROM busregistrtion
        `);

        const [typeBreakdown] = await pool.query(`
            SELECT bus_type, COUNT(*) AS count
            FROM busregistrtion
            GROUP BY bus_type
            ORDER BY count DESC
        `);

        res.json({
            summary: statsRows[0],
            byType: typeBreakdown
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch statistics: ' + err.message });
    }
});

// Get all buses (with Search, Status Filter, Type Filter, Sorting)
app.get('/api/buses', async (req, res) => {
    try {
        const { search, status, type, sort = 'id_desc' } = req.query;
        const pool = await getPool();

        let query = 'SELECT * FROM busregistrtion WHERE 1=1';
        const params = [];

        if (status && status !== 'all') {
            query += ' AND status = ?';
            params.push(status);
        }

        if (type && type !== 'all') {
            query += ' AND bus_type = ?';
            params.push(type);
        }

        if (search && search.trim()) {
            const term = `%${search.trim()}%`;
            query += ` AND (
                bus_number LIKE ? OR 
                bus_name LIKE ? OR 
                operator_name LIKE ? OR 
                driver_name LIKE ? OR 
                source LIKE ? OR 
                destination LIKE ?
            )`;
            params.push(term, term, term, term, term, term);
        }

        switch (sort) {
            case 'number_asc':
                query += ' ORDER BY bus_number ASC';
                break;
            case 'name_asc':
                query += ' ORDER BY bus_name ASC';
                break;
            case 'seats_desc':
                query += ' ORDER BY total_seats DESC';
                break;
            case 'price_desc':
                query += ' ORDER BY ticket_price DESC';
                break;
            case 'price_asc':
                query += ' ORDER BY ticket_price ASC';
                break;
            case 'id_asc':
                query += ' ORDER BY id ASC';
                break;
            case 'id_desc':
            default:
                query += ' ORDER BY id DESC';
                break;
        }

        const [buses] = await pool.query(query, params);
        res.json(buses.map(formatBus));
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve buses: ' + err.message });
    }
});

// Get single bus by ID
app.get('/api/buses/:id', async (req, res) => {
    try {
        const pool = await getPool();
        const [rows] = await pool.query('SELECT * FROM busregistrtion WHERE id = ?', [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Bus record not found.' });
        }
        res.json(formatBus(rows[0]));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch bus: ' + err.message });
    }
});

// Register a New Bus
app.post('/api/buses', async (req, res) => {
    try {
        const bus_number = req.body.busNumber || req.body.bus_number;
        const bus_name = req.body.busName || req.body.bus_name;
        const bus_type = req.body.busType || req.body.bus_type;
        const operator_name = req.body.operatorName || req.body.operator_name;
        const total_seats = req.body.totalSeats !== undefined ? req.body.totalSeats : req.body.total_seats;
        const source = req.body.source;
        const destination = req.body.destination;
        const departure_time = req.body.departureTime || req.body.departure_time;
        const arrival_time = req.body.arrivalTime || req.body.arrival_time;
        const driver_name = req.body.driverName || req.body.driver_name;
        const driver_contact = req.body.driverContact || req.body.driver_contact;
        const ticket_price = req.body.ticketPrice !== undefined ? req.body.ticketPrice : req.body.ticket_price;
        const status = req.body.status;
        const manufacturing_year = req.body.manufacturingYear || req.body.manufacturing_year;
        const notes = req.body.notes;

        // Validation
        if (!bus_number || !bus_number.trim()) {
            return res.status(400).json({ error: 'Bus Registration Number is required.' });
        }
        if (!bus_name || !bus_name.trim()) {
            return res.status(400).json({ error: 'Bus Name / Model is required.' });
        }
        if (!bus_type || !bus_type.trim()) {
            return res.status(400).json({ error: 'Bus Type is required.' });
        }
        if (!source || !source.trim() || !destination || !destination.trim()) {
            return res.status(400).json({ error: 'Source and Destination are required.' });
        }
        if (!driver_name || !driver_name.trim()) {
            return res.status(400).json({ error: 'Driver Name is required.' });
        }
        if (!driver_contact || !driver_contact.trim()) {
            return res.status(400).json({ error: 'Driver Contact number is required.' });
        }

        const cleanBusNumber = bus_number.trim().toUpperCase();
        const cleanSeats = parseInt(total_seats, 10) || 40;
        const cleanPrice = parseFloat(ticket_price) || 0.00;
        const cleanYear = parseInt(manufacturing_year, 10) || new Date().getFullYear();
        const validStatuses = ['Active', 'On Route', 'Maintenance', 'Inactive'];
        const cleanStatus = validStatuses.includes(status) ? status : 'Active';

        const pool = await getPool();

        // Check for duplicate bus number
        const [existing] = await pool.query('SELECT id FROM busregistrtion WHERE bus_number = ?', [cleanBusNumber]);
        if (existing.length > 0) {
            return res.status(409).json({ error: `A bus with registration number "${cleanBusNumber}" is already registered.` });
        }

        const insertQuery = `
            INSERT INTO busregistrtion (
                bus_number, bus_name, bus_type, operator_name, total_seats,
                source, destination, departure_time, arrival_time,
                driver_name, driver_contact, ticket_price, status,
                manufacturing_year, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            cleanBusNumber,
            bus_name.trim(),
            bus_type.trim(),
            (operator_name && operator_name.trim()) || 'Omni Transit Co.',
            cleanSeats,
            source.trim(),
            destination.trim(),
            (departure_time && departure_time.trim()) || '08:00 AM',
            (arrival_time && arrival_time.trim()) || '04:00 PM',
            driver_name.trim(),
            driver_contact.trim(),
            cleanPrice,
            cleanStatus,
            cleanYear,
            (notes && notes.trim()) || null
        ];

        const [result] = await pool.query(insertQuery, values);
        const [newBus] = await pool.query('SELECT * FROM busregistrtion WHERE id = ?', [result.insertId]);

        res.status(201).json({
            message: 'Bus registered successfully!',
            bus: formatBus(newBus[0])
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Bus registration number already exists.' });
        }
        res.status(500).json({ error: 'Registration failed: ' + err.message });
    }
});

// Update Existing Bus Registration
app.put('/api/buses/:id', async (req, res) => {
    try {
        const busId = req.params.id;
        const bus_number = req.body.busNumber || req.body.bus_number;
        const bus_name = req.body.busName || req.body.bus_name;
        const bus_type = req.body.busType || req.body.bus_type;
        const operator_name = req.body.operatorName || req.body.operator_name;
        const total_seats = req.body.totalSeats !== undefined ? req.body.totalSeats : req.body.total_seats;
        const source = req.body.source;
        const destination = req.body.destination;
        const departure_time = req.body.departureTime || req.body.departure_time;
        const arrival_time = req.body.arrivalTime || req.body.arrival_time;
        const driver_name = req.body.driverName || req.body.driver_name;
        const driver_contact = req.body.driverContact || req.body.driver_contact;
        const ticket_price = req.body.ticketPrice !== undefined ? req.body.ticketPrice : req.body.ticket_price;
        const status = req.body.status;
        const manufacturing_year = req.body.manufacturingYear || req.body.manufacturing_year;
        const notes = req.body.notes;

        const cleanBusNumber = bus_number ? bus_number.trim().toUpperCase() : null;
        const cleanSeats = total_seats ? parseInt(total_seats, 10) : undefined;
        const cleanPrice = ticket_price !== undefined ? parseFloat(ticket_price) : undefined;
        const cleanYear = manufacturing_year ? parseInt(manufacturing_year, 10) : undefined;
        const validStatuses = ['Active', 'On Route', 'Maintenance', 'Inactive'];
        const cleanStatus = validStatuses.includes(status) ? status : undefined;

        const pool = await getPool();

        // Check existence
        const [existing] = await pool.query('SELECT id, bus_number FROM busregistrtion WHERE id = ?', [busId]);
        if (existing.length === 0) {
            return res.status(404).json({ error: 'Bus not found.' });
        }

        // Check duplicate if bus_number changed
        if (cleanBusNumber && cleanBusNumber !== existing[0].bus_number) {
            const [dupe] = await pool.query('SELECT id FROM busregistrtion WHERE bus_number = ? AND id != ?', [cleanBusNumber, busId]);
            if (dupe.length > 0) {
                return res.status(409).json({ error: `Registration number "${cleanBusNumber}" is taken by another bus.` });
            }
        }

        const updateQuery = `
            UPDATE busregistrtion SET
                bus_number = COALESCE(?, bus_number),
                bus_name = COALESCE(?, bus_name),
                bus_type = COALESCE(?, bus_type),
                operator_name = COALESCE(?, operator_name),
                total_seats = COALESCE(?, total_seats),
                source = COALESCE(?, source),
                destination = COALESCE(?, destination),
                departure_time = COALESCE(?, departure_time),
                arrival_time = COALESCE(?, arrival_time),
                driver_name = COALESCE(?, driver_name),
                driver_contact = COALESCE(?, driver_contact),
                ticket_price = COALESCE(?, ticket_price),
                status = COALESCE(?, status),
                manufacturing_year = COALESCE(?, manufacturing_year),
                notes = COALESCE(?, notes)
            WHERE id = ?
        `;

        const values = [
            cleanBusNumber,
            bus_name ? bus_name.trim() : null,
            bus_type ? bus_type.trim() : null,
            operator_name ? operator_name.trim() : null,
            cleanSeats,
            source ? source.trim() : null,
            destination ? destination.trim() : null,
            departure_time ? departure_time.trim() : null,
            arrival_time ? arrival_time.trim() : null,
            driver_name ? driver_name.trim() : null,
            driver_contact ? driver_contact.trim() : null,
            cleanPrice,
            cleanStatus,
            cleanYear,
            notes !== undefined ? notes : null,
            busId
        ];

        await pool.query(updateQuery, values);
        const [updated] = await pool.query('SELECT * FROM busregistrtion WHERE id = ?', [busId]);

        res.json({
            message: 'Bus registration updated successfully!',
            bus: formatBus(updated[0])
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update bus: ' + err.message });
    }
});

// Delete a Bus Registration
app.delete('/api/buses/:id', async (req, res) => {
    try {
        const pool = await getPool();
        const [result] = await pool.query('DELETE FROM busregistrtion WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Bus registration not found.' });
        }
        res.json({ message: 'Bus registration deleted successfully.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete bus: ' + err.message });
    }
});

// Export Fleet to CSV
app.get('/api/export/csv', async (req, res) => {
    try {
        const pool = await getPool();
        const [rows] = await pool.query('SELECT * FROM busregistrtion ORDER BY id DESC');

        const headers = [
            'ID', 'Bus Number', 'Bus Name', 'Bus Type', 'Operator',
            'Seats', 'Source', 'Destination', 'Departure Time', 'Arrival Time',
            'Driver Name', 'Driver Contact', 'Ticket Price (INR)', 'Status', 'Mfg Year', 'Reg Date'
        ];

        let csv = headers.join(',') + '\n';
        rows.forEach(r => {
            const line = [
                r.id,
                `"${r.bus_number}"`,
                `"${r.bus_name}"`,
                `"${r.bus_type}"`,
                `"${r.operator_name}"`,
                r.total_seats,
                `"${r.source}"`,
                `"${r.destination}"`,
                `"${r.departure_time}"`,
                `"${r.arrival_time}"`,
                `"${r.driver_name}"`,
                `"${r.driver_contact}"`,
                r.ticket_price,
                `"${r.status}"`,
                r.manufacturing_year,
                `"${r.registration_date ? new Date(r.registration_date).toISOString().split('T')[0] : ''}"`
            ];
            csv += line.join(',') + '\n';
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="bus_registration_fleet.csv"');
        res.send(csv);
    } catch (err) {
        res.status(500).send('Export failed: ' + err.message);
    }
});

// Root route redirects to dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server with Database Initialization
async function start() {
    try {
        await initDatabase();
        app.listen(PORT, () => {
            console.log('====================================================');
            console.log(`🚍 Bus Registration Portal running at: http://localhost:${PORT}`);
            console.log(`📊 Connected to MySQL database: ${dbConfig.database}`);
            console.log(`📋 Managed Table: busregistrtion`);
            console.log('====================================================');
        });
    } catch (err) {
        console.error('Fatal: Could not initialize database and server:', err);
        process.exit(1);
    }
}

start();
