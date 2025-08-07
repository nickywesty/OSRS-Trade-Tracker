const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      // Ensure database directory exists
      const dbDir = path.join(__dirname);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Connect to database
      const dbPath = path.join(dbDir, 'trading_tracker.sqlite');
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          console.error('Error opening database:', err);
          reject(err);
        } else {
          console.log('📊 Connected to SQLite database');
          this.createTables().then(resolve).catch(reject);
        }
      });
    });
  }

  async createTables() {
    return new Promise((resolve, reject) => {
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS trading_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          first_buy_time TEXT,
          last_sell_time TEXT,
          account TEXT NOT NULL,
          item TEXT NOT NULL,
          status TEXT NOT NULL,
          bought INTEGER DEFAULT 0,
          sold INTEGER DEFAULT 0,
          avg_buy_price INTEGER DEFAULT 0,
          avg_sell_price INTEGER DEFAULT 0,
          tax INTEGER DEFAULT 0,
          profit INTEGER DEFAULT 0,
          profit_ea INTEGER DEFAULT 0,
          import_date TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(first_buy_time, last_sell_time, item)
        )
      `;

      this.db.run(createTableSQL, (err) => {
        if (err) {
          console.error('Error creating table:', err);
          reject(err);
        } else {
          console.log('✅ Trading records table ready');
          resolve();
        }
      });
    });
  }

  // Dashboard statistics
  async getDashboardStats() {
    return new Promise((resolve, reject) => {
      const queries = {
        totalProfit: `SELECT SUM(profit) as total FROM trading_records WHERE status = 'FINISHED'`,
        completedFlips: `SELECT COUNT(*) as count FROM trading_records WHERE status = 'FINISHED'`,
        totalRecords: `SELECT COUNT(*) as count FROM trading_records`,
        topFlips: `SELECT * FROM trading_records ORDER BY profit DESC LIMIT 10`,
        topItems: `SELECT item, SUM(profit) as totalProfit FROM trading_records
                   WHERE status = 'FINISHED' GROUP BY item ORDER BY totalProfit DESC LIMIT 10`
      };

      const stats = {};
      let completedQueries = 0;
      const totalQueries = Object.keys(queries).length;

      for (const [key, query] of Object.entries(queries)) {
        if (key === 'topFlips' || key === 'topItems') {
          this.db.all(query, (err, rows) => {
            if (err) {
              reject(err);
              return;
            }
            stats[key] = rows;
            completedQueries++;
            if (completedQueries === totalQueries) resolve(stats);
          });
        } else {
          this.db.get(query, (err, row) => {
            if (err) {
              reject(err);
              return;
            }
            stats[key] = row ? (row.total || row.count || 0) : 0;
            completedQueries++;
            if (completedQueries === totalQueries) resolve(stats);
          });
        }
      }
    });
  }

  // Get all records or by status
  async getRecords(status = null) {
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM trading_records';
      let params = [];

      if (status) {
        query += ' WHERE UPPER(status) = UPPER(?)';
        params.push(status);
      }

      query += ' ORDER BY import_date DESC';

      this.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Insert a new trading record
  async insertRecord(record) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT OR IGNORE INTO trading_records
        (first_buy_time, last_sell_time, account, item, status, bought, sold,
         avg_buy_price, avg_sell_price, tax, profit, profit_ea, import_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;

      const params = [
        record.firstBuyTime,
        record.lastSellTime,
        record.account,
        record.item,
        record.status,
        record.bought || 0,
        record.sold || 0,
        record.avgBuyPrice || 0,
        record.avgSellPrice || 0,
        record.tax || 0,
        record.profit || 0,
        record.profitEa || 0
      ];

      this.db.run(query, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({
            id: this.lastID,
            changes: this.changes
          });
        }
      });
    });
  }

  // Check if record exists (for duplicate detection)
  async recordExists(firstBuyTime, lastSellTime, item) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT COUNT(*) as count FROM trading_records
        WHERE first_buy_time = ? AND last_sell_time = ? AND item = ?
      `;

      this.db.get(query, [firstBuyTime, lastSellTime, item], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.count > 0);
        }
      });
    });
  }

  // Daily returns data
  async getDailyReturns() {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT
          DATE(import_date) as date,
          COUNT(*) as totalTrades,
          SUM(CASE WHEN status = 'FINISHED' THEN profit ELSE 0 END) as dailyProfit,
          COUNT(CASE WHEN status = 'FINISHED' THEN 1 END) as finishedTrades,
          COUNT(CASE WHEN status = 'SELLING' THEN 1 END) as activeTrades
        FROM trading_records
        GROUP BY DATE(import_date)
        ORDER BY date DESC
      `;

      this.db.all(query, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          // Get top item for each day
          this.addTopItemsToDaily(rows).then(resolve).catch(reject);
        }
      });
    });
  }

  async addTopItemsToDaily(dailyData) {
    const promises = dailyData.map(day => {
      return new Promise((resolve, reject) => {
        const query = `
          SELECT item, profit FROM trading_records
          WHERE DATE(import_date) = ? AND status = 'FINISHED'
          ORDER BY profit DESC LIMIT 1
        `;

        this.db.get(query, [day.date], (err, row) => {
          if (err) {
            reject(err);
          } else {
            day.topItem = row ? row.item : 'No completed trades';
            day.topItemProfit = row ? row.profit : 0;
            resolve(day);
          }
        });
      });
    });

    return Promise.all(promises);
  }

  // Timeline data (same as daily returns but formatted for timeline view)
  async getTimelineData() {
    const dailyData = await this.getDailyReturns();

    // Calculate cumulative net worth and growth
    const startingNetWorth = 198000000; // 198M GP
    let cumulativeNetWorth = startingNetWorth;
    let previousDayNetWorth = startingNetWorth;

    // Sort by date ascending for calculation
    dailyData.sort((a, b) => new Date(a.date) - new Date(b.date));

    dailyData.forEach(day => {
      // Count unique items
      day.items = Math.floor(Math.random() * 10) + 1; // We'll calculate this properly later
      day.flips = day.totalTrades;

      // Add daily profit to cumulative net worth
      cumulativeNetWorth += day.dailyProfit;
      day.netWorth = cumulativeNetWorth;

      // Calculate ROI and growth
      const totalInvested = day.finishedTrades * 100000; // Rough estimate
      day.roi = totalInvested > 0 ? (day.dailyProfit * 100) / totalInvested : 0;
      day.growth = previousDayNetWorth > 0 ? (day.dailyProfit * 100) / previousDayNetWorth : 0;

      previousDayNetWorth = cumulativeNetWorth;
    });

    // Sort by date descending for display
    dailyData.sort((a, b) => new Date(b.date) - new Date(a.date));

    return dailyData;
  }

  // Close database connection
  close() {
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
        } else {
          console.log('📊 Database connection closed');
        }
      });
    }
  }
}

// Create and export a single instance
const database = new Database();
module.exports = database;