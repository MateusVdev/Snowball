-- Integridade de cotações automáticas, proventos e recebimentos.

-- Cotação automática: a mesma leitura do provedor (fundo, fonte, horário) não é gravada duas vezes.
CREATE UNIQUE INDEX "price_quotes_auto_unique_idx"
  ON "price_quotes" ("fund_id", "source", "market_time") WHERE "market_time" IS NOT NULL;
ALTER TABLE "daily_prices" ADD CONSTRAINT "daily_prices_close_positive_chk" CHECK ("close" > 0);

ALTER TABLE "funds" ADD CONSTRAINT "funds_cnpj_digits_chk" CHECK ("cnpj" IS NULL OR "cnpj" ~ '^[0-9]{14}$');

-- Proventos.
ALTER TABLE "dividend_events"
  ADD CONSTRAINT "dividend_events_rate_positive_chk" CHECK ("rate_per_share" > 0),
  ADD CONSTRAINT "dividend_events_payment_after_datacom_chk" CHECK ("payment_date" IS NULL OR "payment_date" >= "data_com"),
  ADD CONSTRAINT "dividend_events_competence_chk" CHECK ("competence" IS NULL OR "competence" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT "dividend_events_void_info_chk" CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL)),
  ADD CONSTRAINT "dividend_events_forecast_manual_chk" CHECK ("kind" <> 'FORECAST' OR "source" = 'MANUAL');

-- Prevenção de duplicidade: um evento ativo por fundo/natureza/tipo/data-com/pagamento.
CREATE UNIQUE INDEX "dividend_events_active_unique_idx"
  ON "dividend_events" ("fund_id", "kind", "type", "data_com", (COALESCE("payment_date", DATE '1900-01-01')))
  WHERE "voided_at" IS NULL;

-- Recebimentos.
ALTER TABLE "dividend_receipts"
  ADD CONSTRAINT "dividend_receipts_quantity_positive_chk" CHECK ("eligible_quantity" > 0),
  ADD CONSTRAINT "dividend_receipts_amount_non_negative_chk" CHECK ("total_amount" >= 0),
  ADD CONSTRAINT "dividend_receipts_void_info_chk" CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL));

-- Pagamento duplicado: no máximo um recebimento ativo por evento.
CREATE UNIQUE INDEX "dividend_receipts_one_active_per_event_idx"
  ON "dividend_receipts" ("event_id") WHERE "voided_at" IS NULL;

-- Eventos e recebimentos nunca são excluídos; dados informados são imutáveis
-- (correção = anular com motivo e registrar de novo).
CREATE OR REPLACE FUNCTION dividend_events_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Proventos não podem ser excluídos (id=%). Anule com motivo.', OLD.id;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.fund_id IS DISTINCT FROM OLD.fund_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.rate_per_share IS DISTINCT FROM OLD.rate_per_share
     OR NEW.data_com IS DISTINCT FROM OLD.data_com
     OR NEW.payment_date IS DISTINCT FROM OLD.payment_date THEN
    RAISE EXCEPTION 'Dados de um provento são imutáveis (id=%). Anule e registre novamente.', OLD.id;
  END IF;
  IF OLD.voided_at IS NOT NULL AND NEW.voided_at IS DISTINCT FROM OLD.voided_at THEN
    RAISE EXCEPTION 'Provento % já foi anulado.', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "dividend_events_protect_trg"
  BEFORE UPDATE OR DELETE ON "dividend_events"
  FOR EACH ROW EXECUTE FUNCTION dividend_events_protect();

CREATE OR REPLACE FUNCTION dividend_receipts_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Recebimentos não podem ser excluídos (id=%). Anule com motivo.', OLD.id;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.fund_id IS DISTINCT FROM OLD.fund_id
     OR NEW.event_id IS DISTINCT FROM OLD.event_id
     OR NEW.eligible_quantity IS DISTINCT FROM OLD.eligible_quantity
     OR NEW.rate_per_share IS DISTINCT FROM OLD.rate_per_share
     OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
     OR NEW.payment_date IS DISTINCT FROM OLD.payment_date THEN
    RAISE EXCEPTION 'Dados de um recebimento são imutáveis (id=%). Anule e registre novamente.', OLD.id;
  END IF;
  IF OLD.voided_at IS NOT NULL AND NEW.voided_at IS DISTINCT FROM OLD.voided_at THEN
    RAISE EXCEPTION 'Recebimento % já foi anulado.', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "dividend_receipts_protect_trg"
  BEFORE UPDATE OR DELETE ON "dividend_receipts"
  FOR EACH ROW EXECUTE FUNCTION dividend_receipts_protect();
