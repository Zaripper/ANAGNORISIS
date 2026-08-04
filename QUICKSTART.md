# Parapharmacy ERP - Quick Start Guide

## Prerequisites
- PostgreSQL 16+ installed and running
- Node.js 18+ installed
- Git (optional)

## 1. PostgreSQL Setup (Windows)

### Option A: Direct Installation
1. Download PostgreSQL 16+ from https://www.postgresql.org/download/windows/
2. Run the installer
3. Note your password for the `postgres` user
4. Open pgAdmin or psql command line
5. Create a database:
   ```sql
   CREATE DATABASE anagnorisis;
   ```

### Option B: Windows Subsystem for Linux (WSL)
```bash
wsl
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib
sudo service postgresql start
psql -U postgres -c "CREATE DATABASE anagnorisis;"
```

## 2. Environment Configuration

Create a `.env` file in the `server/` directory:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/anagnorisis
PORT=5000
CORS_ORIGIN=*
NODE_ENV=development
```

Replace `YOUR_PASSWORD` with your PostgreSQL password.

## 3. Database Setup

From the project root:

```bash
# Install all dependencies
npm install

# Push Prisma schema to database
npm run db:push

# Seed with demo data (2 users, 2 depots, 3 partners, 4 articles with prices & stocks)
npm run db:seed
```

## 4. Start the Prototype

### Terminal 1 - API Server
```bash
npm run dev --workspace server
```
Should output: `✅ API Server listening on 0.0.0.0:5000`

### Terminal 2 - Desktop App (in new terminal)
```bash
npm run dev --workspace desktop
```
Will launch Electron window with React UI.

## 5. First Login

**Username:** `admin`  
**Password:** `admin123`

Or use: `caissier` / `caissier123`

## 6. Demo Data Includes

### Users
- admin (ADMINISTRATEUR)
- caissier (CAISSIER)

### Depots
- SHOW_ROOM
- DEPOT_PRINCIPAL

### Partners
- ABBA151 (DETAILLANT) - Solde limit: 10,000
- PHARMA_GROSS (GROSSISTE) - Solde limit: 50,000
- VENTE_DIRECTE (VENTE_DIRECTE) - Solde limit: 5,000

### Articles (with Multi-Tier Prices)
- G22111 - ACNET AZELIKE PLUS SOIN INTENSIF 30ML
- A05001 - ASPIRIN 500MG TABLETTES
- V20022 - VITAMINE C 1000MG CAPSULES
- D15003 - DERMOFIX CREAM 50ML

Each article has prices for all 3 categories and stock in both depots.

## 7. Feature Checklist

### ✅ Complete
- [x] Database Schema (Prisma)
- [x] Seed Data (Multi-depot, multi-partner, multi-tier prices)
- [x] Authentication & Login
- [x] Express API with all CRUD endpoints
- [x] Bons de Préparation (Prep Slips) - Full form with live calculations
- [x] Saisie Achats (Purchase Entry) - Full workflow
- [x] Articles & Stock screen with multi-depot breakdown
- [x] Partners screen with transaction history & credit limit warnings
- [x] Cash Journal with transactions
- [x] P.U.M.P Auto-calculation on purchases
- [x] Stock Reservation (BON_PREPARATION)
- [x] Stock Consumption (VENTE validation)
- [x] Financial Calculations (HT, TVA, Timbre, TTC, Margin)
- [x] Dense classic-style UI with menu bar
- [x] Server IP configuration modal
- [x] Live data refresh (5-second polling)

### 🚀 Available Screens

1. **Bons de Préparation / Ventes**
   - Partner selection with credit limit warnings
   - Line item entry with live totals
   - Automatic price tier selection
   - Full financial footer

2. **Saisie Achats**
   - Purchase order entry
   - Auto PUMP calculation
   - Stock increase tracking

3. **Articles & Stocks**
   - Article list with PUMP
   - Multi-depot stock breakdown
   - Multi-tier price display
   - Available stock calculations

4. **Partenaires**
   - Partner list with balance & credit warnings
   - Transaction history per partner
   - Contact info display

5. **Caisse (Cash Journal)**
   - All cash transactions
   - Daily balance calculation
   - Incoming/outgoing tracking

## 8. API Endpoints Available

```
GET  /health                      - Health check
GET  /summary                     - Dashboard summary
POST /auth/login                  - User login
GET  /partners                    - All partners
POST /partners                    - Create partner
GET  /articles                    - All articles with prices & stocks
POST /articles                    - Create article
GET  /depots                      - All depots
POST /depots                      - Create depot
GET  /stocks                      - All stocks
GET  /documents                   - All documents
POST /documents                   - Create document (ACHAT, BON_PREPARATION, VENTE)
POST /documents/:id/validate      - Validate & finalize document
GET  /documents/:id               - Get document details
GET  /partners/:id/history        - Partner transaction history
GET  /articles/:id/details        - Article prices & stocks
GET  /cash                        - Cash journal with balance
```

## 9. Key Business Rules Implemented

✅ **P.U.M.P Calculation**: `(Stock_old × PUMP_old + Qty_new × Price_new) / (Stock_old + Qty_new)`

✅ **Stock Reservation**: BON_PREPARATION adds to `qtyReserved`

✅ **Stock Consumption**: VENTE validation deducts from `qtyInStock`

✅ **Financial Totals**:
- Total HT = Sum of line totals
- Remise = Document-level discount
- TVA = Per-line TVA calculation
- Timbre Fiscal = 1% of Total HT (ESPECE only)
- Total TTC = Total HT - Remise + TVA + Timbre
- Margin HT = Total HT - Sum of (Qty × PUMP)

✅ **Auto Cash Entry**: ESPECE payments auto-log in cash journal

✅ **Partner Credit Tracking**: All VENTE documents update partner balance

## 10. Network/LAN Setup

To access from other machines on the network:

1. Find your server machine IP:
   ```bash
   ipconfig  # Look for IPv4 Address (e.g., 192.168.1.100)
   ```

2. In the Electron app, click **Serveur** button (top-right)

3. Change URL from `http://127.0.0.1:5000/api` to:
   ```
   http://192.168.1.100:5000/api
   ```

4. Client machines on the LAN can now connect

## 11. Troubleshooting

### "Cannot connect to API"
- Ensure server is running: `npm run dev --workspace server`
- Check `DATABASE_URL` in `.env`
- Verify PostgreSQL is running
- Check firewall allows port 5000

### "Database error: permission denied"
- Ensure PostgreSQL user has permissions
- Re-run `npm run db:push` to update schema
- Check `DATABASE_URL` credentials

### "PORT 5000 already in use"
- Change PORT in `.env` file
- Or kill process: `lsof -i :5000` → `kill PID`

### Electron app won't launch
- Try: `npm run dev --workspace desktop` in new terminal
- Check Node modules installed: `npm install`

## 12. Next Steps for Production

1. Add authentication tokens (JWT)
2. Implement role-based access control
3. Add PDF/print templates
4. Backup & restore functionality
5. Audit logging
6. Multi-language support
7. Advanced reporting & exports
8. Database connection pooling
9. Performance optimization for 100+ articles
10. Mobile app or web-based dashboard

---

**Status**: ✅ Ready for local testing with full feature coverage

**Support**: Check server logs and browser console (F12) for debugging
