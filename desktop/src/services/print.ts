/**
 * Printing service: renders documents to self-contained HTML and sends them to
 * the OS print dialog through a hidden iframe (works identically in Electron and
 * in a browser during development).
 *
 * Two formats:
 *  - A4 invoice/bon for commercial documents (facture, proforma, bons, achats…)
 *  - 80mm thermal ticket for POS counter sales
 */

export interface CompanySettings {
  [key: string]: string | undefined;
}

export interface PrintLine {
  code: string;
  designation: string;
  quantity: number;
  unitPriceHT: number;
  discountPercent: number;
  tvaRate: number;
  totalHT: number;
}

export interface PartnerFiscal {
  nif?: string | null;
  rc?: string | null;
  ai?: string | null;
  nis?: string | null;
  nin?: string | null;
  email?: string | null;
}

export interface PrintDoc {
  reference: string;
  type: string;
  date: string | Date;
  partnerName?: string | null;
  partnerCode?: string | null;
  partnerAddress?: string | null;
  partnerFiscal?: PartnerFiscal | null;
  paymentMode: string;
  totalHT: number;
  remise: number;
  totalTVA: number;
  stampDuty: number;
  totalTTC: number;
  lines: PrintLine[];
}

const DOC_TITLES: Record<string, string> = {
  FACTURE: 'FACTURE',
  PROFORMA: 'FACTURE PROFORMA',
  BON_LIVRAISON: 'BON DE LIVRAISON',
  BON_PREPARATION: 'BON DE COMMANDE',
  VENTE: 'BON DE VENTE',
  ACHAT: "BON D'ACHAT",
  COMMANDE: 'BON DE COMMANDE',
  RETOUR_CLIENT: 'AVOIR CLIENT',
  RETOUR_FOURNISSEUR: 'AVOIR FOURNISSEUR',
  TRANSFERT: 'BON DE TRANSFERT',
  REGULE_PLUS: 'RÉGULARISATION (+)',
  REGULE_MOINS: 'RÉGULARISATION (−)'
};

const PAYMENT_LABELS: Record<string, string> = {
  ESPECE: 'Espèces',
  CHEQUE: 'Chèque',
  TRAITE: 'Traite',
  VIREMENT: 'Virement bancaire'
};

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// French number-to-words (Algerian invoices carry the amount in full letters)
// ---------------------------------------------------------------------------
const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];

function below100(n: number): string {
  if (n < 17) return UNITS[n];
  if (n < 20) return 'dix-' + UNITS[n - 10];
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  if (tens === 7 || tens === 9) {
    // 70-79 and 90-99 build on soixante/quatre-vingt + 10..19
    const base = tens === 7 ? 'soixante' : 'quatre-vingt';
    const rest = below100(n - (tens === 7 ? 60 : 80));
    return n % 10 === 1 && tens === 7 ? `${base} et ${rest}` : `${base}-${rest}`;
  }
  const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', '', 'quatre-vingt', ''];
  if (unit === 0) return tens === 8 ? 'quatre-vingts' : TENS[tens];
  if (unit === 1) return `${TENS[tens]} et un`;
  return `${TENS[tens]}-${UNITS[unit]}`;
}

function below1000(n: number): string {
  if (n < 100) return below100(n);
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const head = hundreds === 1 ? 'cent' : `${below100(hundreds)} cent${rest === 0 ? 's' : ''}`;
  return rest === 0 ? head : `${head} ${below100(rest)}`;
}

