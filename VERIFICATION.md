# Post-Setup Verification Checklist

After running `npm run db:push` and `npm run db:seed`, use this checklist to verify all system components are working.

## ✅ Database Verification

### Check PostgreSQL Connection
```bash
# From server/ directory (or project root)
npm run db:generate
# Should succeed with: ✔ Generated Prisma Client
```

### Verify Database Contains Seed Data
```bash
# Connect to PostgreSQL
psql -U postgres -d anagnorisis

# Run these queries:
SELECT COUNT(*) FROM "User";              -- Should return 2
SELECT COUNT(*) FROM "Depot";             -- Should return 2
SELECT COUNT(*) FROM "Partner";           -- Should return 3
SELECT COUNT(*) FROM "Article";           -- Should return 4
SELECT COUNT(*) FROM "ArticlePrice";      -- Should return 12 (4 articles × 3 tiers)
SELECT COUNT(*) FROM "ArticleStock";      -- Should return 8 (4 articles × 2 depots)
```

Expected output:
```
 count
-------
      2

 count
-------
      2

 count
-------
      3

 count
-------
      4

 count
-------
     12

 count
-------
      8
```

## ✅ API Server Verification

### Start Server
```bash
npm run dev --workspace server
```

### Check Health Endpoint
```bash
# From another terminal
curl http://localhost:5000/health
```
Expected: `{"status":"ok","timestamp":"2026-07-22T..."}`

### Test Login Endpoint
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```
Expected: `{"id":"...","username":"admin","role":"ADMINISTRATEUR"}`

### Verify All Endpoints Respond
```bash
curl http://localhost:5000/api/partners
curl http://localhost:5000/api/articles
curl http://localhost:5000/api/depots
curl http://localhost:5000/api/stocks
curl http://localhost:5000/api/cash
```
Each should return JSON array/object (not 500 error).

## ✅ Desktop App Verification

### Start Desktop App
```bash
npm run dev --workspace desktop
```
Should open Electron window with React UI.

### Test Login Screen
1. Enter Username: `admin`
2. Enter Password: `admin123`
3. Click Login
4. Should see main ERP interface

### Test Navigation Menu
- Click **Fichier** → Should show Partenaires, Articles, Dépôts
- Click **Mouvement** → Should show Saisie Achats, Bons de Préparation, Ventes, Caisse
- Click **Consultation** → Should show Stock Global, Extrait de Compte

### Test Bons de Préparation Screen
1. Navigate to **Mouvement** → **Bons de Préparation**
2. Click **[ + Nouveau ]**
3. In the Partner selector modal, click **ABBA151**
4. In Article search, type "G22111" and select
5. Enter quantity (e.g., 5)
6. Verify footer shows:
   - Total HT (calculated)
   - TVA amount (calculated)
   - Total TTC (with TVA)
   - Margin HT and % (calculated)
7. Click **[ 💾 Enregistrer ]** to save
8. Click **[ ✅ Valider ]** to finalize
9. Verify document number appears (should be BON_2026XXXXXXX format)

### Test Articles Screen
1. Navigate to **Fichier** → **Articles**
2. Verify 4 articles listed (G22111, A05001, V20022, D15003)
3. Click article to see side panel
4. Verify shows:
   - Designation
   - Multi-tier prices (DETAILLANT, GROSSISTE, VENTE_DIRECTE)
   - Stock in both depots (SHOW_ROOM, DEPOT_PRINCIPAL)

### Test Partners Screen
1. Navigate to **Fichier** → **Partenaires**
2. Click PHARMA_GROSS
3. Verify side panel shows:
   - Balance (Solde)
   - Credit limit (Seuil Autorisé)
   - Contact info
4. Verify transaction history section

### Test Cash Journal
1. Navigate to **Mouvement** → **Caisse**
2. Verify table shows columns: Date, Type, Mode, Amount, Ref, Notes
3. Should show any ESPECE sales as RECETTE entries

### Test Server IP Configuration
1. Click settings icon (⚙️) in top-right
2. Modal should open asking for API URL
3. Default: `http://localhost:5000`
4. For LAN testing, change to server IP: `http://[SERVER_IP]:5000`
5. Click Save
6. Verify data still loads (localStorage persists setting)

## ✅ Workflow Integration Test

### Complete Purchase to Sale Cycle
1. **Create Purchase (ACHAT)**
   - Navigate to **Mouvement** → **Saisie Achats**
   - Select depot: DEPOT_PRINCIPAL
   - Add article G22111, quantity 10, purchase price 50
   - Save document
   - Verify stock increased in Articles screen

2. **Check P.U.M.P Update**
   - Navigate to **Fichier** → **Articles**
   - Click G22111
   - Verify PUMP changed in side panel

3. **Create Bon de Préparation**
   - Navigate to **Mouvement** → **Bons de Préparation**
   - Select partner ABBA151
   - Add article G22111, quantity 3
   - Verify price tier matches DETAILLANT category
   - Save and validate

4. **Verify Stock Deduction**
   - Navigate to **Fichier** → **Articles**
   - Click G22111
   - Verify "Stock Disponible" decreased by 3

5. **Check Cash Entry**
   - Navigate to **Mouvement** → **Caisse**
   - If payment was ESPECE, should show new RECETTE entry

## ✅ Performance Checks

- [ ] Login response < 1 second
- [ ] Article search autocomplete < 500ms
- [ ] Partner selector modal opens < 1 second
- [ ] Document save completes < 2 seconds
- [ ] Stock updates visible immediately after validate
- [ ] UI responsive to menu clicks
- [ ] No console errors (F12 to check)

## 🔴 If Any Checks Fail

### Common Issues:

**Database Connection Error**
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```
→ PostgreSQL not running. Start it via Windows Services or command line.

**Port 5000 Already in Use**
```
Error: listen EADDRINUSE: address already in use :::5000
```
→ Change PORT in .env or kill process using port 5000.

**Wrong Password**
```
FATAL: password authentication failed for user "postgres"
```
→ Check DATABASE_URL in .env matches your PostgreSQL setup.

**Seed Data Not Found**
```
No articles appear in UI
```
→ Run `npm run db:seed` again to populate demo data.

**API Not Responding**
```
Error: Cannot connect to http://localhost:5000
```
→ Verify server is running: Check terminal output for "API Server listening"
→ If running on different machine (LAN), use actual IP address in desktop app settings.

## 📊 Success Indicators

✅ **System is fully operational when:**
- Login succeeds with admin/admin123
- All 4 screens navigate without errors
- API endpoints return data (view Network tab in F12)
- Document creation → Validation → Stock changes work end-to-end
- Financial totals update in real-time
- No TypeScript or JavaScript errors in console

✅ **Ready for multi-user LAN testing when:**
- All above + tested from different machine using server IP
- Multiple documents can be created without locks
- Stock updates visible across simultaneous client sessions

## 📞 Support

If any issues persist:
1. Check terminal output for error messages
2. Review IMPLEMENTATION_REPORT.md for complete feature list
3. Verify all prerequisites installed (PostgreSQL 16+, Node.js 18+)
4. Try: `npm run typecheck` to validate TypeScript
5. Try: `npm install` to ensure all dependencies present
