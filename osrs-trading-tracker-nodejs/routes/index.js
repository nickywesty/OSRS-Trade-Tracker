const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('../database/db');

// File upload configuration
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (req.session && req.session.isAdmin) {
    return next();
  } else {
    return res.redirect('/login?error=unauthorized');
  }
};

// Add helper to check auth status in templates
router.use((req, res, next) => {
  res.locals.isAdmin = req.session && req.session.isAdmin;
  next();
});

// Dashboard route
router.get('/', async (req, res) => {
  try {
    const stats = await db.getDashboardStats();

    res.render('dashboard', {
      title: '🏰 OSRS Trading Tracker - Grand Exchange Master',
      totalProfit: stats.totalProfit || 0,
      completedFlips: stats.completedFlips || 0,
      totalRecords: stats.totalRecords || 0,
      topFlips: stats.topFlips || [],
      topItems: stats.topItems || [],
      success: req.query.success,
      error: req.query.error,
      warning: req.query.warning,
      info: req.query.info
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.render('dashboard', {
      title: 'OSRS Trading Tracker',
      totalProfit: 0,
      completedFlips: 0,
      totalRecords: 0,
      topFlips: [],
      topItems: [],
      error: 'Failed to load dashboard data'
    });
  }
});

// Daily returns route
router.get('/daily-returns', async (req, res) => {
  try {
    const dailyReturns = await db.getDailyReturns();

    // Create weekly comparison data (last 7 days)
    const weekData = dailyReturns.slice(0, 7).reverse(); // Get last 7 days and reverse for chronological order
    const weekTotalProfit = weekData.reduce((sum, day) => sum + day.dailyProfit, 0);

    const weeklyComparison = {
      weekData: weekData,
      weekTotalProfit: weekTotalProfit
    };

    res.render('daily-returns', {
      title: '📅 Daily Returns - OSRS Trading Tracker',
      dailyReturns: dailyReturns,
      weeklyComparison: weeklyComparison
    });
  } catch (error) {
    console.error('Daily returns error:', error);
    res.render('daily-returns', {
      title: 'Daily Returns',
      dailyReturns: [],
      weeklyComparison: { weekData: [], weekTotalProfit: 0 },
      error: 'Failed to load daily returns data'
    });
  }
});

// Timeline route
router.get('/timeline', async (req, res) => {
  try {
    const timelineData = await db.getTimelineData();

    res.render('timeline', {
      title: '📊 Trading Timeline - OSRS Trading Tracker',
      timelineData: timelineData
    });
  } catch (error) {
    console.error('Timeline error:', error);
    res.render('timeline', {
      title: 'Trading Timeline',
      timelineData: [],
      error: 'Failed to load timeline data'
    });
  }
});

// Records routes
router.get('/records/:status?', async (req, res) => {
  try {
    const status = req.params.status;
    const records = await db.getRecords(status);

    res.render('records', {
      title: '📜 Trading Records - OSRS Trading Tracker',
      records: records,
      status: status
    });
  } catch (error) {
    console.error('Records error:', error);
    res.render('records', {
      title: 'Trading Records',
      records: [],
      status: req.params.status,
      error: 'Failed to load records'
    });
  }
});

// Login routes
router.get('/login', (req, res) => {
  const error = req.query.error;
  let errorMessage = '';

  if (error === 'invalid') {
    errorMessage = 'Invalid username or password. Try again, adventurer!';
  } else if (error === 'unauthorized') {
    errorMessage = 'You must be logged in to access that page.';
  }

  res.render('login', {
    title: '🏰 Admin Login - OSRS Trading Tracker',
    error: errorMessage,
    logout: req.query.logout === 'success' ? 'Successfully logged out. Safe travels!' : null
  });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // Simple hardcoded admin login (same as your Java version)
  // In production, you'd want to hash this password
  const adminUsername = 'admin';
  const adminPassword = 'Nickywest133054!!'; // Same as your Java version

  if (username === adminUsername && password === adminPassword) {
    req.session.isAdmin = true;
    res.redirect('/?success=' + encodeURIComponent('🛡️ Welcome back, Admin! You have full access to the realm.'));
  } else {
    res.redirect('/login?error=invalid');
  }
});

// Logout route
router.get('/logout', requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/login?logout=success');
  });
});

