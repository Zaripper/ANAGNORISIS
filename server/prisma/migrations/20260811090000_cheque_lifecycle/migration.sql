-- CreateEnum
CREATE TYPE "ChequeEtat" AS ENUM ('EN_INSTANCE', 'MIS_EN_PAIEMENT', 'PAYE', 'ANNULE');

-- CreateTable
CREATE TABLE "Cheque" (
    "id" TEXT NOT NULL,
    "type" "CashTxType" NOT NULL,
    "etat" "ChequeEtat" NOT NULL DEFAULT 'EN_INSTANCE',
    "numeroPiece" TEXT,
    "datePiece" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "partnerId" TEXT NOT NULL,
    "numeroCheque" TEXT NOT NULL,
    "dateCheque" TIMESTAMP(3),
    "banque" TEXT,
    "montant" DECIMAL(65,30) NOT NULL,
    "libelle" TEXT,
    "cashTransactionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cheque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cheque_cashTransactionId_key" ON "Cheque"("cashTransactionId");

-- CreateIndex
CREATE INDEX "Cheque_type_etat_idx" ON "Cheque"("type", "etat");

-- CreateIndex
CREATE INDEX "Cheque_partnerId_idx" ON "Cheque"("partnerId");

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_cashTransactionId_fkey" FOREIGN KEY ("cashTransactionId") REFERENCES "CashTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

