-- Usa o código padrão de RAISE (P0001) em vez de restrict_violation, para que
-- a mensagem explicativa chegue intacta à aplicação (o Prisma traduz
-- restrict_violation como "Foreign key constraint violated").

CREATE OR REPLACE FUNCTION operations_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Operações não podem ser excluídas (id=%). Use cancelamento ou correção.', OLD.id;
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
    RAISE EXCEPTION 'Dados informados de uma operação são imutáveis (id=%). Registre uma correção.', OLD.id;
  END IF;
  IF OLD.status <> 'ACTIVE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Operação % já está inativa (%).', OLD.id, OLD.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A trilha de auditoria é somente inserção.';
END;
$$ LANGUAGE plpgsql;
