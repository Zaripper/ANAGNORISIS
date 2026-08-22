import React, { useEffect, useMemo, useRef, useState } from 'react';
import { computeDocTotals, type PaymentMode } from '@anagnorisis/shared';
import { Banknote, CreditCard, Landmark, Minus, Plus, Printer, ReceiptText, ScanBarcode, Trash2 } from 'lucide-react';
import { apiRequest } from '../services/apiClient';
import { CompanySettings, printHtml, ticketHtml } from '../services/print';
import { Badge, Select, ToastHost, money, useToasts } from '../components/ui';
import { Peremption, type Article, type Depot, type Partner } from '../ui/App';

/**
 * Caisse — point of sale for counter (retail) sales.
 *
 * Layout is a real POS: a product grid on the left (tap to add; the scan bar
 * filters it live) and the basket + payment panel on the right. A keyboard-wedge
 * barcode scanner types into the always-focused scan bar and presses Enter.
 *
 * Payment is immediate: create + validate in one action (stock out, client
 * ledger, cash journal for espèces) and the 80mm ticket prints.
 */

interface CartLine {
  articleId: string;
  code: string;
  designation: string;
  quantity: number;
  unitPriceHT: number;
  tvaRate: number;
  pump: number;
  available: number;
}

/** Deterministic pastel per article so the grid gets stable visual anchors without photos. */
const CARD_HUES = ['#0F5B38', '#1D4ED8', '#B45309', '#9333EA', '#0E7490', '#BE123C', '#4D7C0F', '#A16207'];
function hueFor(code: string): string {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return CARD_HUES[h % CARD_HUES.length];
}

