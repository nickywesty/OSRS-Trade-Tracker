const express = require('express');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const { engine } = require('express-handlebars');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Database setup - choose based on environment
let db;
if (process.env.POSTGRES_URL) {
  // Use Postgres for production (Vercel)
  db = require('./database/postgres-db');
} else {
  // Use SQLite for local development
  db = require('./database/db');
}

// Middleware setup
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
if (process.env.POSTGRES_URL) {
  // Use Postgres session store for production
  const pgSession = require('connect-pg-simple')(session);
  app.use(session({
    store: new pgSession({
      conString: process.env.POSTGRES_URL,
      createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || 'osrs-trading-tracker-secret-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));
} else {
  // Use SQLite session store for local development
  const SQLiteStore = require('connect-sqlite3')(session);
  app.use(session({
    store: new SQLiteStore({
      db: 'sessions.sqlite',
      dir: './database/'
    }),
    secret: 'osrs-trading-tracker-secret-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));
}

// Handlebars setup (template engine)
app.engine('hbs', engine({
  extname: '.hbs',
  defaultLayout: 'main',
  layoutsDir: path.join(__dirname, 'views/layouts/'),
  partialsDir: path.join(__dirname, 'views/partials/'),
  helpers: {
    // Helper functions for templates
    formatNumber: (num) => {
      if (!num && num !== 0) return '0';
      return new Intl.NumberFormat().format(num);
    },
    json: (context) => {
      return JSON.stringify(context);
    },
    formatGP: (num) => {
      if (!num && num !== 0) return '0 GP';
      if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M GP';
      } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K GP';
      }
      return Math.round(num).toString() + ' GP';
    },
    formatNetWorth: (num) => {
      if (!num && num !== 0) return '0.0M';
      if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
      } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
      }
      return Math.round(num).toString();
    },
    eq: (a, b) => a === b,
    gt: (a, b) => a > b,
    lt: (a, b) => a < b,
    math: (a, operator, b, operator2, c) => {
      if (operator2) {
        // Handle complex math like: a * b / c
        if (operator === '*' && operator2 === '/') {
          return Math.round((a * b) / c);
        }
      }
      // Handle simple math
      switch(operator) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return Math.round(a / b);
        default: return a;
      }
    },
    formatDate: (date) => {
      if (!date) return '';
      // Add time to avoid timezone issues
      const dateObj = new Date(date + 'T12:00:00');
      return dateObj.toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric'
      });
    },
    formatDateTime: (date) => {
      if (!date) return '';
      const dateObj = new Date(date);
      return dateObj.toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    },
    formatDecimal: (num, decimals) => {
      if (!num && num !== 0) return '0';
      return parseFloat(num).toFixed(decimals || 1);
    },
  }
}));

app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// File upload configuration
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv') {
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
    return res.redirect('/login');
  }
};

// Routes (we'll add these in the next steps)
const routes = require('./routes');
app.use('/', routes);

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).render('error', {
    error: 'Something went wrong!',
    layout: 'main'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    error: 'Page not found',
    layout: 'main'
  });
});

// Initialize database and start server
db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`🏰 OSRS Trading Tracker server running on port ${PORT}`);
    console.log(`📊 Visit: http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

module.exports = app;