// Upload routes (admin only)
router.get('/upload', requireAuth, (req, res) => {
  res.render('upload', {
    title: '📤 Import Trading Data - OSRS Trading Tracker',
    success: req.query.success,
    error: req.query.error,
    warning: req.query.warning,
    info: req.query.info
  });
});

router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.redirect('/upload?error=' + encodeURIComponent('Please select a CSV file to upload.'));
  }

  try {
    const results = await processCsvFile(req.file.path);

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    const { newRecords, duplicates, errors, totalInDb } = results;

    if (newRecords > 0) {
      const message = `🎉 Import Complete! Added ${newRecords} new records. ` +
                     `📊 Skipped ${duplicates} duplicates. ` +
                     `🗃️ Total records: ${totalInDb}. ` +
                     `${errors > 0 ? '⚠️ ' + errors + ' errors encountered.' : '✅ No errors!'}`;
      res.redirect('/?success=' + encodeURIComponent(message));
    } else if (duplicates > 0) {
      const message = `⚠️ No new data imported. All ${duplicates} records were duplicates. ` +
                     `Your database already contains this data! 🗃️ Total records: ${totalInDb}`;
      res.redirect('/?warning=' + encodeURIComponent(message));
    } else {
      res.redirect('/upload?info=' + encodeURIComponent('ℹ️ No valid trading records found in the uploaded file. Please check the format.'));
    }

  } catch (error) {
    console.error('CSV processing error:', error);

    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.redirect('/upload?error=' + encodeURIComponent('💥 Error importing CSV file: ' + error.message));
  }
});

// CSV Processing function
async function processCsvFile(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    let newRecords = 0;
    let duplicates = 0;
    let errors = 0;

    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => {
        results.push(data);
      })
      .on('end', async () => {
        try {
          for (const row of results) {
            try {
              // Parse the CSV row (adjust field names to match your CSV)
              const record = {
                firstBuyTime: row['First buy time'] || row['first_buy_time'],
                lastSellTime: row['Last sell time'] || row['last_sell_time'],
                account: row['Account'] || row['account'],
                item: row['Item'] || row['item'],
                status: row['Status'] || row['status'],
                bought: parseInt(row['Bought'] || row['bought']) || 0,
                sold: parseInt(row['Sold'] || row['sold']) || 0,
                avgBuyPrice: parseInt(row['Avg. buy price'] || row['avg_buy_price']) || 0,
                avgSellPrice: parseInt(row['Avg. sell price'] || row['avg_sell_price']) || 0,
                tax: parseInt(row['Tax'] || row['tax']) || 0,
                profit: parseInt(row['Profit'] || row['profit']) || 0,
                profitEa: parseInt(row['Profit ea.'] || row['profit_ea']) || 0
              };

              // Check for duplicates
              const exists = await db.recordExists(record.firstBuyTime, record.lastSellTime, record.item);

              if (!exists) {
                const result = await db.insertRecord(record);
                if (result.changes > 0) {
                  newRecords++;
                }
              } else {
                duplicates++;
              }

            } catch (rowError) {
              console.error('Error processing row:', rowError);
              errors++;
            }
          }

          // Get total records count
          const stats = await db.getDashboardStats();
          const totalInDb = stats.totalRecords;

          resolve({
            newRecords,
            duplicates,
            errors,
            totalInDb
          });

        } catch (error) {
          reject(error);
        }
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

// API route for dashboard stats (if needed)
router.get('/api/stats', async (req, res) => {
  try {
    const stats = await db.getDashboardStats();
    res.json(stats);
  } catch (error) {
    console.error('API stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;