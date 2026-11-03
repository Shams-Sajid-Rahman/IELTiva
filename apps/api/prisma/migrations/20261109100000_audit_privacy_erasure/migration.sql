-- Audit history still can't be rewritten or deleted. Personal data inside it can now be removed, as privacy rules need:
-- the IP address and the stored before/after values may be cleared, and the actor link may be cleared, but never set
-- to something else. What happened, to what, and when always stay exactly as recorded.
CREATE OR REPLACE FUNCTION protect_audit_log() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Audit log entries cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - 'actor_id' - 'ip_address' - 'before' - 'after' - 'updated_at') <> (to_jsonb(OLD) - 'actor_id' - 'ip_address' - 'before' - 'after' - 'updated_at') THEN
    RAISE EXCEPTION 'Audit log entries cannot be changed';
  END IF;
  IF NEW."actor_id" IS DISTINCT FROM OLD."actor_id" AND NEW."actor_id" IS NOT NULL THEN
    RAISE EXCEPTION 'Audit log entries cannot be changed';
  END IF;
  IF NEW."ip_address" IS DISTINCT FROM OLD."ip_address" AND NEW."ip_address" IS NOT NULL THEN
    RAISE EXCEPTION 'Audit log entries cannot be changed';
  END IF;
  IF NEW."before" IS DISTINCT FROM OLD."before" AND NEW."before" IS NOT NULL AND NEW."before" <> 'null'::jsonb THEN
    RAISE EXCEPTION 'Audit log entries cannot be changed';
  END IF;
  IF NEW."after" IS DISTINCT FROM OLD."after" AND NEW."after" IS NOT NULL AND NEW."after" <> 'null'::jsonb THEN
    RAISE EXCEPTION 'Audit log entries cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
