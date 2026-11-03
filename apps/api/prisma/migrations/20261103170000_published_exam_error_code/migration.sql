-- Use a plain raised exception, so these errors keep their clear message instead of appearing as foreign key failures.
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
     OR (to_jsonb(NEW) - 'status' - 'archived_at' - 'updated_at') <> (to_jsonb(OLD) - 'status' - 'archived_at' - 'updated_at') THEN
    RAISE EXCEPTION 'Published exam version % cannot be changed. Create a new version.', OLD."id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_published_exam_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_data jsonb;
  version_id uuid;
BEGIN
  FOREACH row_data IN ARRAY CASE TG_OP
    WHEN 'INSERT' THEN ARRAY[to_jsonb(NEW)]
    WHEN 'DELETE' THEN ARRAY[to_jsonb(OLD)]
    ELSE ARRAY[to_jsonb(OLD), to_jsonb(NEW)]
  END LOOP
    version_id := exam_version_of_content(TG_TABLE_NAME, row_data);
    IF EXISTS (SELECT 1 FROM "exam_versions" WHERE "id" = version_id AND "published_at" IS NOT NULL) THEN
      RAISE EXCEPTION 'Content of published exam version % cannot be changed. Create a new version.', version_id;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
