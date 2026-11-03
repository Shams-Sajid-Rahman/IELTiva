-- Published content stays locked, but deleting an author's account may clear their name from it.
CREATE OR REPLACE FUNCTION protect_published_exam_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."published_at" IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Published exam version % cannot be deleted', OLD."id";
  END IF;
  -- Only archiving is allowed after publication.
  IF NEW."status" NOT IN ('PUBLISHED', 'ARCHIVED')
     OR (to_jsonb(NEW) - 'status' - 'archived_at' - 'updated_at' - 'created_by_id' - 'reviewed_by_id') <> (to_jsonb(OLD) - 'status' - 'archived_at' - 'updated_at' - 'created_by_id' - 'reviewed_by_id')
     OR (NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id" AND NEW."created_by_id" IS NOT NULL)
     OR (NEW."reviewed_by_id" IS DISTINCT FROM OLD."reviewed_by_id" AND NEW."reviewed_by_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'Published exam version % cannot be changed. Create a new version.', OLD."id";
  END IF;
  RETURN NEW;
END;
$$;