export function POSScreen({
  articles,
  partners,
  depots,
  settings,
  cashierName,
  onSaved
}: {
  articles: Article[];
  partners: Partner[];
  depots: Depot[];
  settings: CompanySettings;
  cashierName?: string;
  onSaved: () => Promise<void>;
}) {
  const toasts = useToasts();
  const scanRef = useRef<HTMLInputElement>(null);

  const clients = useMemo(() => partners.filter((p) => !p.categoryIsSupplier), [partners]);
  const defaultClient = useMemo(() => clients.find((p) => p.code === 'COMPTOIR') ?? clients[0], [clients]);

  const [clientId, setClientId] = useState<string>('');
  const [depotId, setDepotId] = useState<string>('');
  const [scan, setScan] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  // Mirror updated synchronously: two scans in one event-loop tick must both see
  // the latest cart, or the second duplicates the line instead of incrementing.
  const cartRef = useRef<CartLine[]>(cart);
  function commitCart(next: CartLine[]) {
    cartRef.current = next;
    setCart(next);
  }
  // Onglet du catalogue: tous les articles, ou seulement les preferes.
  const [tab, setTab] = useState<'TOUS' | 'PREFERES'>('TOUS');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('ESPECE');
  const [tendered, setTendered] = useState<string>('');
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!clientId && defaultClient) setClientId(defaultClient.id);
  }, [defaultClient, clientId]);
  useEffect(() => {
    if (!depotId && depots.length) setDepotId((depots.find((d) => d.isDefault) ?? depots[0]).id);
  }, [depots, depotId]);

  const client = clients.find((c) => c.id === clientId) ?? defaultClient;

  function priceFor(article: Article): number {
    const tier = client ? article.pricesByCategory[client.categoryId] : undefined;
    return tier?.priceHT ?? article.priceHT ?? article.pump;
  }

  function availableFor(article: Article): number {
    const s = article.stocksByDepot[depotId];
    return s ? s.qtyInStock - s.qtyReserved : 0;
  }

  function addArticle(article: Article, qty = 1) {
    const current = cartRef.current;
    const inCart = current.find((l) => l.articleId === article.id);
    const available = availableFor(article);
    const wanted = (inCart?.quantity ?? 0) + qty;
    if (wanted > available) {
      toasts.error(`Stock insuffisant pour ${article.code} — disponible: ${available}.`);
      return;
    }
    // Produits rares: le serveur refuserait de toute facon, autant le dire tout de suite.
    if (article.maxQtyPerClient && wanted > article.maxQtyPerClient) {
      toasts.error(`${article.code} est limite a ${article.maxQtyPerClient} par client.`);
      return;
    }
    if (inCart) {
      commitCart(current.map((l) => (l.articleId === article.id ? { ...l, quantity: l.quantity + qty } : l)));
    } else {
      commitCart([
        ...current,
        {
          articleId: article.id,
          code: article.code,
          designation: article.designation,
          quantity: qty,
          unitPriceHT: priceFor(article),
          tvaRate: article.tvaRate,
          pump: article.pump,
          available
        }
      ]);
    }
    setScan('');
    scanRef.current?.focus();
  }

  /** The scan bar filters the product grid live; empty query shows the whole catalogue. */
  const gridArticles = useMemo(() => {
    const q = scan.trim().toLowerCase();
    // Une recherche explicite porte toujours sur tout le catalogue: on ne veut pas
    // qu'un article introuvable le soit seulement a cause de l'onglet actif.
    const pool = q || tab === 'TOUS' ? articles : articles.filter((a) => a.preferred);
    if (!q) return pool;
    return pool.filter(
      (a) => a.code.toLowerCase().includes(q) || a.designation.toLowerCase().includes(q) || (a.barcode ?? '').includes(q)
    );
  }, [scan, articles, tab]);

  const preferredCount = useMemo(() => articles.filter((a) => a.preferred).length, [articles]);

  /** Exact barcode first (what a scanner emits), then exact code, then unique grid match. */
  function resolveScan(raw: string): Article | null {
    const q = raw.trim();
    if (!q) return null;
    const byBarcode = articles.find((a) => a.barcode && a.barcode === q);
    if (byBarcode) return byBarcode;
    const byCode = articles.find((a) => a.code.toLowerCase() === q.toLowerCase());
    if (byCode) return byCode;
    return gridArticles.length === 1 ? gridArticles[0] : null;
  }

  function onScanKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const article = resolveScan(scan);
    if (article) addArticle(article);
    else if (scan.trim()) toasts.error(`Article introuvable: « ${scan.trim()} »`);
  }

  function setQty(articleId: string, qty: number) {
    commitCart(
      cartRef.current.map((l) => {
        if (l.articleId !== articleId) return l;
        const clamped = Math.max(1, Math.min(qty, l.available));
        if (qty > l.available) toasts.error(`Maximum disponible: ${l.available}`);
        return { ...l, quantity: clamped };
      })
    );
  }

  const totals = useMemo(
    () =>
      computeDocTotals(
        cart.map((l) => ({ quantity: l.quantity, unitPriceHT: l.unitPriceHT, discountPercent: 0, tvaRate: l.tvaRate, purchaseCostPUMP: l.pump })),
        0,
        paymentMode
      ),
    [cart, paymentMode]
  );

  const tenderedNum = Number(tendered.replace(',', '.')) || 0;
  const change = tenderedNum - totals.totalTTC;

  /**
   * `mode === 'CREDIT'` : vente portée au compte du client, sans encaissement
   * immédiat — le solde client est débité et aucune écriture de caisse n'est
   * générée. Sinon on encaisse selon le mode de règlement sélectionné.
   */
  async function pay(mode: PaymentMode | 'CREDIT' = paymentMode) {
    if (cart.length === 0 || !client || !depotId || paying) return;
    const credit = mode === 'CREDIT';
    // Une vente à crédit doit être imputée à un client identifié, pas au comptoir.
    if (credit && client.code === 'COMPTOIR') {
      toasts.error('Sélectionnez un client identifié pour une vente à crédit.');
      return;
    }
    // Le crédit est enregistré en TRAITE : pas de mouvement de caisse, pas de timbre.
    const effectiveMode: PaymentMode = credit ? 'TRAITE' : (mode as PaymentMode);
    if (!credit && effectiveMode === 'ESPECE' && tendered !== '' && tenderedNum < totals.totalTTC) {
      toasts.error('Montant reçu insuffisant.');
      return;
    }
    setPaying(true);
    try {
      const draft = await apiRequest<{ id: string }>('/documents', {
        method: 'POST',
        body: {
          type: 'VENTE',
          partnerId: client.id,
          depotId,
          paymentMode: effectiveMode,
          remise: 0,
          lines: cart.map((l) => ({
            articleId: l.articleId,
            depotId,
            quantity: l.quantity,
            unitPriceHT: l.unitPriceHT,
            discountPercent: 0,
            tvaRate: l.tvaRate
          }))
        }
      });
      const validated = await apiRequest<{ reference: string }>(`/documents/${draft.id}/validate`, { method: 'POST' });

      printHtml(
        ticketHtml(
          {
            reference: validated.reference,
            type: 'VENTE',
            date: new Date(),
            partnerName: client.raisonSociale,
            paymentMode: effectiveMode,
            totalHT: totals.totalHT,
            remise: 0,
            totalTVA: totals.totalTVA,
            stampDuty: totals.stampDuty,
            totalTTC: totals.totalTTC,
            lines: cart.map((l) => ({
              code: l.code,
              designation: l.designation,
              quantity: l.quantity,
              unitPriceHT: l.unitPriceHT,
              discountPercent: 0,
              tvaRate: l.tvaRate,
              totalHT: l.quantity * l.unitPriceHT
            }))
          },
          settings,
          {
            cashier: cashierName,
            cashReceived: !credit && effectiveMode === 'ESPECE' && tendered !== '' ? tenderedNum : undefined,
            change: !credit && effectiveMode === 'ESPECE' && tendered !== '' ? Math.max(change, 0) : undefined
          }
        )
      );

      toasts.success(
        credit ? `Vente ${validated.reference} portée au compte de ${client.raisonSociale}.` : `Vente ${validated.reference} encaissée.`
      );
      commitCart([]);
      setTendered('');
      await onSaved();
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : "Erreur lors de l'encaissement.");
    } finally {
      setPaying(false);
      scanRef.current?.focus();
    }
  }

  // Raccourcis repris du logiciel actuel : F8 encaisse en espèces, F6 vend à crédit.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F8') {
        e.preventDefault();
        setPaymentMode('ESPECE');
        pay('ESPECE');
      } else if (e.key === 'F6') {
        e.preventDefault();
        pay('CREDIT');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const PAY_MODES: { mode: PaymentMode; label: string; icon: React.ReactNode }[] = [
    { mode: 'ESPECE', label: 'Espèces', icon: <Banknote className="w-4 h-4" /> },
    { mode: 'CHEQUE', label: 'Chèque', icon: <ReceiptText className="w-4 h-4" /> },
    { mode: 'TRAITE', label: 'Traite', icon: <CreditCard className="w-4 h-4" /> },
    { mode: 'VIREMENT', label: 'Virement', icon: <Landmark className="w-4 h-4" /> }
  ];

  const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

  return (
    <div className="flex-1 flex gap-4 min-h-0">
      {/* ================= Left: scan + product grid ================= */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <div className="relative shrink-0">
          <ScanBarcode className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#0F5B38]" />
          <input
            ref={scanRef}
            autoFocus
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={onScanKey}
            placeholder="Scanner un code-barres ou rechercher un article…"
            className="w-full bg-white border-2 border-[#0F5B38]/25 rounded-2xl pl-12 pr-4 py-3.5 text-sm shadow-sm transition focus:outline-none focus:ring-4 focus:ring-[#0F5B38]/15 focus:border-[#0F5B38]"
          />
        </div>

        {preferredCount > 0 && (
          <div className="flex gap-1.5 shrink-0">
            {(['TOUS', 'PREFERES'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition ${
                  tab === t ? 'bg-[#0F5B38] text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {t === 'TOUS' ? `Tout le catalogue (${articles.length})` : `Preferes (${preferredCount})`}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
            {gridArticles.map((a) => {
              const available = availableFor(a);
              const hue = hueFor(a.code);
              const out = available <= 0;
              return (
                <button
                  key={a.id}
                  onClick={() => addArticle(a)}
                  disabled={out}
                  className={`text-left bg-white border border-slate-200 rounded-2xl p-3 flex flex-col gap-2 transition-all duration-150 ${
                    out ? 'opacity-45 cursor-not-allowed' : 'hover:border-[#0F5B38]/50 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[11px] font-extrabold shrink-0"
                      style={{ backgroundColor: hue }}
                    >
                      {a.designation.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge tone={out ? 'danger' : available <= 5 ? 'warning' : 'success'}>{available}</Badge>
                      {a.maxQtyPerClient ? <Badge tone="info">max {a.maxQtyPerClient}</Badge> : null}
                    </div>
                  </div>
                  <div className="text-[11px] font-semibold text-slate-800 leading-snug line-clamp-2 min-h-[2.1em]">{a.designation}</div>
                  {/*
                    PPA et péremption sur la vignette: le caissier vend face au
                    client, sans le temps d'ouvrir une fiche. Le PPA est le prix
                    public imprimé sur la boîte — c'est celui que le client lit,
                    et un écart avec le prix affiché se discute au comptoir.
                  */}
                  <div className="flex items-center justify-between gap-1 text-[9px] font-mono text-slate-400 min-h-[1.1em]">
                    <span>{a.ppa ? `PPA ${a.ppa.toFixed(2)}` : ''}</span>
                    <Peremption lots={a.lots} />
                  </div>
                  <div className="flex items-end justify-between mt-auto">
                    <span className="font-mono text-[9px] text-slate-400">{a.code}</span>
                    <span className="font-mono font-bold text-[13px] text-[#0F5B38]">{money(priceFor(a) * (1 + a.tvaRate / 100))}</span>
                  </div>
                </button>
              );
            })}
          </div>
          {gridArticles.length === 0 && (
            <div className="h-full flex items-center justify-center text-slate-400 text-xs py-16">Aucun article ne correspond à « {scan} ».</div>
          )}
        </div>
      </div>

      {/* ================= Right: basket + payment ================= */}
      <div className="w-[380px] shrink-0 flex flex-col gap-3 min-h-0">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-3 shrink-0 grid grid-cols-2 gap-2">
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client">
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.raisonSociale}
              </option>
            ))}
          </Select>
          <Select value={depotId} onChange={(e) => setDepotId(e.target.value)} aria-label="Dépôt">
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>

        {/* Basket */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between shrink-0">
            <span className="font-bold text-slate-900 text-xs">Panier</span>
            <span className="text-[10px] text-slate-400">{cart.reduce((s, l) => s + l.quantity, 0)} article(s)</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-50">
            {cart.map((l) => {
              const puTTC = l.unitPriceHT * (1 + l.tvaRate / 100);
              return (
                <div key={l.articleId} className="px-3.5 py-2.5 flex items-center gap-2.5 anim-fade">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold text-slate-800 truncate">{l.designation}</div>
                    <div className="font-mono text-[10px] text-slate-400">{money(puTTC)} × {l.quantity}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setQty(l.articleId, l.quantity - 1)}
                      className="w-6 h-6 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 transition"
                      aria-label="Diminuer"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-7 text-center font-mono font-bold text-xs">{l.quantity}</span>
                    <button
                      onClick={() => setQty(l.articleId, l.quantity + 1)}
                      className="w-6 h-6 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 transition"
                      aria-label="Augmenter"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <span className="font-mono font-bold text-xs w-20 text-right shrink-0">{money(puTTC * l.quantity)}</span>
                  <button
                    onClick={() => commitCart(cartRef.current.filter((x) => x.articleId !== l.articleId))}
                    className="text-slate-300 hover:text-rose-600 transition shrink-0"
                    aria-label={`Retirer ${l.code}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
            {cart.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-300 py-12">
                <ScanBarcode className="w-8 h-8" />
                <span className="text-[11px]">Scannez ou touchez un article</span>
              </div>
            )}
          </div>
        </div>

        {/* Payment */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 shrink-0 flex flex-col gap-3">
          <div className="grid grid-cols-4 gap-1.5">
            {PAY_MODES.map(({ mode, label, icon }) => (
              <button
                key={mode}
                onClick={() => setPaymentMode(mode)}
                className={`flex flex-col items-center gap-1 py-2 rounded-xl border text-[10px] font-semibold transition-all duration-150 ${
                  paymentMode === mode
                    ? 'bg-[#0F5B38] text-white border-[#0F5B38] shadow-sm'
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>

          {paymentMode === 'ESPECE' && (
            <div>
              <div className="flex gap-1.5 mb-1.5">
                {QUICK_AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setTendered(String((Number(tendered.replace(',', '.')) || 0) + amt))}
                    className="flex-1 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[10px] font-bold font-mono text-slate-600 transition"
                  >
                    +{amt}
                  </button>
                ))}
                <button
                  onClick={() => setTendered('')}
                  className="px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-rose-100 hover:text-rose-600 text-[10px] font-bold text-slate-500 transition"
                >
                  C
                </button>
              </div>
              <input
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') pay();
                }}
                placeholder="Espèces reçues"
                inputMode="decimal"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/40"
              />
              {tendered !== '' && (
                <div className={`mt-1.5 text-right font-mono font-bold text-sm ${change < 0 ? 'text-rose-600' : 'text-[#0F5B38]'}`}>
                  {change < 0 ? `Manque ${money(-change)}` : `À rendre ${money(change)}`}
                </div>
              )}
            </div>
          )}

          <div className="border-t border-slate-100 pt-3">
            <div className="flex justify-between text-[11px] text-slate-500 mb-0.5">
              <span>HT {money(totals.totalHT)}</span>
              <span>TVA {money(totals.totalTVA)}</span>
              {totals.stampDuty > 0 && <span>Timbre {money(totals.stampDuty)}</span>}
            </div>
            <div className="flex justify-between items-baseline">
              <span className="font-extrabold text-slate-900 text-sm">TOTAL</span>
              <span className="font-mono font-extrabold text-2xl text-[#0F5B38] tabular-nums">{money(totals.totalTTC)}</span>
            </div>
          </div>

          <button
            onClick={() => pay()}
            disabled={cart.length === 0 || paying}
            className="w-full bg-[#0F5B38] hover:bg-[#0b462b] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-2xl py-3.5 text-sm flex items-center justify-center gap-2 shadow-md shadow-[#0F5B38]/20 transition-all duration-150 active:scale-[0.99]"
          >
            <Printer className="w-4 h-4" />
            {paying ? 'Encaissement…' : 'Encaisser · imprimer'}
            <kbd className="ml-1 text-[9px] font-mono bg-white/15 rounded px-1.5 py-0.5">F8</kbd>
          </button>
          <button
            onClick={() => pay('CREDIT')}
            disabled={cart.length === 0 || paying}
            title="Porte la vente au compte du client, sans encaissement immédiat"
            className="w-full mt-1.5 bg-white border border-[#0F5B38]/30 text-[#0F5B38] hover:bg-[#0F5B38]/5 disabled:opacity-40 disabled:cursor-not-allowed font-bold rounded-2xl py-2.5 text-xs flex items-center justify-center gap-2 transition"
          >
            Vente à crédit
            <kbd className="text-[9px] font-mono bg-slate-100 rounded px-1.5 py-0.5">F6</kbd>
          </button>
        </div>
      </div>

      <ToastHost toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </div>
  );
}