export function frenchNumberToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0) return 'zéro';
  const parts: string[] = [];
  const billions = Math.floor(n / 1_000_000_000);
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  if (billions) parts.push(billions === 1 ? 'un milliard' : `${below1000(billions)} milliards`);
  if (millions) parts.push(millions === 1 ? 'un million' : `${below1000(millions)} millions`);
  if (thousands) parts.push(thousands === 1 ? 'mille' : `${below1000(thousands)} mille`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

/** "12 345,67" → "douze mille trois cent quarante-cinq dinars algériens et soixante-sept centimes". */
export function amountInWordsDZD(amount: number): string {
  const dinars = Math.floor(amount);
  const centimes = Math.round((amount - dinars) * 100);
  let out = `${frenchNumberToWords(dinars)} dinar${dinars > 1 ? 's' : ''} algérien${dinars > 1 ? 's' : ''}`;
  if (centimes > 0) out += ` et ${frenchNumberToWords(centimes)} centime${centimes > 1 ? 's' : ''}`;
  return out;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
/** Identifiants fiscaux du client, requis notamment pour l'État 104. */
function partnerIds(f?: PartnerFiscal | null): string {
  if (!f) return '';
  return [
    f.nif && `NIF: ${esc(f.nif)}`,
    f.rc && `RC: ${esc(f.rc)}`,
    f.ai && `AI: ${esc(f.ai)}`,
    f.nis && `NIS: ${esc(f.nis)}`,
    f.nin && `NIN: ${esc(f.nin)}`
  ]
    .filter(Boolean)
    .join(' — ');
}

function companyHeader(company: CompanySettings): string {
  // Mentions légales obligatoires sur toute facture (hors capital social).
  const idLine = [
    company['company.rc'] && `RC: ${esc(company['company.rc'])}`,
    company['company.nif'] && `NIF: ${esc(company['company.nif'])}`,
    company['company.ai'] && `AI: ${esc(company['company.ai'])}`,
    company['company.nis'] && `NIS: ${esc(company['company.nis'])}`,
    company['company.nin'] && `NIN: ${esc(company['company.nin'])}`
  ]
    .filter(Boolean)
    .join(' — ');
  return `
    <div class="co">
      <div class="co-name">${esc(company['company.name'] || 'ETS DJEMROUD')}</div>
      <div class="co-sub">${esc(company['company.activity'] || '')}</div>
      ${company['company.address'] ? `<div class="co-sub">${esc(company['company.address'])}</div>` : ''}
      ${company['company.phone'] ? `<div class="co-sub">Tél: ${esc(company['company.phone'])}</div>` : ''}
      ${company['company.email'] ? `<div class="co-sub">${esc(company['company.email'])}</div>` : ''}
      ${idLine ? `<div class="co-ids">${idLine}</div>` : ''}
    </div>`;
}

export function invoiceHtml(doc: PrintDoc, company: CompanySettings): string {
  const title = DOC_TITLES[doc.type] ?? doc.type;
  const date = new Date(doc.date);
  const rows = doc.lines
    .map(
      (l, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="mono">${esc(l.code)}</td>
        <td>${esc(l.designation)}</td>
        <td class="r">${l.quantity}</td>
        <td class="r">${fmt(l.unitPriceHT)}</td>
        <td class="r">${l.discountPercent ? fmt(l.discountPercent) + ' %' : '—'}</td>
        <td class="r">${fmt(l.tvaRate)} %</td>
        <td class="r">${fmt(l.totalHT)}</td>
      </tr>`
    )
    .join('');

  const isProforma = doc.type === 'PROFORMA';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.reference)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #111; margin: 0; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0F5B38; padding-bottom: 10px; }
    .co-name { font-size: 20px; font-weight: 800; color: #0F5B38; }
    .co-sub { color: #444; margin-top: 1px; }
    .co-ids { margin-top: 4px; font-size: 9.5px; color: #555; }
    .doc-meta { text-align: right; }
    .doc-title { font-size: 17px; font-weight: 800; letter-spacing: 1px; }
    .doc-ref { font-family: Consolas, monospace; font-size: 13px; margin-top: 2px; }
    .badge-proforma { display:inline-block; margin-top:4px; padding: 2px 8px; border: 1.5px solid #b45309; color:#b45309; font-weight:700; border-radius: 4px; font-size: 10px; }
    .parties { display: flex; justify-content: space-between; margin: 12px 0; gap: 16px; }
    .party { border: 1px solid #ddd; border-radius: 6px; padding: 8px 10px; min-width: 220px; }
    .party .t { font-size: 9px; text-transform: uppercase; color: #777; font-weight: 700; margin-bottom: 3px; }
    .party .n { font-weight: 700; }
    .party-ids { margin-top: 3px; font-size: 9px; color: #555; }
    table.lines { width: 100%; border-collapse: collapse; margin-top: 6px; }
    table.lines th { background: #0F5B38; color: #fff; padding: 5px 6px; font-size: 10px; text-align: left; }
    table.lines td { border-bottom: 1px solid #e5e5e5; padding: 4px 6px; }
    td.r, th.r { text-align: right; } td.c { text-align: center; } .mono { font-family: Consolas, monospace; }
    .totals { margin-top: 10px; margin-left: auto; width: 260px; border-collapse: collapse; }
    .totals td { padding: 3px 8px; }
    .totals .lbl { color: #555; }
    .totals .val { text-align: right; font-family: Consolas, monospace; }
    .totals .grand td { border-top: 2px solid #0F5B38; font-weight: 800; font-size: 13px; padding-top: 6px; }
    .words { margin-top: 12px; font-size: 10.5px; border: 1px solid #ddd; border-radius: 6px; padding: 8px 10px; background: #fafaf7; }
    .footer { margin-top: 26px; display: flex; justify-content: space-between; align-items: flex-end; }
    .sig { text-align: center; color: #555; font-size: 10px; }
    .sig .line { margin-top: 42px; border-top: 1px solid #999; width: 160px; }
    .print-footer { margin-top: 18px; text-align: center; color: #777; font-size: 9.5px; border-top: 1px solid #eee; padding-top: 6px; }
  </style></head><body>
    <div class="head">
      ${companyHeader(company)}
      <div class="doc-meta">
        <div class="doc-title">${esc(title)}</div>
        <div class="doc-ref">N° ${esc(doc.reference)}</div>
        <div>Date: ${date.toLocaleDateString('fr-FR')}</div>
        <div>Règlement: ${esc(PAYMENT_LABELS[doc.paymentMode] ?? doc.paymentMode)}</div>
        ${isProforma ? '<div class="badge-proforma">SANS VALEUR COMPTABLE</div>' : ''}
      </div>
    </div>
    ${
      doc.partnerName
        ? `<div class="parties"><div class="party">
             <div class="t">${['ACHAT', 'COMMANDE', 'RETOUR_FOURNISSEUR'].includes(doc.type) ? 'Fournisseur' : 'Client'}</div>
             <div class="n">${esc(doc.partnerName)}</div>
             ${doc.partnerCode ? `<div class="mono">${esc(doc.partnerCode)}</div>` : ''}
             ${doc.partnerAddress ? `<div>${esc(doc.partnerAddress)}</div>` : ''}
             ${doc.partnerFiscal?.email ? `<div>${esc(doc.partnerFiscal.email)}</div>` : ''}
             ${partnerIds(doc.partnerFiscal) ? `<div class="party-ids">${partnerIds(doc.partnerFiscal)}</div>` : ''}
           </div></div>`
        : ''
    }
    <table class="lines">
      <thead><tr>
        <th style="width:24px">#</th><th style="width:90px">Code</th><th>Désignation</th>
        <th class="r" style="width:44px">Qté</th><th class="r" style="width:80px">P.U. HT</th>
        <th class="r" style="width:56px">Remise</th><th class="r" style="width:50px">TVA</th>
        <th class="r" style="width:90px">Montant HT</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals">
      <tr><td class="lbl">Total HT</td><td class="val">${fmt(doc.totalHT)}</td></tr>
      ${doc.remise > 0 ? `<tr><td class="lbl">Remise globale</td><td class="val">− ${fmt(doc.remise)}</td></tr>` : ''}
      <tr><td class="lbl">Total TVA</td><td class="val">${fmt(doc.totalTVA)}</td></tr>
      ${doc.stampDuty > 0 ? `<tr><td class="lbl">Timbre fiscal</td><td class="val">${fmt(doc.stampDuty)}</td></tr>` : ''}
      <tr class="grand"><td>NET À PAYER</td><td class="val">${fmt(doc.totalTTC)} DZD</td></tr>
    </table>
    <div class="words">Arrêté${isProforma ? 'e la présente proforma' : ' le présent document'} à la somme de : <b>${esc(amountInWordsDZD(doc.totalTTC))}</b>.</div>
    <div class="footer">
      <div class="sig">Le client<div class="line"></div></div>
      <div class="sig">Cachet et signature<div class="line"></div></div>
    </div>
    ${company['print.footer'] ? `<div class="print-footer">${esc(company['print.footer'])}</div>` : ''}
  </body></html>`;
}

export interface TicketOptions {
  cashReceived?: number;
  change?: number;
  cashier?: string;
}

export function ticketHtml(doc: PrintDoc, company: CompanySettings, options: TicketOptions = {}): string {
  const date = new Date(doc.date);
  const rows = doc.lines
    .map(
      (l) => `
      <tr><td colspan="2" class="desig">${esc(l.designation)}</td></tr>
      <tr><td class="qp">${l.quantity} × ${fmt(l.unitPriceHT * (1 + l.tvaRate / 100))}</td><td class="r">${fmt(l.totalHT * (1 + l.tvaRate / 100))}</td></tr>`
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.reference)}</title>
  <style>
    @page { size: 80mm auto; margin: 3mm; }
    body { font-family: Consolas, 'Courier New', monospace; font-size: 10.5px; color: #000; margin: 0; width: 72mm; }
    .center { text-align: center; }
    .name { font-size: 14px; font-weight: 700; }
    .sub { font-size: 9px; }
    hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 1px 0; vertical-align: top; }
    .r { text-align: right; }
    .desig { font-weight: 600; }
    .qp { padding-left: 8px; color: #222; }
    .tot td { font-size: 12px; font-weight: 700; padding-top: 3px; }
    .meta { font-size: 9px; }
  </style></head><body>
    <div class="center">
      <div class="name">${esc(company['company.name'] || 'ETS DJEMROUD')}</div>
      <div class="sub">${esc(company['company.activity'] || '')}</div>
      ${company['company.address'] ? `<div class="sub">${esc(company['company.address'])}</div>` : ''}
      ${company['company.phone'] ? `<div class="sub">Tél: ${esc(company['company.phone'])}</div>` : ''}
    </div>
    <hr>
    <div class="meta">${date.toLocaleDateString('fr-FR')} ${date.toLocaleTimeString('fr-FR')} &nbsp; Réf: ${esc(doc.reference)}${options.cashier ? `<br>Caisse: ${esc(options.cashier)}` : ''}</div>
    <hr>
    <table>${rows}</table>
    <hr>
    <table>
      <tr><td>Total HT</td><td class="r">${fmt(doc.totalHT)}</td></tr>
      <tr><td>TVA</td><td class="r">${fmt(doc.totalTVA)}</td></tr>
      ${doc.stampDuty > 0 ? `<tr><td>Timbre fiscal</td><td class="r">${fmt(doc.stampDuty)}</td></tr>` : ''}
      <tr class="tot"><td>TOTAL TTC</td><td class="r">${fmt(doc.totalTTC)}</td></tr>
      ${options.cashReceived != null ? `<tr><td>Espèces reçues</td><td class="r">${fmt(options.cashReceived)}</td></tr>` : ''}
      ${options.change != null && options.change > 0 ? `<tr><td>Monnaie rendue</td><td class="r">${fmt(options.change)}</td></tr>` : ''}
    </table>
    <hr>
    <div class="center sub">${esc(company['print.footer'] || 'Merci de votre confiance.')}</div>
  </body></html>`;
}

/**
 * Prints an HTML string via a hidden iframe. The iframe is removed once printing
 * has been handed to the OS. Repeated calls reuse a single host element.
 */
export function printHtml(html: string): void {
  const existing = document.getElementById('erp-print-frame');
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'erp-print-frame';
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const idoc = iframe.contentDocument;
  if (!idoc) return;
  idoc.open();
  idoc.write(html);
  idoc.close();

  // Give the engine a beat to lay out before invoking print.
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
  }, 150);
}
