import React, { useEffect, useMemo, useRef, useState } from 'react';
import { computeDocTotals, type PaymentMode } from '@anagnorisis/shared';
import { apiRequest } from '../services/apiClient';
import { CompanySettings, printHtml, ticketHtml } from '../services/print';
import { Badge, Button, Card, Screen, Select, ToastHost, money, useToasts } from '../components/ui';
import type { Article, Depot, Partner } from '../ui/App';

/**
 * Caisse — point of sale for counter (retail) sales.
 *
 * Built scan-first: a barcode scanner behaves as a keyboard that types the code
 * and presses Enter, so the scan input keeps focus at all times and Enter adds
 * the article to the cart. Typing part of a name works too (live suggestions).
 *
 * Payment is immediate: the sale is created and validated in one go (stock out,
 * client ledger, cash journal entry for espèces) and the 80mm ticket prints.
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

  // Counter clients only make sense on the sales side.
  const clients = useMemo(() => partners.filter((p) => !p.categoryIsSupplier), [partners]);
  const defaultClient = useMemo(() => clients.find((p) => p.code === 'COMPTOIR') ?? clients[0], [clients]);

  const [clientId, setClientId] = useState<string>('');
  const [depotId, setDepotId] = useState<string>('');
  const [scan, setScan] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  // Mirror of `cart` that is updated synchronously: two scans landing in the same
  // event-loop tick (fast scanner, key repeat) must both see the latest cart, or
  // the second one duplicates the line instead of incrementing the quantity.
  const cartRef = useRef<CartLine[]>(cart);
  function commitCart(next: CartLine[]) {
    cartRef.current = next;
    setCart(next);
  }
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

  /** Selling price for the current client's category tier, falling back to cost. */
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

  /** Exact barcode first (what a scanner emits), then exact code, then unique name prefix. */
  function resolveScan(raw: string): Article | null {
    const q = raw.trim();
    if (!q) return null;
    const byBarcode = articles.find((a) => a.barcode && a.barcode === q);
    if (byBarcode) return byBarcode;
    const byCode = articles.find((a) => a.code.toLowerCase() === q.toLowerCase());
    if (byCode) return byCode;
    const matches = suggestions;
    return matches.length === 1 ? matches[0] : null;
  }

  const suggestions = useMemo(() => {
    const q = scan.trim().toLowerCase();
    if (q.length < 2) return [];
    return articles
      .filter((a) => a.code.toLowerCase().includes(q) || a.designation.toLowerCase().includes(q) || (a.barcode ?? '').includes(q))
      .slice(0, 6);
  }, [scan, articles]);

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
        cart.map((l) => ({
          quantity: l.quantity,
          unitPriceHT: l.unitPriceHT,
          discountPercent: 0,
          tvaRate: l.tvaRate,
          purchaseCostPUMP: l.pump
        })),
        0,
        paymentMode
      ),
    [cart, paymentMode]
  );

  const tenderedNum = Number(tendered.replace(',', '.')) || 0;
  const change = tenderedNum - totals.totalTTC;

  async function pay() {
    if (cart.length === 0 || !client || !depotId) return;
    if (paymentMode === 'ESPECE' && tendered !== '' && tenderedNum < totals.totalTTC) {
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
          paymentMode,
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
      const validated = await apiRequest<{ reference: string; createdAt: string }>(`/documents/${draft.id}/validate`, { method: 'POST' });

      printHtml(
        ticketHtml(
          {
            reference: validated.reference,
            type: 'VENTE',
            date: new Date(),
            partnerName: client.raisonSociale,
            paymentMode,
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
            cashReceived: paymentMode === 'ESPECE' && tendered !== '' ? tenderedNum : undefined,
            change: paymentMode === 'ESPECE' && tendered !== '' ? Math.max(change, 0) : undefined
          }
        )
      );

      toasts.success(`Vente ${validated.reference} encaissée.`);
      commitCart([]);
      setTendered('');
      await onSaved();
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : 'Erreur lors de l’encaissement.');
    } finally {
      setPaying(false);
      scanRef.current?.focus();
    }
  }

  return (
    <Screen
      title="Caisse — Vente comptoir"
      description="Scannez un code-barres ou tapez un code/nom d'article puis Entrée. Le ticket s'imprime à l'encaissement."
      maxWidth="max-w-7xl"
    >
      <div className="flex-1 flex gap-4 min-h-0">
        {/* -------- Left: scan + cart -------- */}
        <div className="flex-[1.6] flex flex-col gap-3 min-w-0">
          <Card padded={false}>
            <div className="p-3 relative">
              <input
                ref={scanRef}
                autoFocus
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={onScanKey}
                placeholder="Scanner un code-barres ou taper code / désignation…"
                className="w-full border-2 border-[#0F5B38]/40 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/40 focus:border-[#0F5B38] bg-white"
              />
              {suggestions.length > 0 && (
                <div className="absolute left-3 right-3 top-full -mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-20 overflow-hidden">
                  {suggestions.map((a) => (
                    <div
                      key={a.id}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        addArticle(a);
                      }}
                      className="px-4 py-2 flex justify-between items-center gap-3 cursor-pointer hover:bg-[#0F5B38]/5 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-mono font-bold text-[#0F5B38] mr-2">{a.code}</span>
                        <span className="text-slate-700">{a.designation}</span>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        <Badge tone={availableFor(a) > 0 ? 'success' : 'danger'}>{availableFor(a)} dispo</Badge>
                        <span className="font-mono font-semibold">{money(priceFor(a))}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card padded={false} className="flex-1 min-h-0">
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-500 sticky top-0 border-b border-slate-200">
                  <tr>
                    <th className="p-2.5 text-left text-[10px] uppercase font-semibold">Article</th>
                    <th className="p-2.5 text-center text-[10px] uppercase font-semibold w-28">Qté</th>
                    <th className="p-2.5 text-right text-[10px] uppercase font-semibold w-24">P.U. TTC</th>
                    <th className="p-2.5 text-right text-[10px] uppercase font-semibold w-28">Total TTC</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cart.map((l) => {
                    const puTTC = l.unitPriceHT * (1 + l.tvaRate / 100);
                    return (
                      <tr key={l.articleId}>
                        <td className="p-2.5">
                          <div className="font-semibold text-slate-800">{l.designation}</div>
                          <div className="font-mono text-[10px] text-slate-400">{l.code}</div>
                        </td>
                        <td className="p-2.5">
                          <div className="flex items-center justify-center gap-1">
                            <Button size="sm" variant="secondary" onClick={() => setQty(l.articleId, l.quantity - 1)} aria-label="Diminuer">
                              −
                            </Button>
                            <input
                              value={l.quantity}
                              onChange={(e) => setQty(l.articleId, Number(e.target.value) || 1)}
                              className="w-12 text-center border border-slate-200 rounded-lg py-1 font-mono"
                            />
                            <Button size="sm" variant="secondary" onClick={() => setQty(l.articleId, l.quantity + 1)} aria-label="Augmenter">
                              +
                            </Button>
                          </div>
                        </td>
                        <td className="p-2.5 text-right font-mono">{money(puTTC)}</td>
                        <td className="p-2.5 text-right font-mono font-bold">{money(puTTC * l.quantity)}</td>
                        <td className="p-2.5 text-center">
                          <button
                            onClick={() => commitCart(cartRef.current.filter((x) => x.articleId !== l.articleId))}
                            className="text-slate-300 hover:text-rose-600 font-bold px-1"
                            aria-label={`Retirer ${l.code}`}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {cart.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-12 text-center text-slate-400">
                        Panier vide — scannez un article pour commencer.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* -------- Right: client, payment, totals -------- */}
        <div className="w-80 shrink-0 flex flex-col gap-3">
          <Card title="Client & dépôt">
            <div className="flex flex-col gap-2">
              <Select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client">
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.raisonSociale} ({c.code})
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
          </Card>

          <Card title="Règlement">
            <div className="grid grid-cols-2 gap-1.5">
              {(['ESPECE', 'CHEQUE', 'TRAITE', 'VIREMENT'] as PaymentMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setPaymentMode(m)}
                  className={`px-2 py-2 rounded-xl border text-[11px] font-semibold transition ${
                    paymentMode === m ? 'bg-[#0F5B38] text-white border-[#0F5B38]' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {m === 'ESPECE' ? 'Espèces' : m === 'CHEQUE' ? 'Chèque' : m === 'TRAITE' ? 'Traite' : 'Virement'}
                </button>
              ))}
            </div>
            {paymentMode === 'ESPECE' && (
              <div className="mt-3">
                <label className="text-[10px] font-bold uppercase text-slate-500">Espèces reçues</label>
                <input
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') pay();
                  }}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="w-full mt-1 border border-slate-200 rounded-xl px-3 py-2 text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#0F5B38]/40"
                />
                {tendered !== '' && (
                  <div className={`mt-2 text-right font-mono font-bold text-sm ${change < 0 ? 'text-rose-600' : 'text-[#0F5B38]'}`}>
                    {change < 0 ? `Manque ${money(-change)}` : `À rendre ${money(change)}`}
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card className="mt-auto">
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Total HT</span>
                <span className="font-mono">{money(totals.totalHT)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>TVA</span>
                <span className="font-mono">{money(totals.totalTVA)}</span>
              </div>
              {totals.stampDuty > 0 && (
                <div className="flex justify-between text-slate-500">
                  <span>Timbre fiscal</span>
                  <span className="font-mono">{money(totals.stampDuty)}</span>
                </div>
              )}
              <div className="flex justify-between items-baseline border-t border-slate-200 mt-2 pt-2">
                <span className="font-extrabold text-slate-900">TOTAL</span>
                <span className="font-mono font-extrabold text-xl text-[#0F5B38]">{money(totals.totalTTC)} DZD</span>
              </div>
            </div>
            <Button
              variant="primary"
              className="w-full mt-3 py-3 text-sm"
              disabled={cart.length === 0 || paying}
              onClick={pay}
            >
              {paying ? 'Encaissement…' : 'Encaisser & imprimer le ticket'}
            </Button>
            {cart.length > 0 && (
              <Button variant="ghost" className="w-full mt-1" onClick={() => commitCart([])}>
                Vider le panier
              </Button>
            )}
          </Card>
        </div>
      </div>

      <ToastHost toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </Screen>
  );
}
