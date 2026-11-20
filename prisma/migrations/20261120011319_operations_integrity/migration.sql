-- Garantias de integridade no nível do banco (independentes da aplicação).

-- Tickers sempre em maiúsculas.
ALTER TABLE "funds" ADD CONSTRAINT "funds_ticker_upper_chk" CHECK ("ticker" = upper("ticker") AND length("ticker") BETWEEN 4 AND 12);

-- Valores das operações.
ALTER TABLE "operations"
  ADD CONSTRAINT "operations_quantity_positive_chk" CHECK ("quantity" > 0),
  ADD CONSTRAINT "operations_unit_price_positive_chk" CHECK ("unit_price" > 0),
  ADD CONSTRAINT "operations_fees_non_negative_chk" CHECK ("fees" >= 0),
  ADD CONSTRAINT "operations_amounts_non_negative_chk" CHECK ("gross_amount" >= 0),
  -- Saldo inicial sem data (não inventamos datas); compra/venda sempre com data.
  ADD CONSTRAINT "operations_trade_date_chk" CHECK (("type" = 'INITIAL_BALANCE') = ("trade_date" IS NULL)),
  -- Saldo inicial não tem taxas próprias (o preço médio informado já as inclui).
  ADD CONSTRAINT "operations_initial_no_fees_chk" CHECK ("type" <> 'INITIAL_BALANCE' OR "fees" = 0),
  -- Operação inativa precisa de data e motivo.
  ADD CONSTRAINT "operations_void_info_chk" CHECK (("status" = 'ACTIVE') = ("voided_at" IS NULL AND "void_reason" IS NULL));

-- No máximo um saldo inicial ativo por fundo.
CREATE UNIQUE INDEX "operations_one_active_initial_balance_idx"
  ON "operations" ("fund_id") WHERE "type" = 'INITIAL_BALANCE' AND "status" = 'ACTIVE';

-- Posição e cotações.
ALTER TABLE "positions" ADD CONSTRAINT "positions_quantity_non_negative_chk" CHECK ("quantity" >= 0 AND "total_cost" >= 0);
ALTER TABLE "price_quotes" ADD CONSTRAINT "price_quotes_price_positive_chk" CHECK ("price" > 0);

-- Operações nunca são apagadas e seus dados informados nunca são alterados.
CREATE OR REPLACE FUNCTION operations_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Operações não podem ser excluídas (id=%). Use cancelamento ou correção.', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.fund_id IS DISTINCT FROM OLD.fund_id
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.trade_date IS DISTINCT FROM OLD.trade_date
     OR NEW.sequence IS DISTINCT FROM OLD.sequence
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
     OR NEW.fees IS DISTINCT FROM OLD.fees
     OR NEW.gross_amount IS DISTINCT FROM OLD.gross_amount
     OR NEW.net_amount IS DISTINCT FROM OLD.net_amount
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.corrects_id IS DISTINCT FROM OLD.corrects_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Dados informados de uma operação são imutáveis (id=%). Registre uma correção.', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- Uma operação inativa não volta a ficar ativa.
  IF OLD.status <> 'ACTIVE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Operação % já está inativa (%).', OLD.id, OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "operations_protect_trg"
  BEFORE UPDATE OR DELETE ON "operations"
  FOR EACH ROW EXECUTE FUNCTION operations_protect();

-- Trilha de auditoria é somente inserção.
CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A trilha de auditoria é somente inserção.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_events_append_only_trg"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
